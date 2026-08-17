import path from "node:path";
import { DockerSandboxError } from "./errors";

export function normalizeSandboxPath(input: string, options: { allowRoot?: boolean } = {}): string {
  if (input.length === 0) {
    throw new DockerSandboxError("Sandbox path cannot be empty.", "invalid_path");
  }

  if (input.includes("\0")) {
    throw new DockerSandboxError("Sandbox path cannot contain null bytes.", "invalid_path");
  }

  const normalized = path.posix.normalize(input.replaceAll("\\", "/"));

  if (path.posix.isAbsolute(normalized)) {
    throw new DockerSandboxError(`Sandbox path must be relative: ${input}`, "invalid_path");
  }

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new DockerSandboxError(
      `Sandbox path cannot leave the workspace: ${input}`,
      "invalid_path",
    );
  }

  if (normalized === "." && options.allowRoot !== true) {
    throw new DockerSandboxError(
      "Sandbox path must refer to a file or directory inside the workspace.",
      "invalid_path",
    );
  }

  return normalized;
}

export function containerPath(workdir: string, relativePath: string): string {
  const normalizedWorkdir = path.posix.normalize(workdir);
  const normalizedPath = normalizeSandboxPath(relativePath, { allowRoot: true });
  return normalizedPath === "."
    ? normalizedWorkdir
    : path.posix.join(normalizedWorkdir, normalizedPath);
}

export function parentSandboxPath(relativePath: string): string {
  const normalized = normalizeSandboxPath(relativePath);
  const parent = path.posix.dirname(normalized);
  return parent === "." ? "." : parent;
}
