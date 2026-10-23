/** What a {@link VncChannel} needs from the socket it wraps. */
export interface VncLink {
  send(data: ArrayBufferLike | ArrayBufferView): void;
  close(): void;
}

// WebSocket ready states, written out so this works wherever noVNC's own checks do.
const OPEN = 1;
const CLOSED = 3;

/**
 * A WebSocket-shaped channel for noVNC to attach to. The hub's desktop relay mixes binary VNC frames
 * with JSON control frames on one socket, and noVNC understands only the former, so the link
 * hands this channel just the binary ones.
 *
 * The VNC server speaks first, so frames can arrive before noVNC has attached. They wait here
 * until it installs its `onmessage`.
 *
 * noVNC checks a channel for these property names (`send`, `close`, `binaryType`, `onerror`,
 * `onmessage`, `onopen`, `protocol`, `readyState`), as it does for a WebSocket or an
 * RTCDataChannel, so they must all be present.
 */
export class VncChannel {
  binaryType = "arraybuffer";
  protocol: string;
  onerror: ((event: unknown) => void) | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  private handler: ((event: { data: ArrayBuffer }) => void) | null = null;
  private backlog: ArrayBuffer[] = [];
  private state = OPEN;

  constructor(
    private readonly link: VncLink,
    protocol = "",
  ) {
    this.protocol = protocol;
  }

  get readyState(): number {
    return this.state;
  }

  get onmessage(): ((event: { data: ArrayBuffer }) => void) | null {
    return this.handler;
  }

  set onmessage(handler: ((event: { data: ArrayBuffer }) => void) | null) {
    this.handler = handler;
    if (handler === null) return;
    for (const data of this.backlog.splice(0)) handler({ data });
  }

  send(data: ArrayBufferLike | ArrayBufferView): void {
    if (this.state === OPEN) this.link.send(data);
  }

  /** noVNC is done with the connection. */
  close(): void {
    if (this.state !== OPEN) return;
    this.state = CLOSED;
    this.link.close();
  }

  /** A VNC frame arrived from the relay. */
  receive(data: ArrayBuffer): void {
    if (this.handler === null) this.backlog.push(data);
    else this.handler({ data });
  }

  /** The relay closed the socket. */
  closed(event: { code: number; reason: string }): void {
    if (this.state === CLOSED) return;
    this.state = CLOSED;
    this.backlog = [];
    this.onclose?.(event);
  }
}
