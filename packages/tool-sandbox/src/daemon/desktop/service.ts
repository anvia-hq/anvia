import { DockerSandboxError } from "../../errors";
import type {
  DesktopAction,
  DesktopControl,
  DesktopStatus,
  MethodResult,
} from "../../remote/protocol";
import { DesktopControlLock } from "./control";
import { findExecutable, runTool } from "./exec";
import type { SandboxDaemonDesktopOptions } from "./options";
import { DesktopSupervisor, type ResolvedDesktopBinaries } from "./supervisor";

export interface DesktopServiceDeps {
  /** The environment desktop programs inherit: the daemon's, minus its credentials. */
  env: () => Record<string, string>;
  log: (message: string) => void;
}

const defaultResolution = { width: 1280, height: 800 };
const defaultMaxResolution = { width: 3840, height: 2160 };
const defaultDisplay = ":99";
const defaultVncPort = 5900;
const defaultStartTimeoutMs = 15_000;
const defaultTypeDelayMs = 12;
const buttons = { left: "1", middle: "2", right: "3" } as const;
const scrollButtons = { up: "4", down: "5", left: "6", right: "7" } as const;

/**
 * A desktop the agent can see and drive, and a human can take over. The pieces it runs are
 * supervised and start on first use; actions go through xdotool and screenshots through ImageMagick.
 */
export class DesktopService {
  private readonly supervisor: DesktopSupervisor;
  private readonly control: DesktopControlLock;
  private readonly binaries: ResolvedDesktopBinaries;
  /** Inputs run one at a time: xdotool sequences must not interleave. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    options: SandboxDaemonDesktopOptions,
    binaries: ResolvedDesktopBinaries,
    windowManager: string | undefined,
    deps: DesktopServiceDeps,
  ) {
    this.binaries = binaries;
    this.control = new DesktopControlLock(options.lock);
    this.supervisor = new DesktopSupervisor({
      binaries,
      windowManager,
      resolution: options.resolution ?? defaultResolution,
      maxResolution: options.maxResolution ?? defaultMaxResolution,
      display: options.display ?? defaultDisplay,
      vncPort: options.vncPort ?? defaultVncPort,
      startTimeoutMs: options.startTimeoutMs ?? defaultStartTimeoutMs,
      restart: options.restart ?? {},
      env: deps.env,
      log: deps.log,
    });
  }

  /**
   * Look for the programs a desktop needs. Returns undefined, and the names that are missing, when
   * it cannot run here, which is what decides whether the daemon offers the capability at all.
   */
  static async detect(
    options: SandboxDaemonDesktopOptions | undefined,
    deps: DesktopServiceDeps,
  ): Promise<{ service: DesktopService } | { missing: string[] }> {
    const searchPath = deps.env().PATH;
    const wanted = {
      xvfb: options?.binaries?.xvfb ?? "Xvfb",
      x11vnc: options?.binaries?.x11vnc ?? "x11vnc",
      xdotool: options?.binaries?.xdotool ?? "xdotool",
      xrandr: options?.binaries?.xrandr ?? "xrandr",
      import: options?.binaries?.import ?? "import",
    };
    const found: Partial<ResolvedDesktopBinaries> = {};
    const missing: string[] = [];
    for (const [key, name] of Object.entries(wanted) as Array<
      [keyof ResolvedDesktopBinaries, string]
    >) {
      const path = await findExecutable(name, searchPath);
      if (path === undefined) missing.push(name);
      else found[key] = path;
    }
    if (missing.length > 0) return { missing };

    // A window manager is optional: without one the desktop still works, windows just have no frame.
    const requested = options?.windowManager === undefined ? "openbox" : options.windowManager;
    let windowManager: string | undefined;
    if (requested !== false) {
      const [program = ""] = requested.split(/\s+/);
      if ((await findExecutable(program, searchPath)) !== undefined) windowManager = requested;
      else deps.log(`no window manager: ${program} was not found`);
    }
    return {
      service: new DesktopService(
        options ?? {},
        found as ResolvedDesktopBinaries,
        windowManager,
        deps,
      ),
    };
  }

  get vncPort(): number {
    return this.supervisor.status().vncPort;
  }

  async status(start = false): Promise<DesktopStatus> {
    if (start) await this.supervisor.ensureRunning();
    return { ...this.supervisor.status(), control: this.control.snapshot() };
  }

  async resize(width: number, height: number): Promise<DesktopStatus> {
    await this.supervisor.resize(width, height);
    return this.status();
  }

