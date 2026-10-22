/** What the daemon needs from a pseudo-terminal. `node-pty` provides it; tests can fake it. */
export interface PtyProcess {
  onData(listener: (chunk: Uint8Array) => void): void;
  onExit(listener: (event: { exitCode: number }) => void): void;
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  /** Stop reading the PTY so the kernel buffer fills and the child blocks. */
  pause(): void;
  resume(): void;
  kill(): void;
}

export interface PtySpawnOptions {
  file: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export type PtySpawner = (options: PtySpawnOptions) => PtyProcess;

interface NodePtyProcess {
  onData(listener: (data: Buffer) => void): unknown;
  onExit(listener: (event: { exitCode: number }) => void): unknown;
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): void;
}

interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
      encoding: null;
    },
  ): NodePtyProcess;
}

/**
 * Load `node-pty` if the sandbox image installed it. It is an optional peer dependency, so a
 * Docker-only user never installs native code. Resolves undefined when it is missing or broken.
 */
export async function loadNodePty(): Promise<PtySpawner | undefined> {
  try {
    // A variable specifier keeps bundlers and type checkers from treating it as a hard import.
    const specifier = "node-pty";
    const loaded = (await import(specifier)) as NodePtyModule & { default?: NodePtyModule };
    const module = typeof loaded.spawn === "function" ? loaded : loaded.default;
    if (module === undefined || typeof module.spawn !== "function") return undefined;
    return (options) => {
      const child = module.spawn(options.file, [...options.args], {
        name: "xterm-256color",
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: options.env,
        encoding: null,
      });
      return {
        onData: (listener) => {
          child.onData((data) => listener(new Uint8Array(data)));
        },
        onExit: (listener) => {
          child.onExit(listener);
        },
        write: (data) => child.write(Buffer.from(data)),
        resize: (cols, rows) => child.resize(cols, rows),
        pause: () => child.pause(),
        resume: () => child.resume(),
        kill: () => child.kill(),
      };
    };
  } catch {
    return undefined;
  }
}
