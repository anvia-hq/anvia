import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DockerProcessManager } from "../src/docker-process";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("DockerProcessManager abort lifecycle", () => {
  it("does not retain the startup abort signal as process ownership", async () => {
    const dockerPath = await fakeDockerCli();
    const manager = createManager(dockerPath);
    const controller = new AbortController();

    const process = await manager.start({ command: "server", abortSignal: controller.signal });
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(manager.list()).toEqual([process]);
    await manager.dispose();
  });

  it("kills and forgets a process whose startup is aborted before the marker", async () => {
    const dockerPath = await fakeDockerCli();
    const manager = createManager(dockerPath);
    const controller = new AbortController();
    const starting = manager.start({ command: "delay-marker", abortSignal: controller.signal });
    setTimeout(() => controller.abort(new DOMException("cancelled", "AbortError")), 20);

    await expect(starting).rejects.toMatchObject({ name: "AbortError" });
    expect(manager.list()).toEqual([]);
    await manager.dispose();
  });
});

function createManager(dockerPath: string): DockerProcessManager {
  return new DockerProcessManager({
    containerName: "sandbox",
    dockerPath,
    workdir: "/workspace",
    env: {},
    maxOutputBytes: 1_024,
    maxProcesses: 1,
    startupTimeoutMs: 1_000,
  });
}

async function fakeDockerCli(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "anvia-fake-docker-"));
  temporaryDirectories.push(directory);
  const executable = path.join(directory, "docker");
  await writeFile(
    executable,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      'const markerIndex = args.findIndex((value) => value.startsWith("ANVIA_PROCESS:"));',
      "const marker = args[markerIndex];",
      'if (typeof marker !== "string" || !marker.startsWith("ANVIA_PROCESS:")) process.exit(1);',
      "const command = args[markerIndex + 1];",
      "const announce = () => {",
      '  process.stdout.write("\\u001e" + marker + ":1:1\\u001e");',
      "  process.stdin.once('data', () => setInterval(() => {}, 1000));",
      "  process.stdin.resume();",
      "};",
      'if (command === "delay-marker") setTimeout(announce, 500);',
      "else announce();",
    ].join("\n"),
    "utf8",
  );
  await chmod(executable, 0o755);
  return executable;
}
