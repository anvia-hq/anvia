import { vi } from "vitest";

/** A WebSocket the test drives by hand. Install it with `vi.stubGlobal("WebSocket", FakeSocket)`. */
export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  binaryType = "blob";
  protocol = "";
  readonly sent: Array<Record<string, unknown>> = [];
  /** Binary frames the viewer sent. */
  readonly sentBinary: unknown[] = [];
  closedWith: number | undefined;
  private readonly listeners = new Map<string, Array<(event: never) => void>>();

  constructor(
    readonly url: string,
    readonly protocols: string | string[] | undefined,
  ) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    if (typeof data === "string") this.sent.push(JSON.parse(data));
    else this.sentBinary.push(data);
  }

  close(code?: number): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.closedWith = code;
    this.readyState = FakeSocket.CLOSED;
    this.emit("close", { code: code ?? 1005, reason: "" });
  }

  /** The server accepted the upgrade. */
  serverOpen(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit("open", {});
  }

  serverMessage(message: Record<string, unknown>): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  serverOutput(bytes: Uint8Array): void {
    this.emit("message", { data: bytes.slice().buffer });
  }

  /** The link dropped, or the relay closed it with a reason. */
  serverClose(code = 1006, reason = ""): void {
    this.readyState = FakeSocket.CLOSED;
    this.emit("close", { code, reason });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }

  static get last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (socket === undefined) throw new Error("No socket was opened.");
    return socket;
  }
}

export function resetSockets(): void {
  FakeSocket.instances = [];
}

export class FakeXterm {
  static instances: FakeXterm[] = [];
  cols = 80;
  rows = 24;
  readonly written: Uint8Array[] = [];
  resets = 0;
  focused = 0;
  disposed = false;
  opened: HTMLElement | undefined;
  private dataListener: ((data: string) => void) | undefined;
  private resizeListener: ((size: { cols: number; rows: number }) => void) | undefined;

  constructor(readonly options: Record<string, unknown> = {}) {
    FakeXterm.instances.push(this);
  }

  loadAddon(): void {}
  open(element: HTMLElement): void {
    this.opened = element;
  }
  write(bytes: Uint8Array): void {
    this.written.push(bytes);
  }
  reset(): void {
    this.resets += 1;
  }
  focus(): void {
    this.focused += 1;
  }
  dispose(): void {
    this.disposed = true;
  }
  onData(listener: (data: string) => void) {
    this.dataListener = listener;
    return { dispose: vi.fn(() => (this.dataListener = undefined)) };
  }
  onResize(listener: (size: { cols: number; rows: number }) => void) {
    this.resizeListener = listener;
    return { dispose: vi.fn(() => (this.resizeListener = undefined)) };
  }

  /** The user typed. */
  type(data: string): void {
    this.dataListener?.(data);
  }
  /** xterm's size changed, as after a fit. */
  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.resizeListener?.({ cols, rows });
  }

  static get last(): FakeXterm {
    const term = FakeXterm.instances.at(-1);
    if (term === undefined) throw new Error("No terminal was created.");
    return term;
  }
}

export class FakeFit {
  static fits = 0;
  fit(): void {
    FakeFit.fits += 1;
  }
}

export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  disconnected = false;
  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  trigger(): void {
    this.callback();
  }
}

export function resetTerminals(): void {
  FakeXterm.instances = [];
  FakeFit.fits = 0;
  FakeResizeObserver.instances = [];
}
