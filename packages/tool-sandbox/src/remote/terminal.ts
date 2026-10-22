import { randomUUID } from "node:crypto";
import { DockerSandboxError } from "../errors";
import { type HubConnection, LinkClosedError, type StreamEndpoint } from "./connection";
import { InboundStream } from "./inbound-stream";
import { rpc } from "./rpc";
import {
  type PtyExitReason,
  type TerminalSessionInfo,
  compact,
  encodeBytes,
  terminalCapability,
  terminalSessionNamePattern,
} from "./protocol";
import type { RemoteLinkSource } from "./runtime";

export interface TerminalOpenOptions {
  /** Letters, digits, `_` and `-`, up to 64 characters. Opening a name again attaches to it. */
  sessionName: string;
  cols: number;
  rows: number;
  /** Starting directory, relative to the sandbox workdir. Only used when the session is created. */
  cwd?: string | undefined;
  /** Extra environment, only used when the session is created. */
  env?: Readonly<Record<string, string>> | undefined;
  /** Output only: input and resize are ignored by the daemon. */
  readOnly?: boolean | undefined;
  abortSignal?: AbortSignal | undefined;
}

export type { TerminalSessionInfo };

export interface TerminalExit {
  /**
   * `exited`: the shell or tmux client ended. `closed`: {@link TerminalHandle.close} was called.
   * `killed`: the session was killed. `disconnected`: the daemon link dropped (a tmux session
   * survives it). `error`: the terminal was cut off, for example by a consumer that fell behind.
   */
  reason: PtyExitReason;
  exitCode?: number;
}

/** One viewer of a terminal session. */
export interface TerminalHandle {
  readonly sessionName: string;
  /** Send keystrokes. Ignored once the terminal has ended. */
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  /** Detach. A tmux session keeps running; use `kill` to end it. */
  close(): void;
  /**
   * Terminal output in order. Read it once. Output is acknowledged as you consume it, so a slow
   * reader slows the daemon rather than growing memory.
   */
  readonly output: AsyncIterable<Uint8Array>;
  /** Settles when the terminal ends. It never rejects. */
  readonly exit: Promise<TerminalExit>;
}

/** Interactive terminals in a sandbox. Not part of `SandboxRuntime`: only some backends have it. */
export interface SandboxTerminal {
  open(options: TerminalOpenOptions): Promise<TerminalHandle>;
  list(options?: {
    abortSignal?: AbortSignal | undefined;
  }): Promise<readonly TerminalSessionInfo[]>;
  /** End a session and everything running in it. */
  kill(sessionName: string, options?: { abortSignal?: AbortSignal | undefined }): Promise<void>;
}

export interface RemoteSandboxTerminalOptions {
  id: string;
  source: RemoteLinkSource;
  /** Unread output a handle may hold before it is cut off with `error`. Default 1 MiB. */
  maxBufferBytes?: number | undefined;
  /** How long `open` waits for the daemon to attach. Default 15 s. */
  openTimeoutMs?: number | undefined;
}

const defaultMaxBufferBytes = 1024 * 1024;
const defaultOpenTimeoutMs = 15_000;
const inputChunkBytes = 32 * 1024;

export class RemoteSandboxTerminal implements SandboxTerminal {
  private readonly maxBufferBytes: number;
  private readonly openTimeoutMs: number;

  constructor(private readonly options: RemoteSandboxTerminalOptions) {
    this.maxBufferBytes = options.maxBufferBytes ?? defaultMaxBufferBytes;
    this.openTimeoutMs = options.openTimeoutMs ?? defaultOpenTimeoutMs;
  }

  async open(options: TerminalOpenOptions): Promise<TerminalHandle> {
    assertSessionName(options.sessionName);
    assertSize(options.cols, options.rows);
    const connection = await this.options.source.acquire(options.abortSignal);
    this.assertSupported(connection);

    const ptyId = randomUUID();
    const handle = new RemoteTerminalHandle(
      ptyId,
      options.sessionName,
      connection,
      this.maxBufferBytes,
    );
    connection.registerPty(ptyId, handle.endpoint);
    try {
      connection.sendFrame({
        type: "pty.open",
        ptyId,
        sessionName: options.sessionName,
        cols: options.cols,
        rows: options.rows,
        ...compact({
          cwd: options.cwd,
          env: options.env === undefined ? undefined : { ...options.env },
          readOnly: options.readOnly,
        }),
      });
      await handle.opened(this.openTimeoutMs, options.abortSignal);
    } catch (error) {
      connection.unregisterPty(ptyId);
      if (error instanceof LinkClosedError) throw this.unavailable(error);
      throw error;
    }
    return handle;
  }

