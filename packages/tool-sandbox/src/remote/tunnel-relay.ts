import type WebSocket from "ws";
import { DockerSandboxError } from "../errors";
import { keepAlive, sendBinary } from "./relay-common";
import type { SandboxTunnel, TunnelHandle } from "./tunnel";

/** What a browser may reach, decided by `authorizeTunnel` for one upgrade request. */
export type TunnelAuthorization = Readonly<{
  sandboxId: string;
  /** A loopback port inside the sandbox. */
  port: number;
}>;

/** Subprotocol the hub selects for a tunnel. A client that only offers `binary` (noVNC) works too. */
export const tunnelSubprotocol = "anvia.tunnel.v1";
const binarySubprotocol = "binary";

export function selectTunnelProtocol(protocols: Set<string>): string | false {
  if (protocols.has(tunnelSubprotocol)) return tunnelSubprotocol;
  return protocols.has(binarySubprotocol) ? binarySubprotocol : false;
}

/** Bytes a browser may have queued toward a slow service before its socket is paused. */
const maxQueuedBytes = 1024 * 1024;
/** WebSocket close reasons are limited to 123 bytes. */
const maxReasonBytes = 120;

/**
 * Bridge one browser WebSocket to a raw TCP tunnel, byte for byte in both directions (binary
 * frames, as noVNC and websockify use). Nothing is buffered without bound: output is acknowledged
 * to the daemon once the browser's socket accepted it, and a browser that sends faster than the
 * service reads is paused until the service catches up.
 */
export function relayTunnel(
  ws: WebSocket,
  options: { tunnel: SandboxTunnel; authorization: TunnelAuthorization },
): void {
  let handle: TunnelHandle | undefined;
  let closed = false;
  let queued = 0;
  const stopPing = keepAlive(ws);
  ws.on("error", () => undefined);

  const opened = options.tunnel.open(options.authorization.port).then(
    (value) => {
      handle = value;
      if (closed) value.close();
      return value;
    },
    (error: unknown) => {
      const code = error instanceof DockerSandboxError ? error.code : "protocol";
      const message = error instanceof Error ? error.message : "Could not open the tunnel.";
      closeSocket(1011, `${code}: ${message}`);
      return undefined;
    },
  );

  // Writes happen one at a time, in order, each waiting for room.
  let chain: Promise<void> = Promise.resolve();
  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      closeSocket(1003, "binary frames only");
      return;
    }
    const bytes = toBytes(data);
    queued += bytes.byteLength;
    if (queued > maxQueuedBytes) ws.pause();
    chain = chain.then(async () => {
      try {
        const target = await opened;
        if (target !== undefined && !closed) await target.write(bytes);
      } catch {
        closeSocket(1011, "tunnel closed");
      } finally {
        queued -= bytes.byteLength;
        if (queued <= maxQueuedBytes / 2) ws.resume();
      }
    });
  });

  ws.once("close", () => {
    closed = true;
    stopPing();
    handle?.close();
  });

  void (async () => {
    const target = await opened;
    if (target === undefined) return;
    try {
      for await (const chunk of target.output) {
        if (closed) break;
        await sendBinary(ws, chunk);
      }
    } catch {
      // A socket that failed mid-send ends the relay below.
    }
    const exit = await target.exit;
    closeSocket(exit.reason === "remote" || exit.reason === "closed" ? 1000 : 1011, exit.reason);
  })();

  function closeSocket(code: number, reason: string): void {
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      ws.close(code, truncate(reason));
    }
  }
}

function toBytes(data: WebSocket.RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  return new Uint8Array(data);
}

function truncate(reason: string): string {
  const bytes = Buffer.from(reason);
  return bytes.byteLength <= maxReasonBytes ? reason : bytes.subarray(0, maxReasonBytes).toString();
}
