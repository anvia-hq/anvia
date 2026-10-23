import { type ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import { DockerSandboxError } from "../../errors";
import type { DesktopState } from "../../remote/protocol";
import { runTool } from "./exec";
import type { DesktopBackend, DesktopResolution, SandboxDaemonDesktopOptions } from "./options";

export interface ResolvedDesktopBinaries {
  /** Present for the `xvnc` backend. */
  xvnc?: string;
  /** Syncs Xvnc's clipboard. Present when installed. */
  vncconfig?: string;
  /** Present, with `x11vnc`, for the `xvfb` backend. */
  xvfb?: string;
  x11vnc?: string;
  xdotool: string;
  xrandr: string;
  import: string;
}

export interface DesktopSupervisorOptions {
  backend: DesktopBackend;
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

type ProcessName = "xvnc" | "xvfb" | "window manager" | "vnc" | "clipboard";

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
 * Runs the pieces of a desktop: the X display and its VNC server (one `Xvnc` process, or `Xvfb` with
 * `x11vnc`, bound to loopback), and a window manager. Nothing starts until something needs it. A
 * crashed piece is restarted with backoff (the display takes the others down with it, since they
 * hold it), and after too many quick failures in a row it gives up and reports why, until the next
 * caller asks again.
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
  /** The RandR output that sets the display's size: `screen` on Xvfb, `VNC-0` on Xvnc. */
  private output: string | undefined;

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
    this.output = undefined;
    if (options.backend === "xvnc") {
      // The display is the VNC server, so one process and one wait. It starts at the size asked for
      // and grows by RandR, which Xvnc allows far past any size we let `resize` ask for.
      const display = this.launch("xvnc", requiredBinary(options.binaries.xvnc, "Xvnc"), [
        options.display,
        ...xvncFlags(options),
        "-depth",
        "24",
        "-geometry",
        `${this.width}x${this.height}`,
      ]);
      await Promise.all([this.waitForDisplay(display), this.waitForPort(display)]);
      await this.applyMode(this.width, this.height);
      this.startClipboard();
      this.startWindowManager();
      return;
    }
    const { width, height } = options.maxResolution;
    const xvfb = this.launch("xvfb", requiredBinary(options.binaries.xvfb, "Xvfb"), [
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
    this.startWindowManager();
    await this.startVnc();
  }

  /** Xvnc only shares the clipboard with desktop programs while `vncconfig` is running. */
  private startClipboard(): void {
    const { vncconfig } = this.options.binaries;
    if (vncconfig !== undefined) this.launch("clipboard", vncconfig, ["-nowin"]);
  }

  private startWindowManager(): void {
    const { windowManager } = this.options;
    if (windowManager === undefined) return;
    const [file = "", ...args] = windowManager.split(/\s+/).filter(Boolean);
    this.launch("window manager", file, args);
  }

  private async startVnc(): Promise<void> {
    const vnc = this.launch("vnc", requiredBinary(this.options.binaries.x11vnc, "x11vnc"), [
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
    const env = name === "xvfb" || name === "xvnc" ? this.options.env() : this.environment();
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
            if (crashed === "xvfb" || crashed === "xvnc") {
              await this.killAll();
              await this.startStack();
            } else if (crashed === "vnc") {
              await this.startVnc();
            } else if (crashed === "clipboard") {
              this.startClipboard();
            } else {
              this.startWindowManager();
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

  /**
   * Make the display `width`x`height`. Needs RANDR. Xvfb can shrink and grow up to its start size;
   * Xvnc can grow too.
   */
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
    const output = await this.outputName();
    await runTool(xrandr, ["--addmode", output, name], { env }).catch(() => undefined);
    await runTool(xrandr, ["--output", output, "--mode", name], { env });
  }

  /** The output the display's size is set on. Servers name it differently, so ask. */
  private async outputName(): Promise<string> {
    if (this.output !== undefined) return this.output;
    const stdout = await runTool(this.options.binaries.xrandr, ["--query"], {
      env: this.environment(),
      timeoutMs: 5_000,
    });
    const name = /^(\S+) connected/m.exec(stdout.toString("utf8"))?.[1];
    if (name === undefined) throw unavailable("The display has no RandR output to resize.");
    this.output = name;
    return name;
  }

  private async waitForDisplay(display: Managed): Promise<void> {
    const env = this.environment();
    await this.waitUntil(async () => {
      if (this.processes.get(display.name) !== display)
        throw unavailable(`${programName(display.name)} exited: ${display.stderr.trim()}`);
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
      if (this.processes.get(vnc.name) !== vnc)
        throw unavailable(`${programName(vnc.name)} exited: ${vnc.stderr.trim()}`);
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

/** Flags that make Xvnc a display with a loopback-only, passwordless, shared VNC server. */
function xvncFlags(options: DesktopSupervisorOptions): string[] {
  return [
    "-rfbport",
    String(options.vncPort),
    // No password: it listens on loopback only, so it is reachable through a tunnel and nothing else.
    "-localhost",
    "yes",
    "-SecurityTypes",
    "None",
    "-AlwaysShared",
    // The viewer is not in charge of the display's size: `resize` is.
    "-AcceptSetDesktopSize=0",
    "-nolisten",
    "tcp",
    "-noreset",
    "+extension",
    "RANDR",
  ];
}

function programName(name: ProcessName): string {
  return name === "xvnc" ? "Xvnc" : name === "xvfb" ? "Xvfb" : name === "vnc" ? "x11vnc" : name;
}

function requiredBinary(path: string | undefined, name: string): string {
  if (path === undefined) throw unavailable(`${name} was not found.`);
  return path;
}

function unavailable(message: string): DockerSandboxError {
  return new DockerSandboxError(message, "process");
}
