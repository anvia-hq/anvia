// noVNC ships no types. This covers the part of its client API the viewer uses.
declare module "@novnc/novnc" {
  interface RfbChannel {
    send(data: ArrayBufferLike | ArrayBufferView): void;
    close(): void;
    binaryType: string;
    protocol: string;
    readonly readyState: number | string;
    onopen: ((event: unknown) => void) | null;
    onmessage: ((event: { data: ArrayBuffer }) => void) | null;
    onclose: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
  }

  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | RfbChannel,
      options?: {
        shared?: boolean;
        credentials?: { username?: string; password?: string; target?: string };
      },
    );
    /** Scale the remote desktop down or up to fit its container. */
    scaleViewport: boolean;
    /** Clip the desktop to the container instead of scrolling. */
    clipViewport: boolean;
    /** Ask the server to resize the desktop to fit. The hub never allows it. */
    resizeSession: boolean;
    /** Send no input. */
    viewOnly: boolean;
    /** JPEG quality asked of the server, 0 (smallest) to 9 (best). noVNC's own default is 6. */
    qualityLevel: number;
    /** Compression asked of the server, 0 (fastest, most data) to 9 (least data). Default 2. */
    compressionLevel: number;
    focusOnClick: boolean;
    background: string;
    disconnect(): void;
    focus(options?: FocusOptions): void;
    blur(): void;
  }
}
