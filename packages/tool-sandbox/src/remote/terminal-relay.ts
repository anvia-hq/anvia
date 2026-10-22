import WebSocket from "ws";
import { z } from "zod";
import { DockerSandboxError } from "../errors";
import { rawDataToString } from "./protocol";
import { keepAlive, sendBinary, sendJson } from "./relay-common";
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

const size = z.number().int().min(1).max(1_000);
const browserMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("open"), cols: size, rows: size }),
  z.object({ type: z.literal("input"), data: z.string().max(65_536) }),
  z.object({ type: z.literal("resize"), cols: size, rows: size }),
]);

export function selectTerminalProtocol(protocols: Set<string>): string | false {
  return protocols.has(terminalSubprotocol) ? terminalSubprotocol : false;
}

const openTimeoutMs = 10_000;

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

  ws.on("error", () => undefined);
  const stopPing = keepAlive(ws);
  const waitForOpen = setTimeout(() => {
    if (!opening) ws.close(1008, "open timeout");
  }, openTimeoutMs);
  waitForOpen.unref?.();

  ws.once("close", () => {
    stopPing();
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
    const parsed = browserMessage.safeParse(JSON.parse(rawDataToString(data)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
