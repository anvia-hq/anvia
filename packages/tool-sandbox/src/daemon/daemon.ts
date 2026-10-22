import path from "node:path";
import WebSocket from "ws";
import {
  CLOSE_CODE_SUPERSEDED,
  PROTOCOL_VERSION,
  type RequestFrame,
  decodeBytes,
  decodeInput,
  encodeBytes,
  encodeError,
  encodeExecResult,
  encodeProcessLogs,
  compact,
  hubFrameSchema,
  mutatingMethods,
  rawDataToString,
  terminalCapability,
  terminalTmuxCapability,
  tunnelCapability,
  type DaemonFrame,
} from "../remote/protocol";
import type { SandboxExecOptions, SandboxRuntimeLimits } from "../types";
import { LocalSandbox } from "./local-sandbox";
import { OperationStore, defaultMaxOperationEntries } from "./operations";
import { ConnectionTerminals } from "./terminal/connection-terminals";
import { TerminalManager, detectTmux } from "./terminal/manager";
import type { SandboxDaemonTerminalOptions } from "./terminal/options";
import { loadNodePty } from "./terminal/pty";
import { ConnectionTunnels, type SandboxDaemonTunnelOptions } from "./tunnels";

export type { SandboxDaemonTerminalOptions, SandboxDaemonTunnelOptions };

export type SandboxDaemonLogLevel = "info" | "warn" | "error";

export interface SandboxDaemonOptions {
  /** `ws://` or `wss://` URL of the control plane's hub endpoint. */
  controlUrl: string;
  /** Credential presented to the hub's `authorize`. Never logged and never given to commands. */
  token: string;
  /** Absolute directory file operations are confined to and commands start in. */
  workdir: string;
  /** Directory for the operation dedup table. Keep it outside `workdir`. */
  stateDir: string;
  limits?: SandboxRuntimeLimits;
  /**
   * Interactive terminals. Offered automatically when `node-pty` can be loaded; pass false to
   * turn them off.
   */
  terminal?: false | SandboxDaemonTerminalOptions;
  /**
   * Raw TCP tunnels to loopback ports in the sandbox, for viewers such as a browser relay. On by
   * default; pass false to turn them off, or `allowedPorts` to restrict which ports they reach.
   */
  tunnel?: false | SandboxDaemonTunnelOptions;
  /** Extra environment for every command. */
  env?: Readonly<Record<string, string>>;
  /** Completed operations remembered for retries. Defaults to 256. */
  maxOperations?: number;
  /** Largest result kept on disk per operation; bigger ones make a retry fail. Default 256 KiB. */
  maxStoredResultBytes?: number;
  reconnect?: { initialDelayMs?: number; maxDelayMs?: number };
  handshakeTimeoutMs?: number;
  maxPayloadBytes?: number;
  version?: string;
  onLog?: (level: SandboxDaemonLogLevel, message: string) => void;
}

const defaultInitialDelayMs = 500;
const defaultMaxDelayMs = 30_000;
const defaultHandshakeTimeoutMs = 10_000;
const defaultMaxPayloadBytes = 64 * 1024 * 1024;

/**
 * Runs inside a sandbox. It dials out to the control plane, executes the operations it is sent,
 * and owns process state and logs, so a control-plane restart only has to reconnect.
 */
export class SandboxDaemon {
  private readonly sandbox: LocalSandbox;
  private readonly operations: OperationStore;
  private readonly stopController = new AbortController();
  private readonly readyWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> =
    [];
  private terminals: Promise<TerminalManager | undefined> | undefined;
  private session: DaemonSession | undefined;
  private loop: Promise<void> | undefined;
  private everConnected = false;

