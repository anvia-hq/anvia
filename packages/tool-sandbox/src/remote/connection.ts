import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  type DaemonFrame,
  type HubFrame,
  type PtyExitReason,
  type TunnelCloseReason,
  type MethodParams,
  type MethodResult,
  type SandboxMethod,
  daemonFrameSchema,
  decodeBytes,
  decodeError,
  methodResults,
  rawDataToString,
} from "./protocol";

/** The link dropped before the call finished. Whether to retry is the caller's decision. */
export class LinkClosedError extends Error {
  constructor(message = "Sandbox connection closed.") {
    super(message);
    this.name = "LinkClosedError";
  }
}

export interface CallOptions {
  operationId?: string | undefined;
  signal?: AbortSignal | undefined;
  onStream?: ((stream: "stdout" | "stderr", data: Uint8Array) => void) | undefined;
}

export type PtyExit = { reason: PtyExitReason; exitCode?: number };
export type TunnelExit = { reason: TunnelCloseReason; message?: string };

/** A tunnel's endpoint also hears when the daemon has consumed what the hub sent. */
export interface TunnelEndpoint extends StreamEndpoint<TunnelExit> {
  /** The daemon consumed this many bytes of hub data in total. */
  acked(totalBytes: number): void;
}

/** Receives one stream's frames (a terminal's or a tunnel's). Registered by whoever opened it. */
export interface StreamEndpoint<Exit> {
  opened(): void;
  /** The open was refused. */
  failed(error: Error): void;
  output(data: Uint8Array): void;
  exit(info: Exit): void;
  /** The link dropped; whether the PTY was open yet is for the endpoint to know. */
  lost(error: LinkClosedError): void;
}

interface Pending {
  method: SandboxMethod;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
  onStream: CallOptions["onStream"];
  nextSeq: number;
}

/** One live daemon connection: multiplexes requests, streams, cancellation, and heartbeats. */
export class HubConnection {
  readonly closed: Promise<void>;
  private readonly pending = new Map<string, Pending>();
  private readonly ptys = new Map<string, { endpoint: StreamEndpoint<PtyExit>; nextSeq: number }>();
  private readonly tunnels = new Map<string, { endpoint: TunnelEndpoint; nextSeq: number }>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private lastSeen = Date.now();
  private open = true;

