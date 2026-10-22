import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { DockerSandboxError } from "../../errors";
import { type PtyExitReason, terminalSessionNamePattern } from "../../remote/protocol";
import type { PtyProcess, PtySpawner } from "./pty";

export interface TerminalSessionInfo {
  name: string;
  attached: number;
  persistent: boolean;
  createdAt?: string;
}

export interface TerminalOpenRequest {
  sessionName: string;
  cols: number;
  rows: number;
  cwd: string;
  /** Complete environment for the terminal, already stripped of daemon credentials. */
  env: Record<string, string>;
  readOnly: boolean;
}

export interface TerminalExitInfo {
  reason: PtyExitReason;
  exitCode?: number;
}

/** One viewer of a session. Data is held back until {@link start}, so the first bytes are not lost. */
export interface TerminalAttachment {
  /**
   * True when pausing the attachment only stalls this viewer (tmux redraws it on catch-up).
   * False when the PTY is shared by every viewer, which must therefore keep draining.
   */
  readonly pausable: boolean;
  start(listener: {
    onData: (chunk: Uint8Array) => void;
    onExit: (info: TerminalExitInfo) => void;
  }): void;
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  /** Bytes that redraw the session from scratch, for a viewer that fell behind. */
  snapshot(): Uint8Array | undefined;
  close(): void;
}

export interface TerminalManagerOptions {
  spawn: PtySpawner;
  /** Absolute path of a tmux binary, or undefined to use the plain-shell fallback. */
  tmuxPath?: string | undefined;
  /** tmux server socket name. A dedicated socket keeps the user's own tmux out of it. */
  socketName?: string | undefined;
  /** Scrollback kept per session by the fallback. Default 256 KiB. */
  scrollbackBytes?: number | undefined;
  /** Sessions allowed at once. Default 16. */
  maxSessions?: number | undefined;
  /** Environment for tmux's own commands (no daemon credentials). */
  commandEnv: () => Record<string, string>;
}

const defaultScrollbackBytes = 256 * 1024;
const defaultMaxSessions = 16;
const defaultSocketName = "anvia-sandbox";
const tmuxHistoryLimit = 50_000;
const minTmuxMajor = 3;
const minTmuxMinor = 2;

export function assertSessionName(name: string): void {
  if (!terminalSessionNamePattern.test(name)) {
    throw new DockerSandboxError(
      "Terminal session names use letters, digits, '_' and '-' (at most 64 characters).",
      "invalid_state",
    );
  }
}

