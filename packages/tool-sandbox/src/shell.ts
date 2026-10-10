import { DockerSandboxError } from "./errors";
import type { DockerSandboxRuntime } from "./types";

type SandboxShell = "/bin/bash" | "sh";

const shells = new WeakMap<DockerSandboxRuntime, Promise<SandboxShell>>();

/** Share only capability detection, never command-policy decisions, across tool factories. */
export async function sandboxShell(
  sandbox: DockerSandboxRuntime,
  abortSignal?: AbortSignal,
): Promise<SandboxShell> {
  abortSignal?.throwIfAborted();
  let pending = shells.get(sandbox);
  if (pending === undefined) {
    pending = detectShell(sandbox).catch((error) => {
      shells.delete(sandbox);
      throw error;
    });
    shells.set(sandbox, pending);
  }
  if (abortSignal === undefined) return pending;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<SandboxShell>((_, reject) => {
        abort = () => reject(abortSignal.reason);
        if (abortSignal.aborted) abort();
        else abortSignal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (abort !== undefined) abortSignal.removeEventListener("abort", abort);
  }
}

async function detectShell(sandbox: DockerSandboxRuntime): Promise<SandboxShell> {
  // Fixed, read-only infrastructure probe. Do not include caller input, cwd, or env.
  // A caller's cancellation must not cancel detection shared with other tool calls.
  const result = await sandbox.exec({
    command: "sh",
    args: ["-c", "test -x /bin/bash"],
    timeoutMs: 5_000,
  });
  if (result.status === "timed_out") {
    throw new DockerSandboxError("Sandbox shell detection timed out.", "timeout");
  }
  if (result.exitCode === 0) return "/bin/bash";
  if (result.exitCode === 1) return "sh";
  throw new DockerSandboxError("Could not detect the sandbox shell.", "docker_command_failed");
}