  constructor(
    private readonly socket: WebSocket,
    readonly workdir: string,
    heartbeatIntervalMs: number,
    /** Optional features the daemon said it has. Empty for a daemon that predates them. */
    readonly capabilities: ReadonlySet<string> = new Set(),
  ) {
    this.closed = new Promise((resolve) => {
      socket.once("close", () => {
        this.open = false;
        clearInterval(this.heartbeat);
        const error = new LinkClosedError();
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        const streams = [...this.ptys.values(), ...this.tunnels.values()];
        this.ptys.clear();
        this.tunnels.clear();
        for (const { endpoint } of streams) endpoint.lost(error);
        resolve();
      });
    });
    socket.on("error", () => undefined);
    socket.on("message", (data) => {
      this.lastSeen = Date.now();
      this.onMessage(data);
    });
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > heartbeatIntervalMs * 3) {
        socket.terminate();
        return;
      }
      this.send({ type: "ping" });
    }, heartbeatIntervalMs);
    this.heartbeat.unref?.();
  }

  get isOpen(): boolean {
    return this.open && this.socket.readyState === WebSocket.OPEN;
  }

  close(code: number, reason: string): void {
    this.socket.close(code, reason);
    setTimeout(() => this.socket.terminate(), 1_000).unref?.();
  }

  registerPty(ptyId: string, endpoint: StreamEndpoint<PtyExit>): void {
    this.ptys.set(ptyId, { endpoint, nextSeq: 0 });
  }

  unregisterPty(ptyId: string): void {
    this.ptys.delete(ptyId);
  }

  registerTunnel(tunnelId: string, endpoint: TunnelEndpoint): void {
    this.tunnels.set(tunnelId, { endpoint, nextSeq: 0 });
  }

  unregisterTunnel(tunnelId: string): void {
    this.tunnels.delete(tunnelId);
  }

  /** Send a terminal frame. Throws `LinkClosedError` if the link is already down. */
  sendFrame(frame: HubFrame): void {
    this.send(frame);
  }

  async call<M extends SandboxMethod>(
    method: M,
    params: MethodParams<M>,
    options: CallOptions = {},
  ): Promise<MethodResult<M>> {
    options.signal?.throwIfAborted();
    if (!this.isOpen) throw new LinkClosedError();
    const requestId = randomUUID();

    return new Promise<MethodResult<M>>((resolve, reject) => {
      const abort = () => {
        if (this.pending.delete(requestId)) {
          // Tell the daemon to stop work nobody is waiting for.
          this.trySend({ type: "cancel", requestId });
        }
        reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const settle =
        <T>(fn: (value: T) => void) =>
        (value: T) => {
          options.signal?.removeEventListener("abort", abort);
          fn(value);
        };
      this.pending.set(requestId, {
        method,
        resolve: settle(resolve as (value: unknown) => void),
        reject: settle(reject),
        onStream: options.onStream,
        nextSeq: 0,
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        const frame: Record<string, unknown> = { type: "request", requestId, method, params };
        if (options.operationId !== undefined) frame.operationId = options.operationId;
        this.send(frame as HubFrame);
      } catch (error) {
        this.pending.delete(requestId);
        settle(reject)(error);
      }
    });
  }

  private onMessage(data: WebSocket.RawData): void {
    let frame: DaemonFrame;
    try {
      const parsed = daemonFrameSchema.safeParse(JSON.parse(rawDataToString(data)));
      if (!parsed.success) {
        this.socket.close(1002, "invalid frame");
        return;
      }
      frame = parsed.data;
    } catch {
      this.socket.close(1002, "malformed frame");
      return;
    }

    switch (frame.type) {
      case "ping":
        this.trySend({ type: "pong" });
        return;
      case "stream": {
        const pending = this.pending.get(frame.requestId);
        if (pending === undefined) return;
        if (frame.seq !== pending.nextSeq) {
          // Frames on one socket are ordered; a gap means the stream cannot be trusted.
          this.fail(frame.requestId, new LinkClosedError("Sandbox stream frames out of order."));
          return;
        }
        pending.nextSeq += 1;
        pending.onStream?.(frame.stream, decodeBytes(frame.data));
        return;
      }
      case "response": {
        const pending = this.pending.get(frame.requestId);
        if (pending === undefined) return;
        this.pending.delete(frame.requestId);
        const parsed = methodResults[pending.method].safeParse(frame.result);
        if (parsed.success) pending.resolve(parsed.data);
        else pending.reject(new LinkClosedError("Sandbox returned an invalid result."));
        return;
      }
      case "pty.opened":
        this.ptys.get(frame.ptyId)?.endpoint.opened();
        return;
      case "pty.output": {
        const entry = this.ptys.get(frame.ptyId);
        if (entry === undefined) return;
        if (frame.seq !== entry.nextSeq) {
          // Frames on one socket are ordered; a gap means this terminal cannot be trusted.
          this.ptys.delete(frame.ptyId);
          this.trySend({ type: "pty.close", ptyId: frame.ptyId });
          entry.endpoint.exit({ reason: "error" });
          return;
        }
        entry.nextSeq += 1;
        entry.endpoint.output(decodeBytes(frame.data));
        return;
      }
      case "pty.exit": {
        const entry = this.ptys.get(frame.ptyId);
        if (entry === undefined) return;
        this.ptys.delete(frame.ptyId);
        entry.endpoint.exit(
          frame.exitCode === undefined
            ? { reason: frame.reason }
            : { reason: frame.reason, exitCode: frame.exitCode },
        );
        return;
      }
      case "tunnel.opened":
        this.tunnels.get(frame.tunnelId)?.endpoint.opened();
        return;
      case "tunnel.data": {
        const entry = this.tunnels.get(frame.tunnelId);
        if (entry === undefined) return;
        if (frame.seq !== entry.nextSeq) {
          this.tunnels.delete(frame.tunnelId);
          this.trySend({ type: "tunnel.close", tunnelId: frame.tunnelId });
          entry.endpoint.exit({ reason: "error", message: "Tunnel frames arrived out of order." });
          return;
        }
        entry.nextSeq += 1;
        entry.endpoint.output(decodeBytes(frame.data));
        return;
      }
      case "tunnel.ack":
        this.tunnels.get(frame.tunnelId)?.endpoint.acked(frame.bytes);
        return;
      case "tunnel.close": {
        const entry = this.tunnels.get(frame.tunnelId);
        if (entry === undefined) return;
        this.tunnels.delete(frame.tunnelId);
        entry.endpoint.exit(
          frame.message === undefined
            ? { reason: frame.reason }
            : { reason: frame.reason, message: frame.message },
        );
        return;
      }
      case "error": {
        if (frame.requestId === undefined) return;
        const tunnel = this.tunnels.get(frame.requestId);
        if (tunnel !== undefined) {
          // As for terminals, the only error a tunnel gets is a refusal to open.
          this.tunnels.delete(frame.requestId);
          tunnel.endpoint.failed(decodeError(frame));
          return;
        }
        const terminal = this.ptys.get(frame.requestId);
        if (terminal !== undefined) {
          // The only error a PTY gets is a refusal to open, which the daemon sends under its id.
          this.ptys.delete(frame.requestId);
          terminal.endpoint.failed(decodeError(frame));
          return;
        }
        const pending = this.pending.get(frame.requestId);
        if (pending === undefined) return;
        this.pending.delete(frame.requestId);
        pending.reject(decodeError(frame));
        return;
      }
      default:
        return;
    }
  }

  private fail(requestId: string, error: Error): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.pending.delete(requestId);
    this.trySend({ type: "cancel", requestId });
    pending.reject(error);
  }

  private send(frame: HubFrame): void {
    if (!this.isOpen) throw new LinkClosedError();
    this.socket.send(JSON.stringify(frame));
  }

  private trySend(frame: HubFrame): void {
    try {
      this.send(frame);
    } catch {
      // Closed links drop their own pending work.
    }
  }
}
