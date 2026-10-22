import type { PtyExitReason } from "../../remote/protocol";
import type { PtyProcess } from "./pty";

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

/** A viewer that owns its PTY, as a `tmux attach` does. */
export class PtyAttachment implements TerminalAttachment {
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
export class ShellSession {
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

export class ShellViewer implements TerminalAttachment {
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
