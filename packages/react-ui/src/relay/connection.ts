/** The prefix a ticket travels under in `Sec-WebSocket-Protocol`. */
export const ticketSubprotocolPrefix = "anvia.ticket.";

export type RelayState =
  /** The viewer library is still loading. */
  | "loading"
  | "connecting"
  | "open"
  /** The link dropped and another attempt is scheduled. */
  | "reconnecting"
  /** The session itself ended; reconnecting would not help. */
  | "ended"
  /** Gave up: a fatal error, or reconnect attempts ran out. */
  | "failed";

export interface RelayStatus {
  state: RelayState;
  /** Reconnect attempt number while `reconnecting`. */
  attempt?: number;
  /** Delay before the next attempt while `reconnecting`. */
  retryInMs?: number;
  /** Exit code when the session ended with one. */
  exitCode?: number;
  /** Human-readable cause for `ended` and `failed`. */
  message?: string;
}

export interface RelayReconnectOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Consecutive failed attempts before giving up. Default 10. */
  maxAttempts?: number;
}

/** What a relay protocol can tell the connection about the socket it is driving. */
export interface RelaySession {
  /**
   * The relay accepted this attachment. Returns whether an earlier attachment had also been
   * accepted, so a viewer knows to start clean after a reconnect.
   */
  ready(): boolean;
  /** The session itself is over, so the socket closing is not a reason to reconnect. */
  ended(info: { message?: string | undefined; exitCode?: number | undefined }): void;
  /** Something retrying cannot fix. It takes effect when the socket closes. */
  fatal(message: string): void;
}

/** The part of a relay connection that differs between a terminal and a desktop. */
export interface RelayProtocol {
  /** The subprotocol the hub's upgrade handler selects. */
  subprotocol: string;
  /** Names the thing in error messages: "terminal", "desktop". */
  label: string;
  /** The socket opened. */
  open(socket: WebSocket, session: RelaySession): void;
  message(event: MessageEvent, session: RelaySession): void;
  /** The socket closed. A protocol that learns why from the close frame can call `fatal` here. */
  close?(event: CloseEvent, session: RelaySession): void;
}

export interface RelayConnectionOptions {
  /** `ws:`, `wss:`, `http:`, `https:`, or a path relative to the page. */
  url: string;
  /** Appended as `?session=` so the server can pick the session. The server stays in charge. */
  sessionName?: string | undefined;
  /** Called for every attempt, because tickets are single use. */
  getTicket?: (() => string | Promise<string>) | undefined;
  onStatus: (status: RelayStatus) => void;
  reconnect?: RelayReconnectOptions | undefined;
  protocol: RelayProtocol;
}

const defaultInitialDelayMs = 500;
const defaultMaxDelayMs = 15_000;
const defaultMaxAttempts = 10;
/** Characters a ticket may use, since it travels as a WebSocket subprotocol (an HTTP token). */
const subprotocolToken = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * One browser link to a hub relay: opens the socket with a fresh ticket, reconnects with backoff,
 * and reports its state. What the socket carries is the protocol's business, so this knows nothing
 * about terminals or desktops and is shared by both.
 */
export class RelayConnection {
  private socketInUse: WebSocket | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private everReady = false;
  private disposed = false;
  private finished = false;
  private fatalMessage: string | undefined;

  constructor(private readonly options: RelayConnectionOptions) {}

  start(): void {
    void this.connect();
  }

  /** Try again now, for a link that gave up. */
  retry(): void {
    // Only a link that gave up needs this; otherwise an attempt is already under way.
    if (this.disposed || !this.finished) return;
    clearTimeout(this.timer);
    this.finished = false;
    this.attempt = 0;
    void this.connect();
  }

  /** Send a JSON message, if the socket is open. */
  sendJson(value: Record<string, unknown>): void {
    if (this.socketInUse?.readyState === WebSocket.OPEN) {
      this.socketInUse.send(JSON.stringify(value));
    }
  }

