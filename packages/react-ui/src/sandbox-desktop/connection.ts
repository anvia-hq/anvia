import {
  type RelayProtocol,
  type RelayReconnectOptions,
  type RelaySession,
  type RelayStatus,
  RelayConnection,
} from "../relay/connection";
import { VncChannel } from "./vnc-channel";

/** Subprotocol the hub's `handleDesktopUpgrade` selects. */
export const desktopSubprotocol = "anvia.desktop.v1";

/** Who is driving the desktop, as the relay reports it to this viewer. */
export interface SandboxDesktopControl {
  /** Someone has taken control, which pauses the agent. */
  held: boolean;
  /** Who. Present when `held`. */
  holder?: string;
  /** When the hold lapses unless renewed. */
  expiresAt?: string;
  /** This viewer is the holder. */
  you: boolean;
  /** This viewer may only watch. */
  readOnly: boolean;
}

export interface DesktopConnectionOptions {
  url: string;
  getTicket?: (() => string | Promise<string>) | undefined;
  reconnect?: RelayReconnectOptions | undefined;
  onStatus: (status: RelayStatus) => void;
  /** The relay accepted this attachment. Attach a VNC client to the channel. */
  onChannel: (channel: VncChannel, reconnected: boolean) => void;
  onControl: (control: SandboxDesktopControl) => void;
  /** A request over the control channel failed, such as taking over while someone else holds it. */
  onNotice?: ((notice: { code: string; message: string }) => void) | undefined;
}

/** Errors worth another attempt: the sandbox may simply not be reachable yet. */
const retryableCodes = new Set(["sandbox_unavailable", "timeout"]);
/** The hub closes a socket it could not set up with `<error code>: <message>`. */
const closeReason = /^([a-z_]+): (.*)$/s;
/** The relay closes with this code when the viewer sent something it could not account for. */
const policyViolation = 1008;

type ControlMessage = { type: "control" } & SandboxDesktopControl;
type ErrorMessage = { type: "error"; code?: string; message?: string };

/**
 * One browser link to the hub's desktop relay, over a {@link RelayConnection}. It hands each
 * accepted attachment to the owner as a channel for a VNC client, and speaks the relay's small
 * JSON control protocol (`takeover`, `release`, and the `control` updates that come back).
 */
export class DesktopConnection {
  private readonly relay: RelayConnection;

  constructor(options: DesktopConnectionOptions) {
    let channel: VncChannel | undefined;
    let accepted = false;
    const protocol: RelayProtocol = {
      subprotocol: desktopSubprotocol,
      label: "desktop",
      open: (socket) => {
        accepted = false;
        channel = new VncChannel(
          { send: (data) => socket.send(data), close: () => socket.close(1000) },
          socket.protocol,
        );
      },
      message: (event, session: RelaySession) => {
        // The first thing the relay sends means it set the viewer up; a failure closes instead.
        if (!accepted && channel !== undefined) {
          accepted = true;
          options.onChannel(channel, session.ready());
        }
        if (typeof event.data !== "string") {
          channel?.receive(event.data as ArrayBuffer);
          return;
        }
        const message = parseText(event.data);
        if (message?.type === "control") {
          const { type: _type, ...control } = message;
          options.onControl(control);
        } else if (message?.type === "error") {
          options.onNotice?.({
            code: message.code ?? "protocol",
            message: message.message ?? "The request failed.",
          });
        }
      },
      close: (event, session) => {
        channel?.closed(event);
        const match = closeReason.exec(event.reason);
        if (match !== null && !retryableCodes.has(match[1] ?? "")) {
          session.fatal(match[2] ?? "The desktop could not be opened.");
        } else if (event.code === policyViolation) {
          session.fatal(event.reason || "The desktop relay refused what the viewer sent.");
        }
      },
    };
    this.relay = new RelayConnection({
      url: options.url,
      getTicket: options.getTicket,
      onStatus: options.onStatus,
      reconnect: options.reconnect,
      protocol,
    });
  }

  start(): void {
    this.relay.start();
  }

  retry(): void {
    this.relay.retry();
  }

  /** Ask for control, which pauses the agent's inputs. The answer arrives as a `control` update. */
  takeOver(): void {
    this.relay.sendJson({ type: "takeover" });
  }

  release(): void {
    this.relay.sendJson({ type: "release" });
  }

  dispose(): void {
    this.relay.dispose();
  }
}

function parseText(text: string): ControlMessage | ErrorMessage | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return undefined;
    const type = (value as { type?: unknown }).type;
    return type === "control" || type === "error"
      ? (value as ControlMessage | ErrorMessage)
      : undefined;
  } catch {
    return undefined;
  }
}
