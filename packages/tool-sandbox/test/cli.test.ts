import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type SandboxImageCliDependencies, type SandboxImageCliIo } from "../src/cli";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("anvia-sandbox CLI", () => {
  it("prints help and rejects unknown input", async () => {
    const help = captureIo();
    await expect(runCli(["--help"], process.cwd(), help.io)).resolves.toBe(0);
    expect(help.logs.join("\n")).toContain("pnpm dlx @anvia/sandbox create-image");

    const unknown = captureIo();
    await expect(runCli(["other"], process.cwd(), unknown.io)).resolves.toBe(1);
    expect(unknown.errors).toEqual(["Unknown command: other"]);
  });

  it("requires complete flags outside a TTY", async () => {
    const directory = await temporaryDirectory();
    const output = captureIo();
    const code = await runCli(["create-image", "--name", "reports"], directory, output.io, {
      isTTY: false,
    });

    expect(code).toBe(1);
    expect(output.errors[0]).toContain("Non-interactive");
  });

  it("supports a dry run without writing or building", async () => {
    const directory = await temporaryDirectory();
    const output = captureIo();
    let built = false;
    const code = await runCli(
      ["create-image", "--name", "reports", "--feature", "artifacts", "--dry-run"],
      directory,
      output.io,
      dependencies({
        buildImage: async () => {
          built = true;
        },
      }),
    );

    expect(code).toBe(0);
    expect(built).toBe(false);
    await expect(stat(path.join(directory, ".anvia"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(output.logs.join("\n")).toContain("--- Dockerfile");
    expect(output.logs.join("\n")).toContain("matplotlib==3.11.1");
  });

  it("writes the context, builds it, and prints the constructor snippet", async () => {
    const directory = await temporaryDirectory();
    const output = captureIo();
    const builds: Array<{ contextPath: string; tag: string; dockerPath: string }> = [];
    const code = await runCli(
      [
        "create-image",
        "--name",
        "browser",
        "--runtime",
        "bun",
        "--feature",
        "playwright",
        "--docker-path",
        "/opt/docker",
      ],
      directory,
      output.io,
      dependencies({
        buildImage: async ({ contextPath, tag, dockerPath }) => {
          builds.push({ contextPath, tag, dockerPath });
        },
      }),
    );

    const contextPath = path.join(directory, ".anvia", "sandbox-images", "browser");
    expect(code).toBe(0);
    expect(builds).toEqual([
      { contextPath, tag: "anvia-sandbox-browser:latest", dockerPath: "/opt/docker" },
    ]);
    expect(
      JSON.parse(await readFile(path.join(contextPath, "anvia-sandbox.json"), "utf8")),
    ).toMatchObject({
      generatedBy: { package: "@anvia/sandbox", version: "0.5.0-test" },
      runtimes: ["node", "bun"],
      features: ["playwright"],
    });
    expect(output.logs.join("\n")).toContain('image: "anvia-sandbox-browser:latest"');
    expect(output.logs.join("\n")).toContain('pull: "never"');
  });

  it("generates without building and prints the deferred command", async () => {
    const directory = await temporaryDirectory();
    const output = captureIo();
    const code = await runCli(
      ["create-image", "--name", "node-dev", "--runtime", "node", "--no-build"],
      directory,
      output.io,
      dependencies(),
    );

    expect(code).toBe(0);
    expect(output.logs.join("\n")).toContain(
      "docker build --tag anvia-sandbox-node-dev:latest .anvia/sandbox-images/node-dev",
    );
  });

  it("records apt, npm, and uv packages without renaming the package groups", async () => {
    const directory = await temporaryDirectory();
    const code = await runCli(
      [
        "create-image",
        "--name",
        "documents",
        "--runtime",
        "node",
        "--apt",
        "poppler-utils",
        "--npm",
        "pdfkit@0.19.1",
        "--uv",
        "httpx==0.28.1",
        "--no-build",
      ],
      directory,
      captureIo().io,
      dependencies(),
    );

    expect(code).toBe(0);
    const contextPath = path.join(directory, ".anvia", "sandbox-images", "documents");
    const manifest = JSON.parse(
      await readFile(path.join(contextPath, "anvia-sandbox.json"), "utf8"),
    ) as { packages: Record<string, string[]> };
    expect(manifest.packages).toEqual({
      apt: ["poppler-utils"],
      npm: ["pdfkit@0.19.1"],
      uv: ["httpx==0.28.1"],
    });
    await expect(readFile(path.join(contextPath, "pyproject.toml"), "utf8")).resolves.toContain(
      '"httpx==0.28.1"',
    );
  });

  it("shell-quotes deferred build paths without allowing expansion", async () => {
    const directory = await temporaryDirectory();
    const output = captureIo();
    const code = await runCli(
      [
        "create-image",
        "--name",
        "quoted",
        "--runtime",
        "node",
        "--output",
        "custom $HOME",
        "--no-build",
      ],
      directory,
      output.io,
      dependencies(),
    );

    expect(code).toBe(0);
    expect(output.logs.join("\n")).toContain(
      "docker build --tag anvia-sandbox-quoted:latest 'custom $HOME'",
    );
  });

  it("only force-regenerates recognized files and preserves unrelated files", async () => {
    const directory = await temporaryDirectory();
    const initial = ["create-image", "--name", "refresh", "--feature", "artifacts", "--no-build"];
    expect(await runCli(initial, directory, captureIo().io, dependencies())).toBe(0);
    expect(await runCli(initial, directory, captureIo().io, dependencies())).toBe(1);

    const contextPath = path.join(directory, ".anvia", "sandbox-images", "refresh");
    await writeFile(path.join(contextPath, "notes.txt"), "keep", "utf8");
    const refreshed = await runCli(
      ["create-image", "--name", "refresh", "--runtime", "node", "--no-build", "--force"],
      directory,
      captureIo().io,
      dependencies(),
    );

    expect(refreshed).toBe(0);
    await expect(readFile(path.join(contextPath, "notes.txt"), "utf8")).resolves.toBe("keep");
    await expect(readFile(path.join(contextPath, "pyproject.toml"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses to overwrite an unrelated directory even with force", async () => {
    const directory = await temporaryDirectory();
    const outputPath = path.join(directory, "existing");
    await mkdir(outputPath);
    await writeFile(path.join(outputPath, "Dockerfile"), "FROM scratch\n", "utf8");
    const output = captureIo();

    const code = await runCli(
      [
        "create-image",
        "--name",
        "safe",
        "--runtime",
        "node",
        "--output",
        outputPath,
        "--no-build",
        "--force",
      ],
      directory,
      output.io,
      dependencies(),
    );

    expect(code).toBe(1);
    expect(output.errors[0]).toContain("was not generated by @anvia/sandbox");
    await expect(readFile(path.join(outputPath, "Dockerfile"), "utf8")).resolves.toBe(
      "FROM scratch\n",
    );
  });

  it("uses the interactive prompt adapter and handles cancellation", async () => {
    const directory = await temporaryDirectory();
    const prompted = await runCli(["create-image"], directory, captureIo().io, {
      ...dependencies(),
      isTTY: true,
      prompt: async () => ({
        name: "wizard",
        runtimes: ["python"],
        features: [],
        apt: [],
        npm: [],
        uv: [],
        build: false,
      }),
    });
    expect(prompted).toBe(0);

    const cancelled = await runCli(["create-image"], directory, captureIo().io, {
      ...dependencies(),
      isTTY: true,
      prompt: async () => undefined,
    });
    expect(cancelled).toBe(130);
  });

  it("keeps generated sources when a Docker build fails", async () => {
    const directory = await temporaryDirectory();
    const output = captureIo();
    const code = await runCli(
      ["create-image", "--name", "failed", "--runtime", "node"],
      directory,
      output.io,
      dependencies({
        buildImage: async () => {
          throw new Error("Docker build failed");
        },
      }),
    );

    expect(code).toBe(1);
    expect(output.errors).toEqual(["Docker build failed"]);
    await expect(
      readFile(path.join(directory, ".anvia", "sandbox-images", "failed", "Dockerfile"), "utf8"),
    ).resolves.toContain("FROM node:");
    expect(output.logs.join("\n")).not.toContain("Use with @anvia/sandbox");
  });
});

function dependencies(overrides: SandboxImageCliDependencies = {}): SandboxImageCliDependencies {
  return {
    isTTY: false,
    packageVersion: "0.5.0-test",
    buildImage: async () => {},
    ...overrides,
  };
}

function captureIo(): {
  io: SandboxImageCliIo;
  logs: string[];
  warnings: string[];
  errors: string[];
} {
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    warnings,
    errors,
    io: {
      log: (message) => logs.push(message),
      warn: (message) => warnings.push(message),
      error: (message) => errors.push(message),
      stdout: (chunk) => logs.push(new TextDecoder().decode(chunk)),
      stderr: (chunk) => errors.push(new TextDecoder().decode(chunk)),
    },
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "anvia-sandbox-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}
