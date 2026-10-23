import http, { type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import { DockerSandboxError } from "../errors";
import type { SandboxRuntime } from "../types";
import { HubConnection } from "./connection";
import { binaryDataCapability } from "./binary-frame";
import {
  CLOSE_CODE_SUPERSEDED,
  PROTOCOL_VERSION,
  daemonFrameSchema,
  rawDataToString,
  terminalCapability,
  tunnelCapability,
  type HubFrame,
} from "./protocol";
import { RemoteSandboxRuntime } from "./runtime";
import { RemoteSandboxDesktop, type SandboxDesktop } from "./desktop";
import { type DesktopAuthorization, relayDesktop, selectDesktopProtocol } from "./desktop-relay";
import { handleBrowserUpgrade, rejectUpgrade } from "./relay-common";
import { RemoteSandboxTerminal, type SandboxTerminal } from "./terminal";
import {
  type TerminalAuthorization,
  relayTerminal,
  selectTerminalProtocol,
} from "./terminal-relay";
import { RemoteSandboxTunnel, type SandboxTunnel } from "./tunnel";
import { type TunnelAuthorization, relayTunnel, selectTunnelProtocol } from "./tunnel-relay";

/** Identifies which sandbox a daemon's token belongs to. */
export type RemoteSandboxAuthorization = Readonly<{ sandboxId: string }>;

export interface RemoteSandboxHubOptions {
  /**
   * Resolve a daemon's bearer token to its sandbox, or return null/undefined to refuse it.
   * Called once per connection attempt, before the WebSocket upgrade completes.
   */
  authorize(
    token: string,
  ):
    | Promise<RemoteSandboxAuthorization | null | undefined>
    | RemoteSandboxAuthorization
    | null
    | undefined;
  /** How long a call waits for a disconnected daemon before `sandbox_unavailable`. Default 30s. */
  connectTimeoutMs?: number;
  /** Application-level ping interval, also told to daemons. Default 15s. */
  heartbeatIntervalMs?: number;
  /**
   * Carry tunnel bytes (a desktop's VNC stream, for one) as binary WebSocket messages with daemons
   * that can take them, which saves base64 and JSON on both ends. Default true. Turn it off if
   * something between the hub and the daemons mishandles binary messages; tunnels then use JSON.
   */
  binaryData?: boolean;
  /** Largest frame accepted from a daemon. Default 64 MiB (file contents travel as base64). */
  maxPayloadBytes?: number;
  /** How long a connected socket may take to send `hello`. Default 10s. */
  handshakeTimeoutMs?: number;
  /** Bytes an execStream consumer may lag by before the stream aborts. Default 1 MiB. */
  maxStreamBufferBytes?: number;
  /** Unread terminal output a handle may hold before it is cut off. Default 1 MiB. */
  maxTerminalBufferBytes?: number;
  /**
   * Decide whether a browser may open a terminal, from its upgrade request, or return null/undefined
   * to refuse it with 401. Browsers cannot send an `Authorization` header on a WebSocket, so read a
   * short-lived ticket with `terminalTicket(request)` (query parameter or WebSocket subprotocol),
   * check it, and return the sandbox and session it grants. Required for `handleTerminalUpgrade`.
   */
  authorizeTerminal?(
    request: IncomingMessage,
  ): Promise<TerminalAuthorization | null | undefined> | TerminalAuthorization | null | undefined;
  /**
   * Decide whether a browser may view (and perhaps control) a sandbox's desktop, or return
   * null/undefined to refuse it with 401. Tickets work as for `authorizeTerminal`. Required for
   * `handleDesktopUpgrade`.
   */
  authorizeDesktop?(
    request: IncomingMessage,
  ): Promise<DesktopAuthorization | null | undefined> | DesktopAuthorization | null | undefined;
  /** Unread tunnel bytes a handle may hold before it is cut off. Default 1 MiB. */
  maxTunnelBufferBytes?: number;
  /**
   * Decide whether a browser may open a tunnel to a port in a sandbox, from its upgrade request, or
   * return null/undefined to refuse it with 401. Tickets work as for `authorizeTerminal`. Required
   * for `handleTunnelUpgrade`.
   */
  authorizeTunnel?(
    request: IncomingMessage,
  ): Promise<TunnelAuthorization | null | undefined> | TunnelAuthorization | null | undefined;
  /**
   * Origins allowed to open a terminal or tunnel. Without a list, a browser's Origin must match the Host it
   * connected to, which fails behind a proxy that rewrites Host, so set this there.
   */
  allowedOrigins?: readonly string[];
}

export interface RemoteSandboxHubListenOptions {
  port?: number;
  host?: string;
  /** Only upgrade requests to this path are accepted. Default: any path. */
  path?: string;
  /** Upgrade requests to this path are browser terminals, handled by `handleTerminalUpgrade`. */
  terminalPath?: string;
  /** Upgrade requests to this path are browser tunnels, handled by `handleTunnelUpgrade`. */
  tunnelPath?: string;
  /** Upgrade requests to this path are browser desktops, handled by `handleDesktopUpgrade`. */
  desktopPath?: string;
}

const defaultConnectTimeoutMs = 30_000;
const defaultHeartbeatIntervalMs = 15_000;
const defaultMaxPayloadBytes = 64 * 1024 * 1024;
const defaultHandshakeTimeoutMs = 10_000;

/**
 * Accepts daemon connections and keeps a registry of connected sandboxes. It authorizes and
 * routes; it creates, stops, and destroys nothing. Whatever starts sandboxes is responsible for
 * handing each daemon a token and a control URL.
 */
export class RemoteSandboxHub {
  private readonly connectTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly server: WebSocketServer;
  private readonly terminalServer: WebSocketServer;
  private readonly tunnelServer: WebSocketServer;
  private readonly desktopServer: WebSocketServer;
  private readonly relays = new Set<WebSocket>();
  private readonly connections = new Map<string, HubConnection>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly runtimes = new Map<string, RemoteSandboxRuntime>();
  private readonly configuredWorkdirs = new Map<string, string>();
  private readonly lastWorkdirs = new Map<string, string>();
  private httpServer: http.Server | undefined;
  private closed = false;

  constructor(private readonly options: RemoteSandboxHubOptions) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? defaultConnectTimeoutMs;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? defaultHeartbeatIntervalMs;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? defaultHandshakeTimeoutMs;
    this.server = new WebSocketServer({
      noServer: true,
      maxPayload: options.maxPayloadBytes ?? defaultMaxPayloadBytes,
    });
    this.terminalServer = new WebSocketServer({
      noServer: true,
      // Browser messages are keystrokes and resizes; nothing here needs more.
      maxPayload: 128 * 1024,
      handleProtocols: selectTerminalProtocol,
    });
    this.tunnelServer = new WebSocketServer({
      noServer: true,
      // A browser sends protocol bytes in small pieces; a tunnel never needs a huge frame.
      maxPayload: 1024 * 1024,
      handleProtocols: selectTunnelProtocol,
    });
    this.desktopServer = new WebSocketServer({
      noServer: true,
      maxPayload: 1024 * 1024,
      handleProtocols: selectDesktopProtocol,
    });
  }

  /** A sandbox's virtual display: screenshots, input, a control lock, and a VNC viewer path. */
  desktop(sandboxId: string): SandboxDesktop {
    if (typeof sandboxId !== "string" || sandboxId.length === 0) {
      throw new TypeError("sandboxId must be a non-empty string.");
    }
    return new RemoteSandboxDesktop({
      id: sandboxId,
      source: this.linkSource(sandboxId),
      tunnel: this.tunnel(sandboxId),
    });
  }

  /** Raw TCP tunnels into one sandbox. Cheap to call; nothing is cached per sandbox. */
  tunnel(sandboxId: string): SandboxTunnel {
    if (typeof sandboxId !== "string" || sandboxId.length === 0) {
      throw new TypeError("sandboxId must be a non-empty string.");
    }
    return new RemoteSandboxTunnel({
      id: sandboxId,
      maxBufferBytes: this.options.maxTunnelBufferBytes,
      source: this.linkSource(sandboxId),
    });
  }

  /** Interactive terminals for one sandbox. Cheap to call; nothing is cached per sandbox. */
  terminal(sandboxId: string): SandboxTerminal {
    if (typeof sandboxId !== "string" || sandboxId.length === 0) {
      throw new TypeError("sandboxId must be a non-empty string.");
    }
    return new RemoteSandboxTerminal({
      id: sandboxId,
      maxBufferBytes: this.options.maxTerminalBufferBytes,
      source: this.linkSource(sandboxId),
    });
  }

  /**
   * A runtime for one sandbox, usable before its daemon has connected. The same object is
   * returned for the same id. `workdir` is used until the daemon reports its own.
   */
  runtime(sandboxId: string, options: { workdir?: string } = {}): SandboxRuntime {
    if (typeof sandboxId !== "string" || sandboxId.length === 0) {
      throw new TypeError("sandboxId must be a non-empty string.");
    }
    if (options.workdir !== undefined) this.configuredWorkdirs.set(sandboxId, options.workdir);
    let runtime = this.runtimes.get(sandboxId);
    if (runtime === undefined) {
      runtime = new RemoteSandboxRuntime({
        id: sandboxId,
        maxStreamBufferBytes: this.options.maxStreamBufferBytes,
        source: this.linkSource(sandboxId),
      });
      this.runtimes.set(sandboxId, runtime);
    }
    return runtime;
  }

  private linkSource(sandboxId: string) {
    return {
      workdir: () =>
        this.lastWorkdirs.get(sandboxId) ?? this.configuredWorkdirs.get(sandboxId) ?? "/workspace",
      acquire: (signal?: AbortSignal) => this.acquire(sandboxId, signal),
    };
  }

  /**
   * Drop what the hub remembers about a sandbox: its runtime, configured workdir, and last
   * reported workdir. Call it when whatever manages the sandbox's lifecycle destroys it, or a
   * long-lived hub accumulates an entry per sandbox id. A connected daemon is disconnected, and
   * calls already waiting for one fail with `sandbox_unavailable` after `connectTimeoutMs`. A
   * runtime object you still hold keeps working if the daemon connects again.
   */
  forget(sandboxId: string): void {
    this.runtimes.delete(sandboxId);
    this.configuredWorkdirs.delete(sandboxId);
    this.lastWorkdirs.delete(sandboxId);
    this.connections.get(sandboxId)?.close(1000, "sandbox forgotten");
    this.connections.delete(sandboxId);
  }

  /** Ids of sandboxes whose daemon is connected right now. */
  connected(): string[] {
    return [...this.connections].filter(([, connection]) => connection.isOpen).map(([id]) => id);
  }

  isConnected(sandboxId: string): boolean {
    return this.connections.get(sandboxId)?.isOpen === true;
  }

  /** Complete a WebSocket upgrade for a request routed here by your own HTTP server. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on("error", () => undefined);
    if (this.closed) return rejectUpgrade(socket, 503, "Service Unavailable");
    const token = bearerToken(request);
    if (token === undefined) return rejectUpgrade(socket, 401, "Unauthorized");
    void (async () => {
      let authorization: RemoteSandboxAuthorization | null | undefined;
      try {
        authorization = await this.options.authorize(token);
      } catch {
        return rejectUpgrade(socket, 500, "Internal Server Error");
      }
      if (
        authorization === null ||
        authorization === undefined ||
        typeof authorization.sandboxId !== "string" ||
        authorization.sandboxId.length === 0
      ) {
        return rejectUpgrade(socket, 401, "Unauthorized");
      }
      if (this.closed || socket.destroyed) return socket.destroy();
      const { sandboxId } = authorization;
      this.server.handleUpgrade(request, socket, head, (ws) => this.accept(ws, sandboxId));
    })();
  }

  /**
   * Complete a browser's terminal WebSocket upgrade, routed here by your own HTTP server. The
   * browser must offer the `anvia.terminal.v1` subprotocol (plus `anvia.ticket.<ticket>` if it
   * carries its ticket there). A bad Origin gets 403, a missing or refused ticket 401. The daemon
   * path, `handleUpgrade`, is unaffected.
   */
  handleTerminalUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    handleBrowserUpgrade<TerminalAuthorization>(request, socket, head, {
      authorize: this.options.authorizeTerminal?.bind(this.options),
      valid: (grant) => isSandboxId(grant.sandboxId) && typeof grant.sessionName === "string",
      allowedOrigins: this.options.allowedOrigins,
      isClosed: () => this.closed,
      server: this.terminalServer,
      onSocket: (ws, grant) => {
        this.trackRelay(ws);
        relayTerminal(ws, { terminal: this.terminal(grant.sandboxId), authorization: grant });
      },
    });
  }

  /**
   * Complete a browser's tunnel WebSocket upgrade: a byte-for-byte relay to a loopback port in the
   * sandbox, such as a VNC server. Tickets, Origin checks and status codes work as for
   * `handleTerminalUpgrade`. The browser may offer the `anvia.tunnel.v1` or `binary` subprotocol.
   */
  handleTunnelUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    handleBrowserUpgrade<TunnelAuthorization>(request, socket, head, {
      authorize: this.options.authorizeTunnel?.bind(this.options),
      valid: (grant) =>
        isSandboxId(grant.sandboxId) &&
        Number.isInteger(grant.port) &&
        grant.port >= 1 &&
        grant.port <= 65_535,
      allowedOrigins: this.options.allowedOrigins,
      isClosed: () => this.closed,
      server: this.tunnelServer,
      onSocket: (ws, grant) => {
        this.trackRelay(ws);
        relayTunnel(ws, { tunnel: this.tunnel(grant.sandboxId), authorization: grant });
      },
    });
  }

  /**
   * Complete a browser's desktop WebSocket upgrade: a VNC viewer relay with a JSON control channel.
   * Tickets, Origin checks and status codes work as for `handleTerminalUpgrade`. The browser may
   * offer the `anvia.desktop.v1` or `binary` subprotocol.
   */
  handleDesktopUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    handleBrowserUpgrade<DesktopAuthorization>(request, socket, head, {
      authorize: this.options.authorizeDesktop?.bind(this.options),
      valid: (grant) => isSandboxId(grant.sandboxId),
      allowedOrigins: this.options.allowedOrigins,
      isClosed: () => this.closed,
      server: this.desktopServer,
      onSocket: (ws, grant) => {
        this.trackRelay(ws);
        relayDesktop(ws, { desktop: this.desktop(grant.sandboxId), authorization: grant });
      },
    });
  }

  private trackRelay(ws: WebSocket): void {
    this.relays.add(ws);
    ws.once("close", () => this.relays.delete(ws));
  }

  /** Convenience HTTP listener for deployments with no existing server to attach to. */
  listen(options: RemoteSandboxHubListenOptions = {}): Promise<{ port: number }> {
    if (this.httpServer !== undefined) throw new Error("Hub is already listening.");
    const server = http.createServer((_, response) => {
      response.writeHead(426).end("Upgrade Required");
    });
    server.on("upgrade", (request, socket, head) => {
      const requested = new URL(request.url ?? "/", "http://hub").pathname;
      if (options.terminalPath !== undefined && requested === options.terminalPath) {
        return this.handleTerminalUpgrade(request, socket, head);
      }
      if (options.tunnelPath !== undefined && requested === options.tunnelPath) {
        return this.handleTunnelUpgrade(request, socket, head);
      }
      if (options.desktopPath !== undefined && requested === options.desktopPath) {
        return this.handleDesktopUpgrade(request, socket, head);
      }
      if (options.path !== undefined && requested !== options.path) {
        return rejectUpgrade(socket, 404, "Not Found");
      }
      this.handleUpgrade(request, socket, head);
    });
    this.httpServer = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, options.host, () => {
        server.off("error", reject);
        const address = server.address();
        resolve({ port: typeof address === "object" && address !== null ? address.port : 0 });
      });
    });
  }

  /** Drop every daemon connection and stop accepting new ones. Daemons will reconnect. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const relay of this.relays) relay.close(1001, "hub closing");
    for (const connection of this.connections.values()) connection.close(1001, "hub closing");
    for (const waiters of this.waiters.values()) for (const wake of waiters) wake();
    const httpServer = this.httpServer;
    if (httpServer !== undefined) {
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    await Promise.all([...this.connections.values()].map((connection) => connection.closed));
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await new Promise<void>((resolve) => this.terminalServer.close(() => resolve()));
    await new Promise<void>((resolve) => this.tunnelServer.close(() => resolve()));
    await new Promise<void>((resolve) => this.desktopServer.close(() => resolve()));
  }

  private accept(ws: WebSocket, sandboxId: string): void {
    ws.on("error", () => undefined);
    const timer = setTimeout(() => ws.close(1008, "handshake timeout"), this.handshakeTimeoutMs);
    timer.unref?.();
    ws.once("close", () => clearTimeout(timer));
    ws.once("message", (data) => {
      clearTimeout(timer);
      const hello = parseHello(data);
      if (hello === undefined) return ws.close(1002, "expected hello");
      if (hello.protocolVersion !== PROTOCOL_VERSION) {
        return ws.close(1002, `unsupported protocol ${hello.protocolVersion}`);
      }
      const welcome: HubFrame = {
        type: "welcome",
        protocolVersion: PROTOCOL_VERSION,
        heartbeatIntervalMs: this.heartbeatIntervalMs,
        capabilities:
          this.options.binaryData === false
            ? [terminalCapability, tunnelCapability]
            : [terminalCapability, tunnelCapability, binaryDataCapability],
      };
      ws.send(JSON.stringify(welcome));

      const connection = new HubConnection(
        ws,
        hello.workdir,
        this.heartbeatIntervalMs,
        new Set(hello.capabilities ?? []),
        {
          accepts: this.options.binaryData !== false,
          sends:
            this.options.binaryData !== false &&
            hello.capabilities?.includes(binaryDataCapability) === true,
        },
      );
      // A daemon that reconnects before the hub noticed the old socket die replaces it.
      this.connections.get(sandboxId)?.close(CLOSE_CODE_SUPERSEDED, "replaced by newer connection");
      this.connections.set(sandboxId, connection);
      this.lastWorkdirs.set(sandboxId, hello.workdir);
      void connection.closed.then(() => {
        if (this.connections.get(sandboxId) === connection) this.connections.delete(sandboxId);
      });
      const waiters = this.waiters.get(sandboxId);
      if (waiters !== undefined) for (const wake of waiters) wake();
    });
  }

  private async acquire(sandboxId: string, signal?: AbortSignal): Promise<HubConnection> {
    while (true) {
      signal?.throwIfAborted();
      const current = this.connections.get(sandboxId);
      if (current?.isOpen === true) return current;
      if (this.closed) throw unavailable(sandboxId, "the hub is closed");
      await this.waitForConnection(sandboxId, signal);
    }
  }

  private waitForConnection(sandboxId: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiters = this.waiters.get(sandboxId) ?? new Set();
      this.waiters.set(sandboxId, waiters);
      const cleanup = () => {
        clearTimeout(timer);
        waiters.delete(wake);
        if (waiters.size === 0) this.waiters.delete(sandboxId);
        signal?.removeEventListener("abort", abort);
      };
      const wake = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          unavailable(sandboxId, `its daemon did not connect within ${this.connectTimeoutMs}ms`),
        );
      }, this.connectTimeoutMs);
      waiters.add(wake);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

function unavailable(sandboxId: string, reason: string): DockerSandboxError {
  return new DockerSandboxError(
    `Sandbox ${sandboxId} is unavailable: ${reason}.`,
    "sandbox_unavailable",
  );
}

function isSandboxId(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

function parseHello(data: WebSocket.RawData) {
  try {
    const parsed = daemonFrameSchema.safeParse(JSON.parse(rawDataToString(data)));
    return parsed.success && parsed.data.type === "hello" ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
