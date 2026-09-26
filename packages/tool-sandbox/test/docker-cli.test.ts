import { describe, expect, it } from "vitest";
import { assertDockerCli } from "../src/docker-cli";

/**
 * `process.execPath` is a portable stand-in for a Docker binary that exits non-zero:
 * `node <script-that-does-not-exist>` fails deterministically on every platform, which
 * lets us exercise the real failure path in `assertDockerCli` without Docker.
 */
function failingDockerPath(): string {
  return process.execPath;
}

async function failureMessage(args: string[]): Promise<string> {
  try {
    await assertDockerCli(args, { dockerPath: failingDockerPath() });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("assertDockerCli did not reject.");
}

describe("assertDockerCli failure message", () => {
  it("does not leak environment values passed with --env", async () => {
    const message = await failureMessage([
      "run",
      "-d",
      "--env",
      "OPENAI_API_KEY=sk-supersecret123",
      "image:latest",
    ]);

    expect(message).not.toContain("sk-supersecret123");
  });

  it("does not leak environment values passed with -e", async () => {
    const message = await failureMessage(["exec", "-e", "TOKEN=tok-abcdef123", "sandbox"]);

    expect(message).not.toContain("tok-abcdef123");
  });

  it("keeps the variable name and the failing command readable", async () => {
    const message = await failureMessage([
      "run",
      "--env",
      "OPENAI_API_KEY=sk-supersecret123",
      "image:latest",
    ]);

    expect(message).toContain("Docker command failed");
    expect(message).toContain("--env");
    expect(message).toContain("OPENAI_API_KEY=");
    expect(message).toContain("image:latest");
  });

  it("does not alter arguments that carry no secret value", async () => {
    const message = await failureMessage(["stop", "sandbox-1"]);

    expect(message).toContain("stop sandbox-1");
  });
});
