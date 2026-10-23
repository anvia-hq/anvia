import { randomUUID } from "node:crypto";
import { DockerSandboxError } from "../errors";
import {
  type HubConnection,
  LinkClosedError,
  type TunnelEndpoint,
  type TunnelExit,
} from "./connection";
import { InboundStream } from "./inbound-stream";
import { type FlowProfile, type FlowProfileName, flowProfiles } from "../shared/flow";
import { encodeBytes, tunnelCapability, tunnelHosts } from "./protocol";
import type { RemoteLinkSource } from "./runtime";

export type { TunnelExit };

export interface TunnelOpenOptions {
  /** Loopback address inside the sandbox. Omit to try 127.0.0.1 and then ::1. */
  host?: (typeof tunnelHosts)[number] | undefined;
  /**
   * `interactive` for a stream a person is watching and driving, such as a desktop's VNC: bigger
   * windows and frames, no batching, so it stays fast over a slow link. A daemon that does not
   * know the profile uses its defaults. Default: the terminal-sized defaults.
   */
  profile?: FlowProfileName | undefined;
  abortSignal?: AbortSignal | undefined;
}

/** A raw TCP connection to a service on the sandbox's own loopback. */
export interface TunnelHandle {
  readonly port: number;
  /**
   * Send bytes to the service. Settles once there is room for them: while the service is slow to
   * read, writes wait instead of piling up. Rejects once the tunnel has ended.
   */
  write(data: string | Uint8Array): Promise<void>;
  /** Bytes from the service in order. Read it once; a slow reader slows the service. */
  readonly output: AsyncIterable<Uint8Array>;
  close(): void;
  /**
   * Settles when the tunnel ends: `remote` (the service closed it), `closed` ({@link close}),
   * `error`, or `disconnected` (the daemon link dropped). It never rejects.
   */
  readonly exit: Promise<TunnelExit>;
}

/** Raw TCP tunnels into a sandbox. Not part of `SandboxRuntime`: only remote sandboxes have them. */
export interface SandboxTunnel {
  open(port: number, options?: TunnelOpenOptions): Promise<TunnelHandle>;
}

export interface RemoteSandboxTunnelOptions {
  id: string;
  source: RemoteLinkSource;
  /** Unread bytes a handle may hold before it is cut off with `error`. Default 1 MiB. */
  maxBufferBytes?: number | undefined;
  /** How long `open` waits for the daemon to connect. Default 15 s. */
  openTimeoutMs?: number | undefined;
}

const defaultMaxBufferBytes = 1024 * 1024;
const defaultOpenTimeoutMs = 15_000;
/** Bytes sent to the daemon but not yet consumed by the service. Writes wait beyond this. */
const defaultWriteWindowBytes = 256 * 1024;
const writeChunkBytes = 32 * 1024;

export class RemoteSandboxTunnel implements SandboxTunnel {
  private readonly maxBufferBytes: number;
  private readonly openTimeoutMs: number;

  constructor(private readonly options: RemoteSandboxTunnelOptions) {
    this.maxBufferBytes = options.maxBufferBytes ?? defaultMaxBufferBytes;
    this.openTimeoutMs = options.openTimeoutMs ?? defaultOpenTimeoutMs;
  }

  async open(port: number, options: TunnelOpenOptions = {}): Promise<TunnelHandle> {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new RangeError("port must be an integer from 1 to 65535.");
    }
    if (options.host !== undefined && !tunnelHosts.includes(options.host)) {
      throw new TypeError(
        "host must be 127.0.0.1 or ::1: tunnels only reach the sandbox's loopback.",
      );
    }
    const connection = await this.options.source.acquire(options.abortSignal);
    if (!connection.capabilities.has(tunnelCapability)) {
      throw new DockerSandboxError(
        `Sandbox ${this.options.id} does not support tunnels. Its daemon needs a version that ` +
          "supports them, and tunnels switched on.",
        "unsupported",
      );
    }

    const tunnelId = randomUUID();
    const profile = options.profile === undefined ? undefined : flowProfiles[options.profile];
    const handle = new RemoteTunnelHandle(tunnelId, port, connection, this.maxBufferBytes, profile);
    connection.registerTunnel(tunnelId, handle.endpoint);
    try {
      connection.sendFrame({
        type: "tunnel.open",
        tunnelId,
        port,
        host: options.host,
        profile: options.profile,
      });
      await handle.opened(this.openTimeoutMs, options.abortSignal);
    } catch (error) {
      connection.unregisterTunnel(tunnelId);
      if (error instanceof LinkClosedError) {
        throw new DockerSandboxError(
          `Sandbox ${this.options.id} connection dropped.`,
          "sandbox_unavailable",
          undefined,
          { cause: error },
        );
      }
      throw error;
    }
    return handle;
  }
}

