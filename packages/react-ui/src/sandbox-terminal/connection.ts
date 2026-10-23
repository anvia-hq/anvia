import {
  type RelayProtocol,
  type RelayReconnectOptions,
  type RelaySession,
  type RelayState,
  type RelayStatus,
  RelayConnection,
} from "../relay/connection";

export { ticketSubprotocolPrefix } from "../relay/connection";

/** Subprotocol the hub's `handleTerminalUpgrade` requires. */
export const terminalSubprotocol = "anvia.terminal.v1";

export type SandboxTerminalState = RelayState;
export type SandboxTerminalStatus = RelayStatus;
export type SandboxTerminalReconnectOptions = RelayReconnectOptions;

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

/** Errors worth another attempt: the sandbox may simply not be reachable yet. */
const retryableCodes = new Set(["sandbox_unavailable", "timeout"]);

type ServerMessage =
  | { type: "ready"; readOnly?: boolean }
  | { type: "exit"; reason?: string; exitCode?: number }
  | { type: "error"; code?: string; message?: string };

/**
 * One browser terminal link: speaks the hub's terminal relay protocol over a {@link
 * RelayConnection}. It knows nothing about xterm, so it is testable on its own.
 */
export class TerminalConnection {
  private readonly relay: RelayConnection;

  constructor(options: TerminalConnectionOptions) {
    // The relay only sends output once it has opened the terminal, which starts with our size.
    let ready = false;
    const protocol: RelayProtocol = {
      subprotocol: terminalSubprotocol,
      label: "terminal",
      open: (socket) => {
        ready = false;
        const { cols, rows } = options.size();
        socket.send(JSON.stringify({ type: "open", cols, rows }));
      },
      message: (event, session: RelaySession) => {
        if (typeof event.data !== "string") {
          if (ready) options.onOutput(new Uint8Array(event.data as ArrayBuffer));
          return;
        }
        const message = parseMessage(event.data);
        if (message === undefined) return;
        if (message.type === "ready") {
          ready = true;
          options.onOpen(session.ready());
        } else if (message.type === "exit") {
          session.ended({ message: message.reason ?? "exited", exitCode: message.exitCode });
        } else if (!retryableCodes.has(message.code ?? "")) {
          session.fatal(message.message ?? "The terminal could not be opened.");
        }
      },
    };
    this.relay = new RelayConnection({
      url: options.url,
      sessionName: options.sessionName,
      getTicket: options.getTicket,
      onStatus: options.onStatus,
      reconnect: options.reconnect,
      protocol,
    });
  }

  start(): void {
    this.relay.start();
  }

  /** Try again now, for a link that gave up. */
  retry(): void {
    this.relay.retry();
  }

  sendInput(data: string): void {
    this.relay.sendJson({ type: "input", data });
  }

  sendResize(cols: number, rows: number): void {
    this.relay.sendJson({ type: "resize", cols, rows });
  }

  dispose(): void {
    this.relay.dispose();
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
