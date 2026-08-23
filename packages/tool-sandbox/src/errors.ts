export type DockerSandboxErrorCode =
  | "docker_unavailable"
  | "docker_command_failed"
  | "image_not_found"
  | "volume_not_found"
  | "sandbox_not_found"
  | "invalid_state"
  | "invalid_path"
  | "timeout"
  | "file_too_large"
  | "tool_policy"
  | "port"
  | "process";

export class DockerSandboxError extends Error {
  constructor(
    message: string,
    readonly code: DockerSandboxErrorCode,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DockerSandboxError";
  }
}

export function dockerSandboxError(
  message: string,
  code: DockerSandboxErrorCode,
  cause?: unknown,
  details?: unknown,
): DockerSandboxError {
  return new DockerSandboxError(
    message,
    code,
    details,
    cause === undefined ? undefined : { cause },
  );
}
