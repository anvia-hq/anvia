import { DockerSandboxError } from "../errors";
import {
  type DesktopAction,
  type DesktopControl,
  type DesktopStatus,
  decodeBytes,
  desktopCapability,
} from "./protocol";
import { type RpcOptions, rpc } from "./rpc";
import type { RemoteLinkSource } from "./runtime";
import type { SandboxTunnel, TunnelHandle } from "./tunnel";

export type { DesktopAction, DesktopControl, DesktopStatus };

export interface DesktopCallOptions {
  abortSignal?: AbortSignal | undefined;
}

export interface DesktopInputOptions extends DesktopCallOptions {
  /** Makes the input run once even if the call is retried, as for other mutating calls. */
  operationId?: string | undefined;
}

export interface DesktopScreenshot {
  png: Uint8Array;
  /** Size of `png`. Smaller than the display when a scale was asked for. */
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
}

/** A virtual display in a sandbox: something to look at, drive, and hand to a person. */
export interface SandboxDesktop {
  /** Where the desktop is, without starting it. */
  status(options?: DesktopCallOptions): Promise<DesktopStatus>;
  /** Start it if it is not running (it starts on first use anyway) and wait until it is up. */
  start(options?: DesktopCallOptions): Promise<DesktopStatus>;
  /** Change the display size, up to `maxWidth` by `maxHeight`. Open windows stay open. */
  resize(width: number, height: number, options?: DesktopInputOptions): Promise<DesktopStatus>;
  screenshot(options?: DesktopCallOptions & { scale?: number }): Promise<DesktopScreenshot>;
  cursorPosition(options?: DesktopCallOptions): Promise<{ x: number; y: number }>;
  /** Perform an input as the agent. Fails with `desktop_locked` while a human has control. */
  act(action: DesktopAction, options?: DesktopInputOptions): Promise<void>;
  control(options?: DesktopCallOptions): Promise<DesktopControl>;
  /**
   * Take control for a human, pausing the agent's inputs until `release` or the lease runs out.
   * Call again before then to keep it. Fails with `desktop_locked` if someone else holds it.
   */
  takeover(
    options: { holder: string; leaseMs?: number } & DesktopInputOptions,
  ): Promise<DesktopControl>;
  release(
    options?: { holder?: string; force?: boolean } & DesktopInputOptions,
  ): Promise<DesktopControl>;
  /** A raw VNC connection to the desktop, starting it if needed. Mostly for the browser relay. */
  openViewer(options?: DesktopCallOptions): Promise<TunnelHandle>;
}

export interface RemoteSandboxDesktopOptions {
  id: string;
  source: RemoteLinkSource;
  tunnel: SandboxTunnel;
}

export class RemoteSandboxDesktop implements SandboxDesktop {
  constructor(private readonly options: RemoteSandboxDesktopOptions) {}

  status(options: DesktopCallOptions = {}): Promise<DesktopStatus> {
    return this.call("desktopStatus", {}, { signal: options.abortSignal });
  }

  start(options: DesktopCallOptions = {}): Promise<DesktopStatus> {
    return this.call("desktopStatus", { start: true }, { signal: options.abortSignal });
  }

  resize(width: number, height: number, options: DesktopInputOptions = {}): Promise<DesktopStatus> {
    return this.call("desktopResize", { width, height }, input(options));
  }

  async screenshot(
    options: DesktopCallOptions & { scale?: number } = {},
  ): Promise<DesktopScreenshot> {
    const result = await this.call(
      "desktopScreenshot",
      options.scale === undefined ? {} : { scale: options.scale },
      { signal: options.abortSignal },
    );
    return {
      png: decodeBytes(result.base64),
      width: result.width,
      height: result.height,
      displayWidth: result.displayWidth,
      displayHeight: result.displayHeight,
    };
  }

  cursorPosition(options: DesktopCallOptions = {}): Promise<{ x: number; y: number }> {
    return this.call("desktopCursor", {}, { signal: options.abortSignal });
  }

  async act(action: DesktopAction, options: DesktopInputOptions = {}): Promise<void> {
    await this.call("desktopAction", { action }, input(options));
  }

  control(options: DesktopCallOptions = {}): Promise<DesktopControl> {
    return this.call("desktopControl", {}, { signal: options.abortSignal });
  }

  takeover(
    options: { holder: string; leaseMs?: number } & DesktopInputOptions,
  ): Promise<DesktopControl> {
    return this.call(
      "desktopTakeover",
      options.leaseMs === undefined
        ? { holder: options.holder }
        : { holder: options.holder, leaseMs: options.leaseMs },
      input(options),
    );
  }

  release(
    options: { holder?: string; force?: boolean } & DesktopInputOptions = {},
  ): Promise<DesktopControl> {
    const params: { holder?: string; force?: boolean } = {};
    if (options.holder !== undefined) params.holder = options.holder;
    if (options.force !== undefined) params.force = options.force;
    return this.call("desktopRelease", params, input(options));
  }

  async openViewer(options: DesktopCallOptions = {}): Promise<TunnelHandle> {
    const status = await this.start(options);
    return this.options.tunnel.open(status.vncPort, {
      host: "127.0.0.1",
      abortSignal: options.abortSignal,
    });
  }

  private call<M extends Parameters<typeof rpc>[1]>(
    method: M,
    params: Parameters<typeof rpc<M>>[2],
    options: RpcOptions,
  ) {
    return rpc(this.options.source, method, params, {
      ...options,
      require: {
        capability: desktopCapability,
        error: () =>
          new DockerSandboxError(
            `Sandbox ${this.options.id} does not support a desktop. Its image needs Xvfb, ` +
              "x11vnc, xdotool and ImageMagick, and its daemon needs a version that supports it.",
            "unsupported",
          ),
      },
    });
  }
}

function input(options: DesktopInputOptions): RpcOptions {
  return { signal: options.abortSignal, operationId: options.operationId };
}