  constructor(private readonly options: SandboxDaemonOptions) {
    const url = new URL(options.controlUrl);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new TypeError("controlUrl must be a ws:// or wss:// URL.");
    }
    if (typeof options.token !== "string" || options.token.length === 0) {
      throw new TypeError("token must be a non-empty string.");
    }
    if (url.protocol === "ws:" && !isLoopback(url.hostname)) {
      this.log("warn", "controlUrl is not encrypted; the token is sent in clear text.");
    }
    this.sandbox = new LocalSandbox({
      workdir: options.workdir,
      limits: options.limits,
      env: options.env,
    });
    this.operations = new OperationStore({
      directory: path.join(options.stateDir, "operations"),
      maxEntries: options.maxOperations ?? defaultMaxOperationEntries,
      maxStoredResultBytes: options.maxStoredResultBytes,
      onError: (error) => this.log("warn", `operation store: ${describe(error)}`),
    });
  }

  get connected(): boolean {
    return this.session?.ready === true;
  }

  /** Begin connecting. Returns immediately; use `ready()` to await the first handshake. */
  start(): void {
    this.loop ??= this.run();
  }

  /** Resolves after the first successful handshake with the control plane. */
  ready(): Promise<void> {
    if (this.everConnected) return Promise.resolve();
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
  }

  async stop(): Promise<void> {
    this.stopController.abort();
    this.session?.close();
    for (const waiter of this.readyWaiters.splice(0)) {
      waiter.reject(new Error("Sandbox daemon stopped before connecting."));
    }
    await this.loop;
    (await this.terminals)?.dispose();
    await this.sandbox.dispose();
  }

  private async run(): Promise<void> {
    const initial = this.options.reconnect?.initialDelayMs ?? defaultInitialDelayMs;
    const max = this.options.reconnect?.maxDelayMs ?? defaultMaxDelayMs;
    let failures = 0;
    while (!this.stopController.signal.aborted) {
      try {
        const session = await this.connect();
        failures = 0;
        this.session = session;
        this.everConnected = true;
        for (const waiter of this.readyWaiters.splice(0)) waiter.resolve();
        this.log("info", "connected to control plane");
        const closeCode = await session.closed;
        this.log("info", "disconnected from control plane");
        if (closeCode === CLOSE_CODE_SUPERSEDED) {
          // Reconnecting would only evict the daemon that replaced this one, and so on forever.
          this.log("error", "another daemon took over this sandbox; not reconnecting");
          break;
        }
      } catch (error) {
        this.log("warn", `connection failed: ${describe(error)}`);
      }
      this.session = undefined;
      if (this.stopController.signal.aborted) break;
      const delay = Math.min(max, initial * 2 ** Math.min(failures, 16));
      failures += 1;
      await sleep(delay * (0.8 + Math.random() * 0.4), this.stopController.signal);
    }
  }

  /** Look for a PTY backend and tmux once; the result decides what `hello` advertises. */
  private detectTerminals(): Promise<TerminalManager | undefined> {
    this.terminals ??= (async () => {
      const config = this.options.terminal;
      if (config === false) return undefined;
      const spawn = config?.spawn ?? (await loadNodePty());
      if (spawn === undefined) {
        this.log("info", "terminals unavailable: node-pty is not installed");
        return undefined;
      }
      const tmuxPath =
        config?.tmuxPath === false ? undefined : await detectTmux(config?.tmuxPath ?? "tmux");
      this.log("info", `terminals enabled (${tmuxPath === undefined ? "plain shell" : "tmux"})`);
      return new TerminalManager({
        spawn,
        tmuxPath,
        socketName: config?.socketName,
        scrollbackBytes: config?.scrollbackBytes,
        maxSessions: config?.maxSessions,
        commandEnv: () => this.sandbox.commandEnvironment(),
      });
    })();
    return this.terminals;
  }

  private async connect(): Promise<DaemonSession> {
    const terminals = await this.detectTerminals();
    return this.dial(terminals);
  }

  private dial(terminals: TerminalManager | undefined): Promise<DaemonSession> {
    // Detection above is asynchronous, so a stop() may already have happened; its abort event
    // would never reach a listener added now.
    if (this.stopController.signal.aborted) {
      return Promise.reject(new Error("Sandbox daemon stopped."));
    }
    const handshakeTimeoutMs = this.options.handshakeTimeoutMs ?? defaultHandshakeTimeoutMs;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.controlUrl, {
        headers: { authorization: `Bearer ${this.options.token}` },
        maxPayload: this.options.maxPayloadBytes ?? defaultMaxPayloadBytes,
        handshakeTimeout: handshakeTimeoutMs,
      });
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.terminate();
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new Error("Timed out waiting for the control plane to accept the connection.")),
        handshakeTimeoutMs,
      );
      timer.unref?.();
      const stop = () => fail(new Error("Sandbox daemon stopped."));
      this.stopController.signal.addEventListener("abort", stop, { once: true });

      socket.once("unexpected-response", (_request, response) => {
        fail(new Error(`Control plane rejected the connection (HTTP ${response.statusCode}).`));
      });
      socket.once("error", (error) => fail(error));
      socket.once("close", () => fail(new Error("Connection closed during handshake.")));
      socket.once("open", () => {
        const hello: DaemonFrame = {
          type: "hello",
          protocolVersion: PROTOCOL_VERSION,
          daemonVersion: this.options.version ?? "unknown",
          workdir: this.sandbox.workdir,
        };
        const capabilities: string[] = [];
        if (terminals !== undefined) {
          capabilities.push(terminalCapability);
          if (terminals.persistent) capabilities.push(terminalTmuxCapability);
        }
        if (this.options.tunnel !== false) capabilities.push(tunnelCapability);
        if (capabilities.length > 0) hello.capabilities = capabilities;
        socket.send(JSON.stringify(hello));
      });
      socket.once("message", (data) => {
        if (settled) return;
        const frame = parseHubFrame(data);
        if (frame?.type !== "welcome" || frame.protocolVersion !== PROTOCOL_VERSION) {
          fail(
            new Error(
              frame?.type === "welcome"
                ? `Control plane speaks protocol ${frame.protocolVersion}, expected ${PROTOCOL_VERSION}.`
                : "Control plane sent an unexpected handshake frame.",
            ),
          );
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.stopController.signal.removeEventListener("abort", stop);
        socket.removeAllListeners("close");
        socket.removeAllListeners("error");
        socket.removeAllListeners("unexpected-response");
        resolve(
          new DaemonSession(socket, frame.heartbeatIntervalMs, {
            sandbox: this.sandbox,
            operations: this.operations,
            terminals,
            terminalOptions: this.options.terminal === false ? undefined : this.options.terminal,
            tunnelOptions: this.options.tunnel === false ? undefined : this.options.tunnel,
            tunnelsEnabled: this.options.tunnel !== false,
            log: (level, message) => this.log(level, message),
          }),
        );
      });
    });
  }

  private log(level: SandboxDaemonLogLevel, message: string): void {
    this.options.onLog?.(level, message);
  }
}