  async list(
    options: { abortSignal?: AbortSignal | undefined } = {},
  ): Promise<readonly TerminalSessionInfo[]> {
    const result = await rpc(
      this.options.source,
      "terminalList",
      {},
      {
        signal: options.abortSignal,
        require: this.requirement(),
      },
    );
    return result.sessions.map((session) => compact(session));
  }

  async kill(
    sessionName: string,
    options: { abortSignal?: AbortSignal | undefined } = {},
  ): Promise<void> {
    assertSessionName(sessionName);
    // Never repeated after a link loss: a second attempt would report the session as unknown,
    // hiding that the first one worked.
    await rpc(
      this.options.source,
      "terminalKill",
      { sessionName },
      {
        signal: options.abortSignal,
        require: this.requirement(),
        retry: false,
      },
    );
  }

  private requirement() {
    return { capability: terminalCapability, error: () => this.unsupported() };
  }

  private assertSupported(connection: HubConnection): void {
    if (!connection.capabilities.has(terminalCapability)) throw this.unsupported();
  }

  private unsupported(): DockerSandboxError {
    return new DockerSandboxError(
      `Sandbox ${this.options.id} does not support terminals. Its daemon needs node-pty ` +
        "installed (and tmux for persistent sessions), and a version that supports terminals.",
      "unsupported",
    );
  }

  private unavailable(cause?: LinkClosedError): DockerSandboxError {
    return new DockerSandboxError(
      `Sandbox ${this.options.id} connection dropped.`,
      "sandbox_unavailable",
      undefined,
      cause === undefined ? undefined : { cause },
    );
  }
}

class RemoteTerminalHandle implements TerminalHandle {
  readonly output: AsyncIterable<Uint8Array>;
  readonly exit: Promise<TerminalExit>;
  readonly endpoint: StreamEndpoint<TerminalExit>;
  private readonly stream: InboundStream<TerminalExit>;
  private settleOpen: { resolve: () => void; reject: (error: Error) => void } | undefined;

  constructor(
    private readonly ptyId: string,
    readonly sessionName: string,
    private readonly connection: HubConnection,
    maxBufferBytes: number,
  ) {
    this.stream = new InboundStream<TerminalExit>({
      maxBufferBytes,
      label: "Terminal",
      overflowEnd: { reason: "error" },
      onConsumed: (bytes) => this.trySend({ type: "pty.ack", ptyId, bytes }),
      onOverflow: () => this.trySend({ type: "pty.close", ptyId }),
      onEnd: () => this.connection.unregisterPty(ptyId),
    });
    this.output = this.stream.chunks;
    this.exit = this.stream.ended;
    this.endpoint = {
      opened: () => this.settleOpen?.resolve(),
      failed: (error) => this.settleOpen?.reject(error),
      output: (data) => this.stream.push(data),
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
        this.trySend({ type: "pty.close", ptyId: this.ptyId });
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup();
        this.trySend({ type: "pty.close", ptyId: this.ptyId });
        reject(new DockerSandboxError("Timed out opening the terminal.", "timeout"));
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

  write(data: string | Uint8Array): void {
    if (this.stream.endedWith !== undefined) return;
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    for (let start = 0; start < bytes.byteLength; start += inputChunkBytes) {
      this.trySend({
        type: "pty.input",
        ptyId: this.ptyId,
        data: encodeBytes(bytes.subarray(start, start + inputChunkBytes)),
      });
    }
  }

  resize(cols: number, rows: number): void {
    assertSize(cols, rows);
    if (this.stream.endedWith !== undefined) return;
    this.trySend({ type: "pty.resize", ptyId: this.ptyId, cols, rows });
  }

  close(): void {
    if (this.stream.endedWith !== undefined) return;
    this.trySend({ type: "pty.close", ptyId: this.ptyId });
    this.end({ reason: "closed" });
  }

  private end(info: TerminalExit): void {
    this.stream.end(info);
  }

  private trySend(frame: Parameters<HubConnection["sendFrame"]>[0]): void {
    try {
      this.connection.sendFrame(frame);
    } catch {
      // The link is down; the connection ends this terminal itself.
    }
  }
}

function assertSessionName(name: string): void {
  if (typeof name !== "string" || !terminalSessionNamePattern.test(name)) {
    throw new TypeError(
      "sessionName must use letters, digits, '_' and '-', at most 64 characters.",
    );
  }
}

function assertSize(cols: number, rows: number): void {
  for (const [label, value] of [
    ["cols", cols],
    ["rows", rows],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 1_000) {
      throw new RangeError(`${label} must be an integer from 1 to 1000.`);
    }
  }
}
