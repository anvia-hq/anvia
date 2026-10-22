import type { PtyProcess, PtySpawnOptions, PtySpawner } from "../../src/daemon/terminal/pty";

/** A PTY the test drives by hand, to exercise flow control without a real shell. */
export class FakePty implements PtyProcess {
  readonly writes: Uint8Array[] = [];
  readonly sizes: Array<[number, number]> = [];
  pauses = 0;
  resumes = 0;
  killed = false;
  private dataListener: ((chunk: Uint8Array) => void) | undefined;
  private exitListener: ((event: { exitCode: number }) => void) | undefined;

  constructor(readonly options: PtySpawnOptions) {}

  onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListener = listener;
  }
  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exitListener = listener;
  }
  write(data: Uint8Array): void {
    this.writes.push(data);
  }
  resize(cols: number, rows: number): void {
    this.sizes.push([cols, rows]);
  }
  pause(): void {
    this.pauses += 1;
  }
  resume(): void {
    this.resumes += 1;
  }
  kill(): void {
    this.killed = true;
    this.exitListener?.({ exitCode: 0 });
  }

  emit(data: string | Uint8Array): void {
    this.dataListener?.(typeof data === "string" ? new TextEncoder().encode(data) : data);
  }
  exit(exitCode: number): void {
    this.exitListener?.({ exitCode });
  }
}

export function fakeSpawner(): { spawn: PtySpawner; ptys: FakePty[] } {
  const ptys: FakePty[] = [];
  return {
    ptys,
    spawn: (options) => {
      const pty = new FakePty(options);
      ptys.push(pty);
      return pty;
    },
  };
}