interface SessionDependencies {
  sandbox: LocalSandbox;
  operations: OperationStore;
  terminals: TerminalManager | undefined;
  terminalOptions: SandboxDaemonTerminalOptions | undefined;
  tunnelOptions: SandboxDaemonTunnelOptions | undefined;
  tunnelsEnabled: boolean;
  log: (level: SandboxDaemonLogLevel, message: string) => void;
}

/** One live connection. Dies with the socket; all durable state lives in the dependencies. */
class DaemonSession {
  ready = true;
  readonly closed: Promise<number>;
  private readonly active = new Map<string, { controller: AbortController; detachable: boolean }>();
  private readonly terminals: ConnectionTerminals;
  private readonly tunnels: ConnectionTunnels;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private lastSeen = Date.now();

  constructor(
    private readonly socket: WebSocket,
    heartbeatIntervalMs: number,
    private readonly deps: SessionDependencies,
  ) {
    this.terminals = new ConnectionTerminals({
      terminals: deps.terminals,
      sandbox: deps.sandbox,
      options: deps.terminalOptions,
      send: (frame) => this.send(frame),
      bufferedAmount: () => socket.bufferedAmount,
    });
    this.tunnels = new ConnectionTunnels({
      enabled: deps.tunnelsEnabled,
      options: deps.tunnelOptions,
      send: (frame) => this.send(frame),
      bufferedAmount: () => socket.bufferedAmount,
    });
    this.closed = new Promise((resolve) => {
      socket.once("close", (code) => {
        this.ready = false;
        clearInterval(this.heartbeat);
        // A request that has an operationId keeps running: the control plane retries it with the
        // same id after reconnecting and gets the result. Anything else has no one to answer to.
        for (const { controller, detachable } of this.active.values()) {
          if (!detachable) controller.abort(new DOMException("Connection closed", "AbortError"));
        }
        // Viewers belong to the connection that opened them. tmux sessions themselves persist.
        this.terminals.dispose();
        this.tunnels.dispose();
        resolve(code);
      });
    });
    socket.on("error", (error) => deps.log("warn", `socket error: ${describe(error)}`));
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

  close(): void {
    this.socket.close(1000, "daemon stopping");
    // Do not wait on a peer that never answers the close handshake.
    setTimeout(() => this.socket.terminate(), 1_000).unref?.();
  }

  private send(frame: DaemonFrame): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(frame));
  }

  private onMessage(data: WebSocket.RawData): void {
    const frame = parseHubFrame(data);
    if (frame === undefined) {
      // Answer under the caller's requestId when one can be recovered (an unknown method from a
      // newer hub, say), so that call fails fast instead of waiting on a link that stays healthy.
      this.send(encodeError(new TypeError("Malformed frame."), recoverRequestId(data)));
      return;
    }
    switch (frame.type) {
      case "ping":
        this.send({ type: "pong" });
        return;
      case "cancel":
        this.active
          .get(frame.requestId)
          ?.controller.abort(new DOMException("Cancelled", "AbortError"));
        return;
      case "request":
        void this.handle(frame);
        return;
      case "pty.open":
        void this.terminals.open(frame);
        return;
      case "pty.input":
        this.terminals.input(frame.ptyId, frame.data);
        return;
      case "pty.resize":
        this.terminals.resize(frame.ptyId, frame.cols, frame.rows);
        return;
      case "pty.ack":
        this.terminals.ack(frame.ptyId, frame.bytes);
        return;
      case "pty.close":
        this.terminals.close(frame.ptyId);
        return;
      case "tunnel.open":
        void this.tunnels.open(frame);
        return;
      case "tunnel.data":
        this.tunnels.data(frame.tunnelId, frame.data);
        return;
      case "tunnel.ack":
        this.tunnels.ack(frame.tunnelId, frame.bytes);
        return;
      case "tunnel.close":
        this.tunnels.close(frame.tunnelId);
        return;
      default:
        return;
    }
  }

  private async handle(frame: RequestFrame): Promise<void> {
    const { requestId, method } = frame;
    const controller = new AbortController();
    const operationId = mutatingMethods.has(method) ? frame.operationId : undefined;
    this.active.set(requestId, { controller, detachable: operationId !== undefined });
    try {
      const execute = () => this.dispatch(frame, controller.signal);
      const result =
        operationId === undefined
          ? await execute()
          : await this.deps.operations.run(operationId, { method, params: frame.params }, execute, {
              // Process state lives in daemon memory, so a restart must not replay these.
              durable: method !== "startProcess" && method !== "stopProcess",
            });
      this.send({ type: "response", requestId, result });
    } catch (error) {
      // A cancelled caller has already stopped listening.
      if (!controller.signal.aborted) this.send(encodeError(error, requestId));
    } finally {
      this.active.delete(requestId);
    }
  }

  private async dispatch(frame: RequestFrame, abortSignal: AbortSignal): Promise<unknown> {
    const { sandbox } = this.deps;
    switch (frame.method) {
      case "exec":
        return encodeExecResult(await sandbox.exec(execOptions(frame.params, abortSignal)));
      case "execStream": {
        let seq = 0;
        const emit = (stream: "stdout" | "stderr") => (chunk: Uint8Array) =>
          this.send({
            type: "stream",
            requestId: frame.requestId,
            seq: seq++,
            stream,
            data: encodeBytes(chunk),
          });
        return encodeExecResult(
          await sandbox.exec(execOptions(frame.params, abortSignal), {
            onStdout: emit("stdout"),
            onStderr: emit("stderr"),
          }),
        );
      }
      case "readFile":
        return { base64: encodeBytes(await sandbox.readFile({ ...frame.params, abortSignal })) };
      case "readTextFilePage":
        return sandbox.readTextFilePage(compact({ ...frame.params, abortSignal }));
      case "writeFile":
        await sandbox.writeFile({
          path: frame.params.path,
          data: decodeBytes(frame.params.base64),
          abortSignal,
        });
        return {};
      case "listFiles":
        return { entries: await sandbox.listFiles(compact({ ...frame.params, abortSignal })) };
      case "startProcess":
        return sandbox.startProcess(compact({ ...frame.params, abortSignal }));
      case "listProcesses":
        return { processes: await sandbox.listProcesses() };
      case "readProcessLogs":
        return encodeProcessLogs(await sandbox.readProcessLogs(compact(frame.params)));
      case "stopProcess":
        return sandbox.stopProcess(compact({ ...frame.params, abortSignal }));
      case "waitForPort":
        return sandbox.waitForPort(compact({ ...frame.params, abortSignal }));
      case "terminalList":
        return { sessions: await this.terminals.require().list() };
      case "terminalKill":
        await this.terminals.require().kill(frame.params.sessionName);
        return {};
    }
  }
}

