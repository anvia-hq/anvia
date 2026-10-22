import { DockerSandboxError } from "./errors";
import { decodeUtf8 } from "./shared/output";
import { type CommandResult, runCommand } from "./shared/run-command";

export { decodeUtf8 };

export type DockerCliResult = CommandResult;

export interface DockerCliOptions {
  dockerPath: string;
  timeoutMs?: number | undefined;
  maxOutputBytes?: number | undefined;
  input?: string | Uint8Array | undefined;
  signal?: AbortSignal | undefined;
  onStdout?: (chunk: Uint8Array) => void;
  onStderr?: (chunk: Uint8Array) => void;
}

export function runDockerCli(args: string[], options: DockerCliOptions): Promise<DockerCliResult> {
  const { dockerPath, ...rest } = options;
  return runCommand(dockerPath, args, {
    ...rest,
    mapSpawnError: (error) =>
      error.code === "ENOENT"
        ? new DockerSandboxError("Docker CLI was not found.", "docker_unavailable", undefined, {
            cause: error,
          })
        : error,
  });
}

export async function assertDockerCli(args: string[], options: DockerCliOptions): Promise<void> {
  const result = await runDockerCli(args, options);

  if (result.exitCode !== 0) {
    throw new DockerSandboxError(
      `Docker command failed: docker ${redactCliArgs(args).join(" ")}`,
      "docker_command_failed",
      result,
    );
  }
}

/** Flags whose following value is a `KEY=VALUE` assignment that may carry a secret. */
const envValueFlags = new Set(["--env", "-e"]);

/**
 * Replace secret values in a Docker argv before it is embedded in an error message, so
 * environment values passed with `--env`/`-e` never reach logs or traces. The variable
 * name is kept visible to keep the failure diagnosable. Both the separated
 * (`--env KEY=VALUE`) and equals-delimited (`--env=KEY=VALUE`) spellings are covered, as
 * well as the attached short-flag spelling (`-eKEY=VALUE`) that Docker's flag parser
 * accepts for the `-e` shorthand.
 */
function redactCliArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    const flag = args[index - 1];
    if (flag !== undefined && envValueFlags.has(flag)) return redactEnvAssignment(arg);
    for (const envFlag of envValueFlags) {
      const prefix = `${envFlag}=`;
      if (arg.startsWith(prefix))
        return `${prefix}${redactEnvAssignment(arg.slice(prefix.length))}`;
    }
    if (arg.startsWith("-e") && !arg.startsWith("-e=") && arg.length > 2)
      return `-e${redactEnvAssignment(arg.slice(2))}`;
    return arg;
  });
}

function redactEnvAssignment(value: string): string {
  const separator = value.indexOf("=");
  return separator === -1 ? value : `${value.slice(0, separator + 1)}<redacted>`;
}
