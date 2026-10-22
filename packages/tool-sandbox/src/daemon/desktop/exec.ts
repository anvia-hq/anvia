import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { DockerSandboxError } from "../../errors";

export interface RunToolOptions {
  env: Record<string, string>;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  /** Largest stdout accepted, in bytes. Screenshots are the big ones. */
  maxBytes?: number | undefined;
}

/** Run a program to completion and return its stdout. Failures carry what it printed to stderr. */
export function runTool(file: string, args: readonly string[], options: RunToolOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        env: options.env,
        timeout: options.timeoutMs ?? 15_000,
        maxBuffer: options.maxBytes ?? 64 * 1024 * 1024,
        encoding: "buffer",
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        if (error === null) return resolve(stdout);
        if (options.signal?.aborted === true) return reject(options.signal.reason ?? error);
        const detail = stderr.toString("utf8").trim() || error.message;
        reject(new DockerSandboxError(`${path.basename(file)} failed: ${detail}`, "process"));
      },
    );
  });
}

/** The first executable called `name` on `searchPath`, or undefined. */
export async function findExecutable(
  name: string,
  searchPath: string | undefined,
): Promise<string | undefined> {
  if (name.includes("/")) return (await isExecutable(name)) ? name : undefined;
  for (const directory of (searchPath ?? "").split(path.delimiter)) {
    if (directory === "") continue;
    const candidate = path.join(directory, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