  async screenshot(
    scale: number | undefined,
    signal?: AbortSignal,
  ): Promise<MethodResult<"desktopScreenshot">> {
    await this.supervisor.ensureRunning();
    const { width: displayWidth, height: displayHeight } = this.supervisor.status();
    // No `-silent`: placed before `-resize` it makes ImageMagick's import ignore the resize.
    const args = ["-window", "root"];
    if (scale !== undefined && scale < 1) {
      const width = Math.max(1, Math.round(displayWidth * scale));
      const height = Math.max(1, Math.round(displayHeight * scale));
      args.push("-resize", `${width}x${height}!`);
    }
    const png = await this.onDisplay(() =>
      runTool(this.binaries.import, [...args, "png:-"], {
        env: this.supervisor.environment(),
        signal,
        timeoutMs: 20_000,
      }),
    );
    const size = pngSize(png);
    return { base64: png.toString("base64"), ...size, displayWidth, displayHeight };
  }

  async cursor(signal?: AbortSignal): Promise<{ x: number; y: number }> {
    await this.supervisor.ensureRunning();
    const output = await this.onDisplay(() =>
      runTool(this.binaries.xdotool, ["getmouselocation", "--shell"], {
        env: this.supervisor.environment(),
        signal,
      }),
    );
    const text = output.toString("utf8");
    const x = Number(/^X=(-?\d+)/m.exec(text)?.[1]);
    const y = Number(/^Y=(-?\d+)/m.exec(text)?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new DockerSandboxError("Could not read the cursor position.", "process");
    }
    return { x, y };
  }

  /** Perform an input as the agent. Fails with `desktop_locked` while a human holds control. */
  async act(action: DesktopAction, signal?: AbortSignal): Promise<void> {
    await this.control.assertAgentInput(signal);
    await this.supervisor.ensureRunning();
    const { width, height } = this.supervisor.status();
    const args = this.xdotoolArguments(action, width, height);
    await this.serialize(async () => {
      // The hold may have been taken while this action waited its turn.
      await this.control.assertAgentInput(signal);
      await this.onDisplay(() =>
        runTool(this.binaries.xdotool, args, {
          env: this.supervisor.environment(),
          signal,
          timeoutMs: action.type === "type" ? 15_000 + action.text.length * 25 : 15_000,
        }),
      );
    });
  }

  controlState(): DesktopControl {
    return this.control.snapshot();
  }

  takeover(holder: string, leaseMs?: number): DesktopControl {
    return this.control.takeover(holder, leaseMs);
  }

  release(holder?: string, force?: boolean): DesktopControl {
    return this.control.release(holder, force);
  }

  async stop(): Promise<void> {
    this.control.dispose();
    await this.supervisor.stop();
  }

  /**
   * Run something against the display. If the display crashed under it, the supervisor restarts it
   * and the call is repeated once: the crash came before the command could do anything.
   */
  private async onDisplay<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof DockerSandboxError && (await this.supervisor.recoveredFromCrash())) {
        return run();
      }
      throw error;
    }
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private xdotoolArguments(action: DesktopAction, width: number, height: number): string[] {
    const point = (x: number | undefined, y: number | undefined): string[] => {
      if (x === undefined && y === undefined) return [];
      if (x === undefined || y === undefined) {
        throw new RangeError("Give both x and y, or neither.");
      }
      assertOnScreen(x, y, width, height);
      return ["mousemove", String(x), String(y)];
    };
    switch (action.type) {
      case "mouse_move":
        assertOnScreen(action.x, action.y, width, height);
        return ["mousemove", String(action.x), String(action.y)];
      case "click":
        return [
          ...point(action.x, action.y),
          "click",
          "--repeat",
          String(action.count ?? 1),
          "--delay",
          "80",
          buttons[action.button ?? "left"],
        ];
      case "drag": {
        assertOnScreen(action.toX, action.toY, width, height);
        const button = buttons[action.button ?? "left"];
        return [
          ...point(action.fromX, action.fromY),
          "mousedown",
          button,
          "sleep",
          "0.05",
          "mousemove",
          String(action.toX),
          String(action.toY),
          "sleep",
          "0.05",
          "mouseup",
          button,
        ];
      }
      case "scroll":
        return [
          ...point(action.x, action.y),
          "click",
          "--repeat",
          String(action.amount ?? 3),
          scrollButtons[action.direction],
        ];
      case "type":
        return [
          "type",
          "--delay",
          String(action.delayMs ?? defaultTypeDelayMs),
          "--clearmodifiers",
          "--",
          action.text,
        ];
      case "key":
        return ["key", "--clearmodifiers", "--", ...action.keys.split(" ").filter(Boolean)];
    }
  }
}

function assertOnScreen(x: number, y: number, width: number, height: number): void {
  if (x >= width || y >= height) {
    throw new RangeError(
      `The point (${x}, ${y}) is outside the ${width}x${height} display; x is 0-${width - 1} and y is 0-${height - 1}.`,
    );
  }
}

/** Width and height from a PNG's header, so a screenshot reports what it actually is. */
function pngSize(png: Buffer): { width: number; height: number } {
  const signature = png.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" || png.byteLength < 24) {
    throw new DockerSandboxError("The screenshot was not a PNG.", "process");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
