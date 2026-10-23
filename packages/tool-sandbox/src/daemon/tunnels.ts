import net from "node:net";
import { DockerSandboxError } from "../errors";
import type { DaemonOutbound } from "../remote/binary-frame";
import {
  type DaemonFrame,
  type HubFrame,
  type TunnelCloseReason,
  encodeError,
  tunnelHosts,
} from "../remote/protocol";
import { type FlowProfile, flowProfile } from "../shared/flow";
import { type StreamChannelLimits, StreamChannel } from "./stream-channel";

export interface SandboxDaemonTunnelOptions {
  /** Ports tunnels may reach. Default: any loopback port. */
  allowedPorts?: readonly number[];
  /** Tunnels one hub connection may hold open. Default 64. */
  maxTunnels?: number;
  /** How long to wait for the local service to accept. Default 5 s. */
  connectTimeoutMs?: number;
  /** Output batching and flow-control bounds. */
  flow?: StreamChannelLimits;
  /**
   * Bounds for particular ports, which win over everything else. A tunnel to a port with no entry
   * uses the profile the hub asked for (a desktop viewer asks for `interactive`), and otherwise
   * `flow`.
   */
  flowByPort?: Readonly<Record<number, StreamChannelLimits>>;
}

interface TunnelExitInfo {
  reason: Exclude<TunnelCloseReason, "disconnected">;
  message?: string;
}

interface Entry {
  closing: boolean;
  socket?: net.Socket;
  channel?: StreamChannel<TunnelExitInfo>;
  /** Hub bytes received, written to the socket, and acknowledged back. */
  received: number;
  written: number;
  acknowledged: number;
  /** Acknowledge hub bytes in steps of this size, and tolerate this much unwritten. */
  ackStepBytes: number;
  maxUnwrittenBytes: number;
}

const defaultMaxTunnels = 64;
const defaultConnectTimeoutMs = 5_000;
/**
 * By default the hub stops at 256 KiB unacked; this much more than that means it is not listening
 * to acks. A profile with a bigger window gets four times it.
 */
const defaultMaxUnwrittenBytes = 1024 * 1024;
const defaultAckStepBytes = 32 * 1024;

/**
 * The tunnels one hub connection has open: raw TCP streams to services on the sandbox's own
 * loopback, flow-controlled in both directions. They belong to the connection and close with it.
 */
