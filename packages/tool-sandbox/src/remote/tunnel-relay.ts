import type WebSocket from "ws";
import { DockerSandboxError } from "../errors";
import { rawDataToString } from "./protocol";
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
/**
 * Where a socket cannot be paused, the most it may have queued before it is closed instead. It is
 * above a single clipboard message from a viewer (the desktop's filter allows 1 MiB), so pasting
 * is not a disconnect, and still bounds a connection's memory.
 */
const maxQueuedBytesUnpausable = 4 * maxQueuedBytes;
/** WebSocket close reasons are limited to 123 bytes. */
const maxReasonBytes = 120;

/** Ways a caller can shape the byte relay, which a desktop viewer needs and a plain tunnel does not. */
export interface BridgeHooks {
  /** Rewrite what the browser sends before it goes to the service. Throwing closes the socket. */
  filter?: (bytes: Uint8Array) => Uint8Array;
  /** Handle a text frame. Without this, text frames are a protocol error. */
  onText?: (text: string) => void;
  /** The browser socket closed. */
  onClose?: () => void;
}

/** Bridge one browser WebSocket to a raw TCP tunnel to `authorization.port`. */
export function relayTunnel(
  ws: WebSocket,
  options: { tunnel: SandboxTunnel; authorization: TunnelAuthorization },
): void {
  bridgeTunnel(ws, options.tunnel.open(options.authorization.port));
}

/**
 * Bridge a browser WebSocket to a tunnel that is being opened, byte for byte in both directions
 * (binary frames, as noVNC and websockify use). Nothing is buffered without bound: output is
 * acknowledged to the daemon once the browser's socket accepted it, and a browser that sends faster
 * than the service reads is paused until the service catches up.
 */
export function bridgeTunnel(
  ws: WebSocket,
  opening: Promise<TunnelHandle>,
  hooks: BridgeHooks = {},
): void {
  let handle: TunnelHandle | undefined;
  let closed = false;
  let queued = 0;
  // `ws` can pause its socket, which is how a browser that sends faster than the service reads is
  // slowed down. Some runtimes substitute their own WebSocket for the package (Bun does) and it has
  // no pause or resume, so ask once. Without them the limit below ends the connection instead of
  // slowing it, which still bounds memory.
  const canPause = typeof ws.pause === "function" && typeof ws.resume === "function";
  const stopPing = keepAlive(ws);
  ws.on("error", () => undefined);

  const opened = opening.then(
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
      if (hooks.onText === undefined) closeSocket(1003, "binary frames only");
      else hooks.onText(rawDataToString(data));
      return;
    }
    let bytes = toBytes(data);
    if (hooks.filter !== undefined) {
      try {
        bytes = hooks.filter(bytes);
      } catch (error) {
        closeSocket(1008, error instanceof Error ? error.message : "unsupported message");
        return;
      }
      if (bytes.byteLength === 0) return;
    }
    queued += bytes.byteLength;
    if (canPause && queued > maxQueuedBytes) {
      ws.pause();
    } else if (!canPause && queued > maxQueuedBytesUnpausable) {
      queued -= bytes.byteLength;
      closeSocket(1008, "sending faster than the service reads");
      return;
    }
    const size = bytes.byteLength;
    chain = chain.then(async () => {
      try {
        const target = await opened;
        if (target !== undefined && !closed) await target.write(bytes);
      } catch {
        // The tunnel ended while this frame was in flight. Its exit closes the socket, with the
        // right code for why, so closing here too would only race it.
      } finally {
        queued -= size;
        if (canPause && queued <= maxQueuedBytes / 2) ws.resume();
      }
    });
  });

  ws.once("close", () => {
    closed = true;
    stopPing();
    handle?.close();
    hooks.onClose?.();
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
