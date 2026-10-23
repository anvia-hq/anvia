import type { VncChannel } from "../src/sandbox-desktop/vnc-channel";

/** A noVNC client the test can inspect. It attaches to its channel the way the real one does. */
export class FakeRfb {
  static instances: FakeRfb[] = [];
  scaleViewport = false;
  clipViewport = true;
  resizeSession = true;
  viewOnly = false;
  qualityLevel = -1;
  compressionLevel = -1;
  disconnected = false;
  focused = 0;
  /** VNC frames the channel delivered. */
  readonly received: ArrayBuffer[] = [];

  constructor(
    readonly target: HTMLElement,
    readonly channel: VncChannel,
  ) {
    FakeRfb.instances.push(this);
    channel.onmessage = (event) => this.received.push(event.data);
  }

  disconnect(): void {
    this.disconnected = true;
    this.channel.close();
  }

  focus(): void {
    this.focused += 1;
  }

  static get last(): FakeRfb {
    const rfb = FakeRfb.instances.at(-1);
    if (rfb === undefined) throw new Error("No noVNC client was created.");
    return rfb;
  }
}

export function resetRfb(): void {
  FakeRfb.instances = [];
}