function execOptions(
  params: Extract<RequestFrame, { method: "exec" }>["params"],
  abortSignal: AbortSignal,
): SandboxExecOptions {
  let options: SandboxExecOptions = { command: params.command, abortSignal };
  if (params.args !== undefined) options = { ...options, args: params.args };
  if (params.cwd !== undefined) options = { ...options, cwd: params.cwd };
  if (params.env !== undefined) options = { ...options, env: params.env };
  if (params.timeoutMs !== undefined) options = { ...options, timeoutMs: params.timeoutMs };
  const input = decodeInput(params.input);
  if (input !== undefined) options = { ...options, input };
  return options;
}

function parseHubFrame(data: WebSocket.RawData) {
  try {
    const parsed = hubFrameSchema.safeParse(JSON.parse(rawDataToString(data)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The id a caller is waiting under, for a frame that failed validation: the `requestId` of a
 * request, or the id a terminal or tunnel open is keyed by. Without it the caller would wait
 * forever on a link that stays healthy.
 */
function recoverRequestId(data: WebSocket.RawData): string | undefined {
  try {
    const value: unknown = JSON.parse(rawDataToString(data));
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    const id =
      record.type === "request"
        ? record.requestId
        : record.type === "pty.open"
          ? record.ptyId
          : record.type === "tunnel.open"
            ? record.tunnelId
            : undefined;
    return typeof id === "string" && id.length > 0 && id.length <= 128 ? id : undefined;
  } catch {
    return undefined;
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