/** Find tmux on PATH and check it is new enough for `-e` and attach flags (3.2). */
export async function detectTmux(candidate = "tmux"): Promise<string | undefined> {
  try {
    const output = await run(candidate, ["-V"], {}, 5_000);
    const match = /(\d+)\.(\d+)/.exec(output);
    if (match === null) return undefined;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const ok = major > minTmuxMajor || (major === minTmuxMajor && minor >= minTmuxMinor);
    return ok ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Terminal sessions for one daemon. With tmux, a session is a tmux session and every viewer is
 * its own `tmux attach` PTY, so viewers share output and reattach with scrollback. Without tmux,
 * a session is one shell PTY with a bounded scrollback ring that lives only as long as the daemon.
 */
export class TerminalManager {
  readonly persistent: boolean;
  private readonly spawn: PtySpawner;
  private readonly tmuxPath: string | undefined;
  private readonly socketName: string;
  private readonly scrollbackBytes: number;
  private readonly maxSessions: number;
  private readonly commandEnv: () => Record<string, string>;
  private readonly shellSessions = new Map<string, ShellSession>();
  private readonly attachments = new Set<TerminalAttachment>();

  constructor(options: TerminalManagerOptions) {
    this.spawn = options.spawn;
    this.tmuxPath = options.tmuxPath;
    this.persistent = options.tmuxPath !== undefined;
    this.socketName = options.socketName ?? defaultSocketName;
    this.scrollbackBytes = options.scrollbackBytes ?? defaultScrollbackBytes;
    this.maxSessions = options.maxSessions ?? defaultMaxSessions;
    this.commandEnv = options.commandEnv;
  }

  async open(request: TerminalOpenRequest): Promise<TerminalAttachment> {
    assertSessionName(request.sessionName);
    const attachment =
      this.tmuxPath === undefined
        ? await this.openShell(request)
        : await this.openTmux(this.tmuxPath, request);
    this.attachments.add(attachment);
    return attachment;
  }

  async list(): Promise<TerminalSessionInfo[]> {
    if (this.tmuxPath === undefined) {
      return [...this.shellSessions.values()].map((session) => ({
        name: session.name,
        attached: session.viewers.size,
        persistent: false,
        createdAt: session.createdAt,
      }));
    }
    return this.listTmux(this.tmuxPath);
  }

  async kill(sessionName: string): Promise<void> {
    assertSessionName(sessionName);
    if (this.tmuxPath === undefined) {
      const session = this.shellSessions.get(sessionName);
      if (session === undefined) throw unknownSession(sessionName);
      session.kill();
      return;
    }
    try {
      await this.tmux(this.tmuxPath, ["kill-session", "-t", `=${sessionName}`]);
    } catch {
      throw unknownSession(sessionName);
    }
  }

  /** Detach every viewer. tmux sessions keep running; fallback shells end with the daemon. */
  dispose(): void {
    for (const attachment of Array.from(this.attachments)) attachment.close();
    for (const session of Array.from(this.shellSessions.values())) session.kill();
  }

  // ---- tmux ----------------------------------------------------------------------------------

  private tmux(tmuxPath: string, args: string[]): Promise<string> {
    return run(tmuxPath, ["-L", this.socketName, ...args], this.commandEnv(), 10_000);
  }

  private async listTmux(tmuxPath: string): Promise<TerminalSessionInfo[]> {
    let output: string;
    try {
      output = await this.tmux(tmuxPath, [
        "list-sessions",
        "-F",
        // tmux rewrites control characters in -F output, so no tab delimiter. The name goes last
        // because it is the only field that can contain a space.
        "#{session_attached} #{session_created} #{session_name}",
      ]);
    } catch {
      return []; // No server running means no sessions.
    }
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [attached = "0", created = "", ...rest] = line.split(" ");
        const name = rest.join(" ");
        const info: TerminalSessionInfo = {
          name,
          attached: Number(attached) || 0,
          persistent: true,
        };
        const seconds = Number(created);
        if (Number.isFinite(seconds) && seconds > 0) {
          info.createdAt = new Date(seconds * 1_000).toISOString();
        }
        return info;
      });
  }

  private async openTmux(
    tmuxPath: string,
    request: TerminalOpenRequest,
  ): Promise<TerminalAttachment> {
    const target = `=${request.sessionName}`;
    const exists = await this.tmux(tmuxPath, ["has-session", "-t", target]).then(
      () => true,
      () => false,
    );
    if (!exists) {
      if ((await this.listTmux(tmuxPath)).length >= this.maxSessions) {
        throw new DockerSandboxError(
          `Terminal session limit reached (${this.maxSessions}).`,
          "process",
        );
      }
      const environment = Object.entries(request.env).flatMap(([key, value]) => [
        "-e",
        `${key}=${value}`,
      ]);
      try {
        await this.tmux(tmuxPath, [
          // The server exits when it has no sessions, so options and the session are created in
          // one invocation. window-size latest sizes a session to its most recent viewer.
          "start-server",
          ";",
          "set-option",
          "-g",
          "history-limit",
          String(tmuxHistoryLimit),
          ";",
          "set-option",
          "-g",
          "window-size",
          "latest",
          ";",
          "set-option",
          "-g",
          "aggressive-resize",
          "on",
          ";",
          "set-option",
          "-g",
          "status",
          "off",
          ";",
          "new-session",
          "-d",
          "-s",
          request.sessionName,
          "-c",
          request.cwd,
          "-x",
          String(request.cols),
          "-y",
          String(request.rows),
          ...environment,
        ]);
      } catch (error) {
        // Another viewer may have created the same session in the meantime.
        const created = await this.tmux(tmuxPath, ["has-session", "-t", target]).then(
          () => true,
          () => false,
        );
        if (!created) throw failed("Could not create the terminal session", error);
      }
    }

    const flags = request.readOnly ? ["-f", "read-only,ignore-size"] : [];
    const pty = this.spawn({
      file: tmuxPath,
      args: ["-L", this.socketName, "attach-session", ...flags, "-t", target],
      cwd: request.cwd,
      env: { ...request.env, TERM: "xterm-256color" },
      cols: request.cols,
      rows: request.rows,
    });
    return new PtyAttachment(pty, {
      pausable: true,
      readOnly: request.readOnly,
      onClosed: (attachment) => this.attachments.delete(attachment),
    });
  }

  // ---- fallback ------------------------------------------------------------------------------

  private async openShell(request: TerminalOpenRequest): Promise<TerminalAttachment> {
    let session = this.shellSessions.get(request.sessionName);
    if (session === undefined) {
      if (this.shellSessions.size >= this.maxSessions) {
        throw new DockerSandboxError(
          `Terminal session limit reached (${this.maxSessions}).`,
          "process",
        );
      }
      const shell = await pickShell();
      const pty = this.spawn({
        file: shell,
        args: ["-i"],
        cwd: request.cwd,
        env: { ...request.env, TERM: "xterm-256color" },
        cols: request.cols,
        rows: request.rows,
      });
      session = new ShellSession(request.sessionName, pty, this.scrollbackBytes, (ended) => {
        if (this.shellSessions.get(ended.name) === ended) this.shellSessions.delete(ended.name);
      });
      this.shellSessions.set(request.sessionName, session);
    }
    const viewer = new ShellViewer(session, request.readOnly, (attachment) =>
      this.attachments.delete(attachment),
    );
    if (!request.readOnly) session.resize(request.cols, request.rows);
    return viewer;
  }
}

