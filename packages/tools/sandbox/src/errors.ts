export class SandboxError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class SandboxDockerUnavailableError extends SandboxError {}

export class SandboxDockerCommandError extends SandboxError {
  constructor(
    message: string,
    readonly result: {
      stdout: string;
      stderr: string;
      exitCode: number;
    },
  ) {
    super(message);
  }
}

export class SandboxSessionDestroyedError extends SandboxError {}

export class SandboxPathError extends SandboxError {}

export class SandboxTimeoutError extends SandboxError {}

export class SandboxFileSizeError extends SandboxError {}

export class SandboxToolPolicyError extends SandboxError {}