class RemoteTunnelHandle implements TunnelHandle {
  readonly output: AsyncIterable<Uint8Array>;
  readonly exit: Promise<TunnelExit>;
  readonly endpoint: TunnelEndpoint;
  private readonly stream: InboundStream<TunnelExit>;
  private readonly writeWindowBytes: number;
  private sent = 0;
  private acknowledged = 0;
  private roomWaiters: Array<() => void> = [];
  private settleOpen: { resolve: () => void; reject: (error: Error) => void } | undefined;

  constructor(
    private readonly tunnelId: string,
    readonly port: number,
    private readonly connection: HubConnection,
    maxBufferBytes: number,
    profile: FlowProfile | undefined,
  ) {
    this.writeWindowBytes = profile?.writeWindowBytes ?? defaultWriteWindowBytes;
    this.stream = new InboundStream<TunnelExit>({
      // The daemon may have a whole window in flight, plus the frame that crossed the mark, so the
      // queue has to hold that much for a reader that is momentarily behind.
      maxBufferBytes:
        profile === undefined
          ? maxBufferBytes
          : Math.max(maxBufferBytes, profile.highWaterBytes + profile.frameBytes),
      ackStepBytes: profile?.ackStepBytes,
      label: "Tunnel",
      overflowEnd: { reason: "error", message: "The tunnel consumer is too slow." },
      onConsumed: (bytes) => this.trySend({ type: "tunnel.ack", tunnelId, bytes }),
      onOverflow: () => this.trySend({ type: "tunnel.close", tunnelId }),
      // Every way a tunnel ends, including an overflow, lands here: the registry entry goes, and
      // writers parked waiting for room are woken to find the tunnel closed.
      onEnd: () => {
        this.connection.unregisterTunnel(tunnelId);
        this.wakeWriters();
      },
    });
    this.output = this.stream.chunks;
    this.exit = this.stream.ended;
    this.endpoint = {
      opened: () => this.settleOpen?.resolve(),
      failed: (error) => this.settleOpen?.reject(error),
      output: (data) => this.stream.push(data),
      acked: (total) => {
        this.acknowledged = Math.max(this.acknowledged, Math.min(total, this.sent));
        this.wakeWriters();
      },
      exit: (info) => this.end(info),
      lost: (error) => {
        if (this.settleOpen !== undefined) this.settleOpen.reject(error);
        else this.end({ reason: "disconnected" });
      },
    };
  }

  opened(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.settleOpen = undefined;
      };
      const abort = () => {
        cleanup();
        this.trySend({ type: "tunnel.close", tunnelId: this.tunnelId });
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup();
        this.trySend({ type: "tunnel.close", tunnelId: this.tunnelId });
        reject(new DockerSandboxError("Timed out opening the tunnel.", "timeout"));
      }, timeoutMs);
      this.settleOpen = {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }

  async write(data: string | Uint8Array): Promise<void> {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    for (let start = 0; start < bytes.byteLength; start += writeChunkBytes) {
      await this.waitForRoom();
      const chunk = bytes.subarray(start, start + writeChunkBytes);
      this.sent += chunk.byteLength;
      this.connection.sendFrame({
        type: "tunnel.data",
        tunnelId: this.tunnelId,
        data: encodeBytes(chunk),
      });
    }
  }

  close(): void {
    if (this.stream.endedWith !== undefined) return;
    this.trySend({ type: "tunnel.close", tunnelId: this.tunnelId });
    this.end({ reason: "closed" });
  }

  private async waitForRoom(): Promise<void> {
    while (this.sent - this.acknowledged >= this.writeWindowBytes) {
      if (this.stream.endedWith !== undefined) break;
      await new Promise<void>((resolve) => this.roomWaiters.push(resolve));
    }
    if (this.stream.endedWith !== undefined) {
      throw new DockerSandboxError("The tunnel is closed.", "invalid_state");
    }
  }

  private wakeWriters(): void {
    const waiters = this.roomWaiters;
    this.roomWaiters = [];
    for (const wake of waiters) wake();
  }

  private end(info: TunnelExit): void {
    this.stream.end(info);
  }

  private trySend(frame: Parameters<HubConnection["sendFrame"]>[0]): void {
    try {
      this.connection.sendFrame(frame);
    } catch {
      // The link is down; the connection ends this tunnel itself.
    }
  }
}