/** A viewer that owns its PTY, as a `tmux attach` does. */
class PtyAttachment implements TerminalAttachment {
  readonly pausable: boolean;
  private listener:
    | { onData: (chunk: Uint8Array) => void; onExit: (info: TerminalExitInfo) => void }
    | undefined;
  private readonly early: Uint8Array[] = [];
  private exited: TerminalExitInfo | undefined;
  private closing = false;

  constructor(
    private readonly pty: PtyProcess,
    private readonly options: {
      pausable: boolean;
      readOnly: boolean;
      onClosed: (attachment: TerminalAttachment) => void;
    },
  ) {
    this.pausable = options.pausable;
    pty.onData((chunk) => {
      if (this.listener === undefined) this.early.push(chunk);
      else this.listener.onData(chunk);
    });
    pty.onExit(({ exitCode }) => {
      this.exited = this.closing ? { reason: "closed" } : { reason: "exited", exitCode };
      this.options.onClosed(this);
      this.listener?.onExit(this.exited);
    });
  }

  start(listener: NonNullable<PtyAttachment["listener"]>): void {
    this.listener = listener;
    for (const chunk of this.early.splice(0)) listener.onData(chunk);
    if (this.exited !== undefined) listener.onExit(this.exited);
  }

  write(data: Uint8Array): void {
    if (!this.options.readOnly && this.exited === undefined) this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.options.readOnly && this.exited === undefined) this.pty.resize(cols, rows);
  }

  pause(): void {
    if (this.exited === undefined) this.pty.pause();
  }

  resume(): void {
    if (this.exited === undefined) this.pty.resume();
  }

  snapshot(): undefined {
    return undefined;
  }

  close(): void {
    if (this.exited !== undefined || this.closing) return;
    this.closing = true;
    this.pty.kill();
  }
}