  /** Send bytes, if the socket is open. */
  sendBinary(data: ArrayBufferLike | ArrayBufferView): void {
    if (this.socketInUse?.readyState === WebSocket.OPEN) this.socketInUse.send(data);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    const socket = this.socketInUse;
    this.socketInUse = undefined;
    socket?.close(1000);
  }

  private async connect(): Promise<void> {
    if (this.disposed) return;
    const { label } = this.options.protocol;
    this.options.onStatus({ state: "connecting" });
    // A fatal error belongs to the attempt that hit it. Without this, one that was retried away
    // would fail every later drop.
    this.fatalMessage = undefined;

    let ticket: string | undefined;
    try {
      ticket = await this.options.getTicket?.();
    } catch (error) {
      // Fetching a ticket usually fails because the control plane is restarting, which is exactly
      // when reconnecting is wanted, so it backs off like a dropped socket.
      if (this.disposed) return;
      const detail = error instanceof Error ? `: ${error.message}` : "";
      this.scheduleReconnect(`Could not get a ${label} ticket${detail}`);
      return;
    }
    if (this.disposed) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.resolveUrl(), this.resolveProtocols(ticket));
    } catch (error) {
      // A bad URL or a malformed ticket: trying again cannot fix either.
      this.fail(error instanceof Error ? error.message : `Could not open the ${label}.`);
      return;
    }
    if (this.disposed) {
      socket.close(1000);
      return;
    }
    this.socketInUse = socket;
    socket.binaryType = "arraybuffer";

    const session: RelaySession = {
      ready: () => {
        const reconnected = this.everReady;
        this.everReady = true;
        this.attempt = 0;
        this.options.onStatus({ state: "open" });
        return reconnected;
      },
      ended: (info) => {
        this.finished = true;
        const status: RelayStatus = { state: "ended", message: info.message ?? "ended" };
        if (info.exitCode !== undefined) status.exitCode = info.exitCode;
        this.options.onStatus(status);
      },
      fatal: (message) => {
        this.fatalMessage = message;
      },
    };
    const { protocol } = this.options;
    socket.addEventListener("open", () => protocol.open(socket, session));
    socket.addEventListener("message", (event: MessageEvent) => protocol.message(event, session));
    socket.addEventListener("close", (event: CloseEvent) => {
      if (this.socketInUse === socket) this.socketInUse = undefined;
      protocol.close?.(event, session);
      if (this.disposed || this.finished) return;
      if (this.fatalMessage !== undefined) this.fail(this.fatalMessage);
      else this.scheduleReconnect();
    });
  }

  private scheduleReconnect(reason?: string): void {
    const { initialDelayMs, maxDelayMs, maxAttempts } = {
      initialDelayMs: defaultInitialDelayMs,
      maxDelayMs: defaultMaxDelayMs,
      maxAttempts: defaultMaxAttempts,
      ...this.options.reconnect,
    };
    if (this.attempt >= maxAttempts) {
      this.fail(reason ?? `The connection to the ${this.options.protocol.label} was lost.`);
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

  private resolveUrl(): string {
    const url = new URL(this.options.url, globalThis.location?.href);
    if (url.protocol === "http:") url.protocol = "ws:";
    else if (url.protocol === "https:") url.protocol = "wss:";
    if (this.options.sessionName !== undefined) {
      url.searchParams.set("session", this.options.sessionName);
    }
    return url.toString();
  }

  /** The subprotocols to offer: the relay's, plus the ticket when there is one. */
  private resolveProtocols(ticket: string | undefined): string[] {
    const { subprotocol, label } = this.options.protocol;
    if (ticket === undefined) return [subprotocol];
    if (!subprotocolToken.test(ticket)) {
      throw new Error(`The ${label} ticket must use only URL-safe characters (A-Z a-z 0-9 - _ .).`);
    }
    return [subprotocol, `${ticketSubprotocolPrefix}${ticket}`];
  }
}
