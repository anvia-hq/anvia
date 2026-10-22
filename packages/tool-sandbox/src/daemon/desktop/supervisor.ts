import { type ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import { DockerSandboxError } from "../../errors";
import type { DesktopState } from "../../remote/protocol";
import { runTool } from "./exec";
import type { DesktopResolution, SandboxDaemonDesktopOptions } from "./options";

export interface ResolvedDesktopBinaries {
  xvfb: string;
  x11vnc: string;
  xdotool: string;
  xrandr: string;
  import: string;
}

export interface DesktopSupervisorOptions {
  binaries: ResolvedDesktopBinaries;
  /** Window manager command line, or undefined to run without one. */
  windowManager: string | undefined;
  resolution: DesktopResolution;
  maxResolution: DesktopResolution;
  display: string;
  vncPort: number;
  startTimeoutMs: number;
  restart: NonNullable<SandboxDaemonDesktopOptions["restart"]>;
  /** The environment desktop programs inherit: the daemon's, minus its credentials. */
  env: () => Record<string, string>;
  log: (message: string) => void;
}

export interface SupervisorStatus {
  state: DesktopState;
  width: number;
  height: number;
  maxWidth: number;
  maxHeight: number;
  display: string;
  vncPort: number;
  restarts: number;
  message?: string;
}

type ProcessName = "xvfb" | "window manager" | "vnc";

interface Managed {
  name: ProcessName;
  child: ChildProcess;
  /** The tail of stderr, to say why something died. */
  stderr: string;
}

const defaultInitialDelayMs = 500;
const defaultMaxDelayMs = 10_000;
const defaultMaxFailures = 5;
/** A desktop that stayed up this long is healthy again, so earlier crashes stop counting. */
const stableAfterMs = 30_000;

/**
 * Runs the pieces of a desktop: Xvfb, a window manager, and x11vnc bound to loopback. Nothing
 * starts until something needs it. A crashed piece is restarted with backoff (Xvfb takes the others
 * down with it, since they hold its display), and after too many quick failures in a row it gives
 * up and reports why, until the next caller asks again.
 */
export class DesktopSupervisor {
  private state: DesktopState = "stopped";
  private message: string | undefined;
  private restarts = 0;
  private failures = 0;
  private lastUpAt = 0;
  private width: number;
  private height: number;
  private ready: Promise<void> | undefined;
  private stopping = false;
  private recovery: ReturnType<typeof setTimeout> | undefined;
  /** Fails whoever is waiting on a pending restart, when the supervisor stops first. */
  private abandonRecovery: (() => void) | undefined;
  private readonly processes = new Map<ProcessName, Managed>();

  constructor(private readonly options: DesktopSupervisorOptions) {
    this.width = options.resolution.width;
    this.height = options.resolution.height;
  }

  status(): SupervisorStatus {
    const status: SupervisorStatus = {
      state: this.state,
      width: this.width,
      height: this.height,
      maxWidth: this.options.maxResolution.width,
      maxHeight: this.options.maxResolution.height,
      display: this.options.display,
      vncPort: this.options.vncPort,
      restarts: this.restarts,
    };
    if (this.message !== undefined) status.message = this.message;
    return status;
  }

  /** Start the desktop if it is not up, and wait for it. Safe to call from many places at once. */
  ensureRunning(): Promise<void> {
    if (this.stopping) return Promise.reject(unavailable("The desktop is shutting down."));
    if (this.ready !== undefined) return this.ready;
    if (this.state === "running") return Promise.resolve();
    this.failures = 0;
    this.message = undefined;
    return this.bringUp("starting");
  }

  async resize(width: number, height: number): Promise<void> {
    const max = this.options.maxResolution;
    if (width > max.width || height > max.height) {
      throw new RangeError(`The desktop can be at most ${max.width}x${max.height}.`);
    }
    await this.ensureRunning();
    await this.applyMode(width, height);
    this.width = width;
    this.height = height;
  }

  /**
   * After a command failed: did the desktop crash under it, and is it back? A crashed process is
   * only noticed when its exit is reported, which can be a moment after the command already failed.
   */
  async recoveredFromCrash(): Promise<boolean> {
    const deadline = Date.now() + 2_000;
    while (this.state === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (this.state === "running") return false;
    try {
      await this.ensureRunning();
      return true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.recovery);
    this.abandonRecovery?.();
    await this.killAll();
    this.state = "stopped";
  }

  /** Where a desktop program should draw. */
  environment(): Record<string, string> {
    return { ...this.options.env(), DISPLAY: this.options.display };
  }

  private bringUp(state: "starting" | "restarting"): Promise<void> {
    this.state = state;
    const attempt = this.startStack().then(
      () => {
        this.state = "running";
        this.lastUpAt = Date.now();
        this.ready = undefined;
      },
      async (error: unknown) => {
        this.ready = undefined;
        await this.killAll();
        this.state = "failed";
        this.message = error instanceof Error ? error.message : String(error);
        throw error;
      },
    );
    this.ready = attempt;
    attempt.catch(() => undefined);
    return attempt;
  }

  private async startStack(): Promise<void> {
    const { options } = this;
    const { width, height } = options.maxResolution;
    const xvfb = this.launch("xvfb", options.binaries.xvfb, [
      options.display,
      "-screen",
      "0",
      `${width}x${height}x24`,
      "+extension",
      "RANDR",
      "-nolisten",
      "tcp",
      "-noreset",
    ]);
    await this.waitForDisplay(xvfb);
    await this.applyMode(this.width, this.height);
    if (options.windowManager !== undefined) {
      const [file = "", ...args] = options.windowManager.split(/\s+/).filter(Boolean);
      this.launch("window manager", file, args);
    }
    await this.startVnc();
  }

  private async startVnc(): Promise<void> {
    const vnc = this.launch("vnc", this.options.binaries.x11vnc, [
      "-display",
      this.options.display,
      // No password: it listens on loopback only, so it is reachable through a tunnel and nothing else.
      "-localhost",
      "-rfbport",
      String(this.options.vncPort),
      "-nopw",
      "-forever",
      "-shared",
      "-noxdamage",
      "-xrandr",
      "-quiet",
    ]);
    await this.waitForPort(vnc);
  }

  private launch(name: ProcessName, file: string, args: readonly string[]): Managed {
    const env = name === "xvfb" ? this.options.env() : this.environment();
    const child = spawn(file, [...args], { env, stdio: ["ignore", "ignore", "pipe"] });
    const managed: Managed = { name, child, stderr: "" };
    this.processes.set(name, managed);
    child.stderr?.on("data", (chunk: Buffer) => {
      managed.stderr = (managed.stderr + chunk.toString("utf8")).slice(-2_000);
    });
    child.once("error", (error) => {
      managed.stderr += error.message;
      this.onExit(managed, null, null);
    });
    child.once("exit", (code, signal) => this.onExit(managed, code, signal));
    return managed;
  }

  private onExit(managed: Managed, code: number | null, signal: NodeJS.Signals | null): void {
    // An old process of this name exiting after it was replaced is not news.
    if (this.processes.get(managed.name) !== managed) return;
    this.processes.delete(managed.name);
    if (this.stopping) return;
    const how = signal === null ? `code ${code}` : `signal ${signal}`;
    this.options.log(`${managed.name} exited (${how}): ${managed.stderr.trim().slice(-300)}`);
    // While starting, the start itself notices (its waits fail fast); only a running desktop recovers.
    if (this.state !== "running") return;
    this.recover(managed.name);
  }

  private recover(crashed: ProcessName): void {
    const { restart } = this.options;
    this.failures = Date.now() - this.lastUpAt > stableAfterMs ? 1 : this.failures + 1;
    if (this.failures > (restart.maxFailures ?? defaultMaxFailures)) {
      this.state = "failed";
      this.message = `The ${crashed} keeps crashing.`;
      void this.killAll();
      return;
    }
    const delay = Math.min(
      restart.maxDelayMs ?? defaultMaxDelayMs,
      (restart.initialDelayMs ?? defaultInitialDelayMs) * 2 ** (this.failures - 1),
    );
    this.restarts += 1;
    this.state = "restarting";
    this.options.log(`restarting ${crashed} in ${delay}ms`);
    // Callers arriving meanwhile wait for the restart instead of failing.
    const waiting = new Promise<void>((resolve, reject) => {
      this.abandonRecovery = () => {
        this.abandonRecovery = undefined;
        this.ready = undefined;
        reject(unavailable("The desktop is shutting down."));
      };
      this.recovery = setTimeout(() => {
        this.abandonRecovery = undefined;
        void (async () => {
          try {
            if (crashed === "xvfb") {
              await this.killAll();
              await this.startStack();
            } else if (crashed === "vnc") {
              await this.startVnc();
            } else {
              const [file = "", ...args] = (this.options.windowManager ?? "").split(/\s+/);
              this.launch("window manager", file, args);
            }
            this.state = "running";
            this.lastUpAt = Date.now();
            this.ready = undefined;
            resolve();
          } catch (error) {
            this.ready = undefined;
            await this.killAll();
            this.state = "failed";
            this.message = error instanceof Error ? error.message : String(error);
            reject(error);
          }
        })();
      }, delay);
    });
    this.ready = waiting;
    waiting.catch(() => undefined);
  }

  /** Make the display `width`x`height`. Needs RANDR; Xvfb can shrink and grow up to its start size. */
  private async applyMode(width: number, height: number): Promise<void> {
    const env = this.environment();
    const { xrandr } = this.options.binaries;
    const name = `anvia-${width}x${height}`;
    // A mode that already exists, or is already attached, is fine; only the switch has to work.
    const modeline = [
      "60.00",
      width,
      width + 64,
      width + 128,
      width + 256,
      height,
      height + 3,
      height + 8,
      height + 20,
      "-hsync",
      "+vsync",
    ].map(String);
    await runTool(xrandr, ["--newmode", name, ...modeline], { env }).catch(() => undefined);
    await runTool(xrandr, ["--addmode", "screen", name], { env }).catch(() => undefined);
    await runTool(xrandr, ["--output", "screen", "--mode", name], { env });
  }

  private async waitForDisplay(xvfb: Managed): Promise<void> {
    const env = this.environment();
    await this.waitUntil(async () => {
      if (this.processes.get("xvfb") !== xvfb)
        throw unavailable(`Xvfb exited: ${xvfb.stderr.trim()}`);
      try {
        await runTool(this.options.binaries.xdotool, ["getdisplaygeometry"], {
          env,
          timeoutMs: 2_000,
        });
        return true;
      } catch {
        return false;
      }
    }, "the display");
  }

  private async waitForPort(vnc: Managed): Promise<void> {
    await this.waitUntil(async () => {
      if (this.processes.get("vnc") !== vnc)
        throw unavailable(`x11vnc exited: ${vnc.stderr.trim()}`);
      return new Promise<boolean>((resolve) => {
        const socket = net.connect({ host: "127.0.0.1", port: this.options.vncPort });
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
      });
    }, "the VNC server");
  }

  private async waitUntil(check: () => Promise<boolean>, what: string): Promise<void> {
    const deadline = Date.now() + this.options.startTimeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw unavailable(`Timed out waiting for ${what} to come up.`);
  }

  private async killAll(): Promise<void> {
    const running = Array.from(this.processes.values());
    this.processes.clear();
    await Promise.all(
      running.map(
        ({ child }) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) return resolve();
            const force = setTimeout(() => child.kill("SIGKILL"), 3_000);
            child.once("exit", () => {
              clearTimeout(force);
              resolve();
            });
            child.kill("SIGTERM");
          }),
      ),
    );
  }
}

function unavailable(message: string): DockerSandboxError {
  return new DockerSandboxError(message, "process");
}