/** One shell PTY plus the scrollback every viewer replays from. */
class ShellSession {
  readonly viewers = new Set<ShellViewer>();
  readonly createdAt = new Date().toISOString();
  private readonly chunks: Uint8Array[] = [];
  private bytes = 0;
  private ended = false;
  private killed = false;

  constructor(
    readonly name: string,
    private readonly pty: PtyProcess,
    private readonly scrollbackBytes: number,
    private readonly onEnded: (session: ShellSession) => void,
  ) {
    pty.onData((chunk) => {
      this.remember(chunk);
      for (const viewer of this.viewers) viewer.deliver(chunk);
    });
    pty.onExit(({ exitCode }) => {
      this.ended = true;
      this.onEnded(this);
      const info: TerminalExitInfo = this.killed
        ? { reason: "killed" }
        : { reason: "exited", exitCode };
      for (const viewer of Array.from(this.viewers)) viewer.ended(info);
    });
  }

  write(data: Uint8Array): void {
    if (!this.ended) this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.ended) this.pty.resize(cols, rows);
  }

  kill(): void {
    if (this.ended) return;
    this.killed = true;
    this.pty.kill();
  }

  snapshot(): Uint8Array {
    const out = new Uint8Array(this.bytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  private remember(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.bytes += chunk.byteLength;
    while (this.bytes > this.scrollbackBytes && this.chunks.length > 1) {
      this.bytes -= this.chunks.shift()?.byteLength ?? 0;
    }
    const first = this.chunks[0];
    if (first !== undefined && this.bytes > this.scrollbackBytes) {
      const excess = this.bytes - this.scrollbackBytes;
      this.chunks[0] = first.subarray(excess);
      this.bytes -= excess;
    }
  }
}

class ShellViewer implements TerminalAttachment {
  readonly pausable = false;
  private listener:
    | { onData: (chunk: Uint8Array) => void; onExit: (info: TerminalExitInfo) => void }
    | undefined;
  private readonly early: Uint8Array[];
  private exit: TerminalExitInfo | undefined;
  private done = false;

  constructor(
    private readonly session: ShellSession,
    private readonly readOnly: boolean,
    private readonly onClosed: (attachment: TerminalAttachment) => void,
  ) {
    // Start with the scrollback so a new viewer sees what the others already saw.
    const history = session.snapshot();
    this.early = history.byteLength > 0 ? [history] : [];
    session.viewers.add(this);
  }

  deliver(chunk: Uint8Array): void {
    if (this.listener === undefined) this.early.push(chunk);
    else this.listener.onData(chunk);
  }

  ended(info: TerminalExitInfo): void {
    this.finish(info);
  }

  start(listener: NonNullable<ShellViewer["listener"]>): void {
    this.listener = listener;
    for (const chunk of this.early.splice(0)) listener.onData(chunk);
    if (this.exit !== undefined) listener.onExit(this.exit);
  }

  write(data: Uint8Array): void {
    if (!this.readOnly && !this.done) this.session.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.readOnly && !this.done) this.session.resize(cols, rows);
  }

  pause(): void {}

  resume(): void {}

  snapshot(): Uint8Array {
    return this.session.snapshot();
  }

  close(): void {
    this.finish({ reason: "closed" }, false);
  }

  private finish(info: TerminalExitInfo, notify = true): void {
    if (this.done) return;
    this.done = true;
    this.session.viewers.delete(this);
    this.onClosed(this);
    if (notify) {
      this.exit = info;
      this.listener?.onExit(info);
    }
  }
}

async function pickShell(): Promise<string> {
  for (const candidate of ["/bin/bash", "/bin/sh"]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  throw new DockerSandboxError("No shell found for the terminal.", "process");
}

function unknownSession(sessionName: string): DockerSandboxError {
  return new DockerSandboxError(`Unknown terminal session: ${sessionName}`, "invalid_state");
}

function failed(message: string, cause: unknown): DockerSandboxError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new DockerSandboxError(`${message}: ${detail}`, "process");
}

function run(
  file: string,
  args: string[],
  env: Record<string, string>,
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env, timeout, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}
