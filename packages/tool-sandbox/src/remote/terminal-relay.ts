import type { IncomingMessage } from "node:http";
import WebSocket from "ws";
import { z } from "zod";
import { DockerSandboxError } from "../errors";
import type { SandboxTerminal, TerminalHandle } from "./terminal";

/** What a browser is allowed to do, decided by `authorizeTerminal` for one upgrade request. */
export type TerminalAuthorization = Readonly<{
  sandboxId: string;
  sessionName: string;
  /** Output only. Input and resize from this viewer are dropped. */
  readOnly?: boolean | undefined;
  /** Starting directory when the session is created, relative to the sandbox workdir. */
  cwd?: string | undefined;
}>;

/** Subprotocol the browser must offer; the hub selects it. */
export const terminalSubprotocol = "anvia.terminal.v1";
const ticketPrefix = "anvia.ticket.";

const size = z.number().int().min(1).max(1_000);
const browserMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("open"), cols: size, rows: size }),
  z.object({ type: z.literal("input"), data: z.string().max(65_536) }),
  z.object({ type: z.literal("resize"), cols: size, rows: size }),
]);

/**
 * Pull a short-lived ticket out of a terminal upgrade request. Browsers cannot set an
 * `Authorization` header on a WebSocket, so the ticket travels in the `ticket` query parameter or
 * as a `anvia.ticket.<ticket>` entry of `Sec-WebSocket-Protocol`. Prefer the latter: URLs end up
 * in access logs.
 */
export function terminalTicket(request: IncomingMessage): string | undefined {
  const header = request.headers["sec-websocket-protocol"];
  const offered = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((entry) => entry.trim());
  for (const entry of offered) {
    if (entry.startsWith(ticketPrefix) && entry.length > ticketPrefix.length) {
      return entry.slice(ticketPrefix.length);
    }
  }
  const ticket = new URL(request.url ?? "/", "http://hub").searchParams.get("ticket");
  return ticket === null || ticket === "" ? undefined : ticket;
}

/**
 * Cross-site WebSocket hijacking guard. A request with no Origin is not from a browser page and
 * passes. Otherwise the Origin must be listed, or, with no list, must be the host that was asked.
 */
export function originAllowed(
  request: IncomingMessage,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (allowedOrigins !== undefined) return allowedOrigins.includes(origin);
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

export function selectTerminalProtocol(protocols: Set<string>): string | false {
  return protocols.has(terminalSubprotocol) ? terminalSubprotocol : false;
}

const openTimeoutMs = 10_000;
const pingIntervalMs = 30_000;

/**
 * Bridge one browser WebSocket to a terminal. Output goes out as binary frames; everything else is
 * small JSON. The browser's first message must be `open` with its size, so the session starts at
 * the right dimensions. Output is only acknowledged to the daemon once the socket accepted it, so
 * a stalled browser slows the daemon instead of growing hub memory.
 */
export function relayTerminal(
  ws: WebSocket,
  options: { terminal: SandboxTerminal; authorization: TerminalAuthorization },
): void {
  const { terminal, authorization } = options;
  const readOnly = authorization.readOnly === true;
  let handle: TerminalHandle | undefined;
  let opening = false;
  let alive = true;

  ws.on("error", () => undefined);
  ws.on("pong", () => {
    alive = true;
  });
  const ping = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, pingIntervalMs);
  ping.unref?.();
  const waitForOpen = setTimeout(() => {
    if (!opening) ws.close(1008, "open timeout");
  }, openTimeoutMs);
  waitForOpen.unref?.();

  ws.once("close", () => {
    clearInterval(ping);
    clearTimeout(waitForOpen);
    handle?.close();
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      ws.close(1003, "text frames only");
      return;
    }
    const parsed = parseMessage(data);
    if (parsed === undefined) {
      ws.close(1002, "invalid message");
      return;
    }
    if (parsed.type === "open") {
      if (opening) return;
      opening = true;
      clearTimeout(waitForOpen);
      void start(parsed.cols, parsed.rows);
      return;
    }
    // Input and resize before the terminal is ready, or from a read-only viewer, are dropped.
    if (handle === undefined || readOnly) return;
    if (parsed.type === "input") handle.write(parsed.data);
    else handle.resize(parsed.cols, parsed.rows);
  });

  async function start(cols: number, rows: number): Promise<void> {
    try {
      const opened = await terminal.open({
        sessionName: authorization.sessionName,
        cols,
        rows,
        readOnly,
        cwd: authorization.cwd,
      });
      if (ws.readyState !== WebSocket.OPEN) {
        opened.close();
        return;
      }
      handle = opened;
    } catch (error) {
      sendJson(ws, {
        type: "error",
        code: error instanceof DockerSandboxError ? error.code : "protocol",
        message: error instanceof Error ? error.message : "Could not open the terminal.",
      });
      ws.close(1011, "terminal unavailable");
      return;
    }

    sendJson(ws, { type: "ready", readOnly });
    try {
      for await (const chunk of handle.output) {
        if (ws.readyState !== WebSocket.OPEN) break;
        await sendBinary(ws, chunk);
      }
    } catch {
      // A socket that failed mid-send ends the relay below.
    }
    const exit = await handle.exit;
    sendJson(ws, { type: "exit", ...exit });
    ws.close(1000, "terminal ended");
  }
}

function parseMessage(data: WebSocket.RawData) {
  try {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString("utf8")
      : Buffer.from(data as ArrayBuffer).toString("utf8");
    const parsed = browserMessage.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function sendJson(ws: WebSocket, value: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
}

function sendBinary(ws: WebSocket, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(chunk, { binary: true }, (error) => (error ? reject(error) : resolve()));
  });
}