export class ConnectionTunnels {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly deps: {
      /** False when the daemon was started with tunnels switched off. */
      enabled: boolean;
      options: SandboxDaemonTunnelOptions | undefined;
      /** Ports allowed even when `allowedPorts` is set, such as the desktop's VNC port. */
      alwaysAllowedPorts?: () => readonly number[];
      send: (frame: DaemonOutbound) => void;
      bufferedAmount: () => number;
    },
  ) {}

  async open(frame: Extract<HubFrame, { type: "tunnel.open" }>): Promise<void> {
    const { tunnelId, port } = frame;
    const fail = (error: unknown) => this.deps.send(encodeError(error, tunnelId));
    const { options } = this.deps;
    if (!this.deps.enabled) {
      fail(new DockerSandboxError("This sandbox has no tunnel support.", "unsupported"));
      return;
    }
    const allowed = options?.allowedPorts;
    if (allowed !== undefined && !allowed.includes(port) && !this.alwaysAllowed(port)) {
      fail(new DockerSandboxError(`Port ${port} is not allowed for tunnels.`, "port"));
      return;
    }
    const maxTunnels = options?.maxTunnels ?? defaultMaxTunnels;
    if (this.entries.has(tunnelId) || this.entries.size >= maxTunnels) {
      fail(
        new DockerSandboxError(
          this.entries.has(tunnelId)
            ? `Tunnel ${tunnelId} is already open.`
            : `Too many open tunnels (${maxTunnels}).`,
          "invalid_state",
        ),
      );
      return;
    }

    const profile = flowProfile(frame.profile);
    const entry: Entry = {
      closing: false,
      received: 0,
      written: 0,
      acknowledged: 0,
      ackStepBytes: profile?.ackStepBytes ?? defaultAckStepBytes,
      maxUnwrittenBytes:
        profile === undefined
          ? defaultMaxUnwrittenBytes
          : Math.max(defaultMaxUnwrittenBytes, profile.writeWindowBytes * 4),
    };
    this.entries.set(tunnelId, entry);
    let socket: net.Socket;
    try {
      socket = await connectLoopback(
        port,
        frame.host,
        options?.connectTimeoutMs ?? defaultConnectTimeoutMs,
      );
    } catch (error) {
      this.entries.delete(tunnelId);
      if (!entry.closing) fail(error);
      return;
    }
    if (entry.closing) {
      socket.destroy();
      return;
    }

    const channel = new StreamChannel<TunnelExitInfo>(
      {
        pausable: true,
        pause: () => socket.pause(),
        resume: () => socket.resume(),
        snapshot: () => undefined,
      },
      {
        output: (seq, bytes) => ({ type: "tunnel.bytes", tunnelId, seq, bytes }),
        exit: (info) => {
          const closed: DaemonFrame = { type: "tunnel.close", tunnelId, reason: info.reason };
          return info.message === undefined ? closed : { ...closed, message: info.message };
        },
      },
      { send: this.deps.send, bufferedAmount: this.deps.bufferedAmount },
      outputLimits(port, profile, options),
    );
    entry.socket = socket;
    entry.channel = channel;

    let failure: string | undefined;
    let serviceHungUp = false;
    socket.setNoDelay(true);
    socket.on("end", () => {
      serviceHungUp = true;
    });
    socket.on("data", (chunk) => channel.push(chunk));
    socket.on("error", (error) => {
      failure = error.message;
    });
    socket.once("close", () => {
      if (this.entries.get(tunnelId) !== entry) return; // Closed from our side; already reported.
      this.entries.delete(tunnelId);
      // A write that fails after the service said goodbye (EPIPE) is the service closing, not a
      // fault in the tunnel.
      channel.finish(
        failure === undefined || serviceHungUp
          ? { reason: "remote" }
          : { reason: "error", message: failure },
      );
    });
    this.deps.send({ type: "tunnel.opened", tunnelId });
  }

  /** Bytes from the hub, written to the service. Acknowledged once the socket took them. */
  data(tunnelId: string, bytes: Uint8Array): void {
    const entry = this.entries.get(tunnelId);
    if (entry?.socket === undefined) return;
    entry.received += bytes.byteLength;
    if (entry.received - entry.written > entry.maxUnwrittenBytes) {
      this.shutdown(tunnelId, entry, { reason: "error", message: "Tunnel ignored flow control." });
      return;
    }
    entry.socket.write(bytes, () => {
      entry.written += bytes.byteLength;
      this.acknowledge(tunnelId, entry);
    });
  }

  /** The hub consumed this much of the service's output. */
  ack(tunnelId: string, bytes: number): void {
    this.entries.get(tunnelId)?.channel?.ack(bytes);
  }

  close(tunnelId: string): void {
    const entry = this.entries.get(tunnelId);
    if (entry === undefined) return;
    this.entries.delete(tunnelId);
    this.release(entry);
  }

  /** The connection is gone: drop every tunnel. */
  dispose(): void {
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    for (const entry of entries) this.release(entry);
  }

  private alwaysAllowed(port: number): boolean {
    return this.deps.alwaysAllowedPorts?.().includes(port) === true;
  }

  private acknowledge(tunnelId: string, entry: Entry): void {
    if (entry.closing) return;
    const unacked = entry.written - entry.acknowledged;
    // Step acks to keep traffic down, but never leave the hub waiting on the last few bytes.
    if (unacked < entry.ackStepBytes && entry.written < entry.received) return;
    if (unacked === 0) return;
    entry.acknowledged = entry.written;
    this.deps.send({ type: "tunnel.ack", tunnelId, bytes: entry.written });
  }

  private shutdown(tunnelId: string, entry: Entry, info: TunnelExitInfo): void {
    if (this.entries.get(tunnelId) !== entry) return;
    this.entries.delete(tunnelId);
    entry.channel?.finish(info);
    this.release(entry);
  }

  private release(entry: Entry): void {
    entry.closing = true;
    entry.channel?.dispose();
    entry.socket?.destroy();
  }
}

/** Bounds for a tunnel's output: the operator's for this port, else the hub's profile, else `flow`. */
function outputLimits(
  port: number,
  profile: FlowProfile | undefined,
  options: SandboxDaemonTunnelOptions | undefined,
): StreamChannelLimits | undefined {
  const forPort = options?.flowByPort?.[port];
  if (forPort !== undefined) return { ...options?.flow, ...forPort };
  if (profile === undefined) return options?.flow;
  return {
    batchMs: profile.batchMs,
    frameBytes: profile.frameBytes,
    highWaterBytes: profile.highWaterBytes,
    socketBufferBytes: profile.socketBufferBytes,
  };
}

/** Connect to a service on this machine's own loopback, and nowhere else. */
async function connectLoopback(
  port: number,
  host: (typeof tunnelHosts)[number] | undefined,
  timeoutMs: number,
): Promise<net.Socket> {
  const candidates = host === undefined ? tunnelHosts : [host];
  // Report the first failure: that is 127.0.0.1, the address people mean, not the ::1 fallback.
  let firstError: Error | undefined;
  for (const candidate of candidates) {
    try {
      return await connectOnce(candidate, port, timeoutMs);
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new DockerSandboxError(
    `Nothing accepted a connection on port ${port}: ${firstError?.message ?? "unknown error"}`,
    "port",
  );
}

function connectOnce(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}
