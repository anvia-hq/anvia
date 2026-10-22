/** Subprotocol the hub's `handleTerminalUpgrade` requires, and the prefix a ticket travels under. */
export const terminalSubprotocol = "anvia.terminal.v1";
export const ticketSubprotocolPrefix = "anvia.ticket.";

export type SandboxTerminalState =
  /** xterm is still loading. */
  | "loading"
  | "connecting"
  | "open"
  /** The link dropped and another attempt is scheduled. */
  | "reconnecting"
  /** The terminal session itself ended; reconnecting would not help. */
  | "ended"
  /** Gave up: a fatal error, or reconnect attempts ran out. */
  | "failed";

export interface SandboxTerminalStatus {
  state: SandboxTerminalState;
  /** Reconnect attempt number while `reconnecting`. */
  attempt?: number;
  /** Delay before the next attempt while `reconnecting`. */
  retryInMs?: number;
  /** Exit code when the shell ended with one. */
  exitCode?: number;
  /** Human-readable cause for `ended` and `failed`. */
  message?: string;
}

export interface SandboxTerminalReconnectOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Consecutive failed attempts before giving up. Default 10. */
  maxAttempts?: number;
}

export interface TerminalConnectionOptions {
  /** `ws:`, `wss:`, `http:`, `https:`, or a path relative to the page. */
  url: string;
  /** Appended as `?session=` so the server can pick the session. The server stays in charge. */
  sessionName?: string | undefined;
  /** Called for every attempt, because tickets are single use. */
  getTicket?: (() => string | Promise<string>) | undefined;
  size: () => { cols: number; rows: number };
  onOutput: (bytes: Uint8Array) => void;
  /** The terminal is attached. `reconnected` is true when an earlier attachment existed. */
  onOpen: (reconnected: boolean) => void;
  onStatus: (status: SandboxTerminalStatus) => void;
  reconnect?: SandboxTerminalReconnectOptions | undefined;
}

const defaultInitialDelayMs = 500;
const defaultMaxDelayMs = 15_000;
const defaultMaxAttempts = 10;
/** Errors worth another attempt: the sandbox may simply not be reachable yet. */
const retryableCodes = new Set(["sandbox_unavailable", "timeout"]);
/** Characters a ticket may use, since it travels as a WebSocket subprotocol (an HTTP token). */
const subprotocolToken = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

type ServerMessage =
  | { type: "ready"; readOnly?: boolean }
  | { type: "exit"; reason?: string; exitCode?: number }
  | { type: "error"; code?: string; message?: string };

/**
 * One browser terminal link: speaks the hub's relay protocol, reconnects with backoff, and tells
 * the owner what state it is in. It knows nothing about xterm, so it is testable on its own.
 */
export class TerminalConnection {
  private socket: WebSocket | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private everOpen = false;
  private disposed = false;
  private finished = false;
  private fatalMessage: string | undefined;

  constructor(private readonly options: TerminalConnectionOptions) {}

  start(): void {
    void this.connect();
  }

  /** Try again now, for a link that gave up. */
  retry(): void {
    if (this.disposed || this.socket !== undefined) return;
    clearTimeout(this.timer);
    this.finished = false;
    this.attempt = 0;
    void this.connect();
  }

  sendInput(data: string): void {
    this.sendJson({ type: "input", data });
  }

  sendResize(cols: number, rows: number): void {
    this.sendJson({ type: "resize", cols, rows });
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000);
  }

  private async connect(): Promise<void> {
    if (this.disposed) return;
    this.options.onStatus({ state: "connecting" });
    let socket: WebSocket;
    try {
      socket = new WebSocket(await this.resolveUrl(), await this.resolveProtocols());
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Could not open the terminal.");
      return;
    }
    if (this.disposed) {
      socket.close(1000);
      return;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    let ready = false;

    socket.addEventListener("open", () => {
      const { cols, rows } = this.options.size();
      socket.send(JSON.stringify({ type: "open", cols, rows }));
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        if (ready) this.options.onOutput(new Uint8Array(event.data as ArrayBuffer));
        return;
      }
      const message = parseMessage(event.data);
      if (message === undefined) return;
      if (message.type === "ready") {
        ready = true;
        this.attempt = 0;
        this.options.onOpen(this.everOpen);
        this.everOpen = true;
        this.options.onStatus({ state: "open" });
      } else if (message.type === "exit") {
        this.finished = true;
        const status: SandboxTerminalStatus = {
          state: "ended",
          message: message.reason ?? "exited",
        };
        if (message.exitCode !== undefined) status.exitCode = message.exitCode;
        this.options.onStatus(status);
      } else if (!retryableCodes.has(message.code ?? "")) {
        this.fatalMessage = message.message ?? "The terminal could not be opened.";
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = undefined;
      if (this.disposed || this.finished) return;
      if (this.fatalMessage !== undefined) this.fail(this.fatalMessage);
      else this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    const { initialDelayMs, maxDelayMs, maxAttempts } = {
      initialDelayMs: defaultInitialDelayMs,
      maxDelayMs: defaultMaxDelayMs,
      maxAttempts: defaultMaxAttempts,
      ...this.options.reconnect,
    };
    if (this.attempt >= maxAttempts) {
      this.fail("The connection to the terminal was lost.");
      return;
    }
    const delay =
      Math.min(maxDelayMs, initialDelayMs * 2 ** this.attempt) * (0.8 + Math.random() * 0.4);
    this.attempt += 1;
    this.options.onStatus({
      state: "reconnecting",
      attempt: this.attempt,
      retryInMs: Math.round(delay),
    });
    this.timer = setTimeout(() => void this.connect(), delay);
  }

  private fail(message: string): void {
    this.finished = true;
    this.options.onStatus({ state: "failed", message });
  }

  private sendJson(value: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }

  private async resolveUrl(): Promise<string> {
    const url = new URL(this.options.url, globalThis.location?.href);
    if (url.protocol === "http:") url.protocol = "ws:";
    else if (url.protocol === "https:") url.protocol = "wss:";
    if (this.options.sessionName !== undefined) {
      url.searchParams.set("session", this.options.sessionName);
    }
    return url.toString();
  }

  private async resolveProtocols(): Promise<string[]> {
    const ticket = await this.options.getTicket?.();
    if (ticket === undefined) return [terminalSubprotocol];
    if (!subprotocolToken.test(ticket)) {
      throw new Error("The terminal ticket must use only URL-safe characters (A-Z a-z 0-9 - _ .).");
    }
    return [terminalSubprotocol, `${ticketSubprotocolPrefix}${ticket}`];
  }
}

function parseMessage(text: string): ServerMessage | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return undefined;
    const type = (value as { type?: unknown }).type;
    return type === "ready" || type === "exit" || type === "error"
      ? (value as ServerMessage)
      : undefined;
  } catch {
    return undefined;
  }
}
