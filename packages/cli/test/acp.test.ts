import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const acpRoot = fileURLToPath(new URL("../../acp/", import.meta.url));
const sample = pathToFileURL(join(acpRoot, "examples/sample-agent.mjs")).href;
const nativeTypes = Boolean(process.features.typescript);
const children: ReturnType<typeof spawn>[] = [];
const resourcePids: number[] = [];
let root: string;
let installed: string;
let standalone: string;
let nextModule = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "anvia cli acp "));
  // Model packed installations, with and without the optional peer. This also verifies that
  // tsup leaves the ACP dynamic import external rather than bundling the runtime into the CLI.
  for (const name of ["installed", "standalone"]) {
    cpSync(fileURLToPath(new URL("../dist/", import.meta.url)), join(root, name), {
      recursive: true,
    });
  }
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  const scope = join(root, "installed/node_modules/@anvia");
  mkdirSync(scope, { recursive: true });
  symlinkSync(acpRoot, join(scope, "acp"), "dir");
  installed = join(root, "installed/cli.js");
  standalone = join(root, "standalone/cli.js");
});
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const pid of resourcePids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Successfully disposed resources have already exited.
    }
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function moduleFile(source: string, extension = "mjs"): string {
  const path = join(root, `agent ${++nextModule}.${extension}`);
  writeFileSync(path, source);
  return path;
}

function launch(args: string[], cli = installed, nodeArgs: string[] = []) {
  const child = spawn(process.execPath, [...nodeArgs, cli, ...args], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  let nextId = 0;
  child.stdout!.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr!.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const closed = once(child, "close");
  const frames = () =>
    stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return {
    child,
    closed,
    stdout: () => stdout,
    stderr: () => stderr,
    async request(method: string, params: unknown) {
      const id = ++nextId;
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      await vi.waitFor(() => expect(frames().some((frame) => frame.id === id)).toBe(true), {
        timeout: 5_000,
      });
      return frames().find((frame) => frame.id === id);
    },
  };
}

describe("built anvia acp", () => {
  it.each(["default agent", "named agent", "named factory", "default factory"])(
    "loads a JS %s, creates a session and completes successive prompts",
    async (kind) => {
      const exports = {
        "default agent": "export default agent;",
        "named agent": "export { agent };",
        "named factory": "export const sessionFactory = () => ({ agent });",
        "default factory": "export default () => ({ agent });",
      };
      const path = moduleFile(
        `import agent from ${JSON.stringify(sample)};\n${exports[kind as keyof typeof exports]}`,
        "js",
      );
      // Resolve relative paths from the launching project, including spaces in filenames.
      const peer = launch(["acp", "--agent", `./agent ${nextModule}.js`]);
      expect(path).toContain(" ");
      expect(await peer.request("initialize", { protocolVersion: 1 })).toMatchObject({
        result: { protocolVersion: 1, authMethods: [] },
      });
      const created = await peer.request("session/new", { cwd: root, mcpServers: [] });
      expect(created.error).toBeUndefined();
      for (const text of ["hello", "again"]) {
        expect(
          await peer.request("session/prompt", {
            sessionId: created.result.sessionId,
            prompt: [{ type: "text", text }],
          }),
        ).toMatchObject({ result: { stopReason: "end_turn" } });
      }
      peer.child.stdin!.end();
      expect(await peer.closed).toEqual([0, null]);
    },
  );

  it.runIf(nativeTypes)("loads typed TS modules using native type stripping", async () => {
    const path = moduleFile(
      `const name: string = "typed module"; console.log(name); export { default } from ${JSON.stringify(sample)};`,
      "ts",
    );
    const peer = launch(["acp", "--agent", path]);
    expect(await peer.request("initialize", { protocolVersion: 1 })).toHaveProperty("result");
    peer.child.stdin!.end();
    expect(await peer.closed).toEqual([0, null]);
    expect(peer.stderr()).toContain("typed module");
  });

  it.runIf(nativeTypes)("sanitizes unsupported TypeScript syntax errors", async () => {
    const path = moduleFile("export enum Secret { value = 'private-provider-credential' }", "ts");
    const peer = launch(["acp", "--agent", path]);
    expect(await peer.closed).toEqual([1, null]);
    expect(peer.stdout()).toBe("");
    expect(peer.stderr()).toContain("use erasable types or compile to JavaScript");
    expect(peer.stderr()).not.toContain("private-provider-credential");
  });

  it.runIf(process.allowedNodeEnvironmentFlags.has("--no-strip-types"))(
    "explains how to load TS when native stripping is disabled or unavailable",
    async () => {
      const path = moduleFile("export const value: string = 'private-provider-credential';", "ts");
      const peer = launch(["acp", "--agent", path], installed, ["--no-strip-types"]);
      expect(await peer.closed).toEqual([1, null]);
      expect(peer.stdout()).toBe("");
      expect(peer.stderr()).toContain("native type stripping");
      expect(peer.stderr()).not.toContain("private-provider-credential");
    },
  );

  it("isolates console and direct stdout writes before module evaluation", async () => {
    const peer = launch(["acp", "--agent", join(acpRoot, "test/fixtures/noisy-agent.mjs")]);
    expect(await peer.request("initialize", { protocolVersion: 1 })).toHaveProperty("result");
    peer.child.stdin!.end();
    expect(await peer.closed).toEqual([0, null]);
    for (const message of ["log", "info", "debug", "warning", "error"]) {
      expect(peer.stderr()).toContain(`module console ${message}`);
    }
    expect(peer.stderr()).toContain("module direct stdout write");
    expect(peer.stdout().trim().split("\n")).toHaveLength(1);
  });

  it.each([
    ["missing.mjs", "cannot read the agent module"],
    [".", "cannot read the agent module"],
    ["test/fixtures/invalid-module.mjs", "Anvia Agent export"],
    ["test/fixtures/throwing-module.mjs", "startup failed"],
  ])("reports safe startup diagnostics for %s", async (path, diagnostic) => {
    const peer = launch(["acp", "--agent", join(acpRoot, path)]);
    expect(await peer.closed).toEqual([1, null]);
    expect(peer.stdout()).toBe("");
    expect(peer.stderr()).toContain(diagnostic);
    expect(peer.stderr()).not.toContain("private-provider-credential");
    expect(peer.stderr()).not.toContain("at ");
  });

  it("rejects a module with no export", async () => {
    const peer = launch(["acp", "--agent", moduleFile("export {}; ")]);
    expect(await peer.closed).toEqual([1, null]);
    expect(peer.stdout()).toBe("");
    expect(peer.stderr()).toContain("sessionFactory");
  });

  it.each(["SIGINT", "SIGTERM", "EOF"] as const)(
    "awaits session disposal and terminal/MCP process exit on %s",
    async (signal) => {
      const log = join(root, `mcp-${signal}.log`);
      const path = moduleFile(`
        import { spawn } from "node:child_process";
        import { once } from "node:events";
        import sample from ${JSON.stringify(sample)};
        export const sessionFactory = (context) => {
          const terminal = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
          const terminalClosed = once(terminal, "close");
          console.error("terminal pid:", terminal.pid);
          return {
            agent: new sample.constructor({ id: "cleanup", model: sample.model, mcpServers: context.mcpServers }),
            async dispose() {
              terminal.kill();
              await terminalClosed;
              await new Promise(resolve => setTimeout(resolve, 100));
              console.error("session disposal finished");
            }
          };
        };
      `);
      const peer = launch(["acp", "--agent", path]);
      await peer.request("initialize", { protocolVersion: 1 });
      const created = await peer.request("session/new", {
        cwd: root,
        mcpServers: [
          {
            name: "fixture",
            command: process.execPath,
            args: [join(acpRoot, "test/fixtures/mcp-server.mjs")],
            env: [{ name: "FIXTURE_LOG", value: log }],
          },
        ],
      });
      expect(created.error).toBeUndefined();
      const terminalPid = Number(/terminal pid: (\d+)/.exec(peer.stderr())?.[1]);
      expect(terminalPid).toBeGreaterThan(0);
      resourcePids.push(terminalPid);
      const mcpPid = JSON.parse(readFileSync(log, "utf8").split("\n")[0]!).pid;
      resourcePids.push(mcpPid);
      if (signal === "EOF") peer.child.stdin!.end();
      else peer.child.kill(signal);
      expect(await peer.closed).toEqual([0, null]);
      expect(peer.stderr()).toContain("session disposal finished");
      const events = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events.some((event) => event.event === "exit")).toBe(true);
      expect(() => process.kill(events[0].pid, 0)).toThrow();
      expect(() => process.kill(terminalPid, 0)).toThrow();
    },
  );

  it("handles signals during asynchronous module initialization", async () => {
    const path = moduleFile(`
      console.error("module initializing");
      setInterval(() => {}, 1000);
      await new Promise(() => {});
    `);
    const peer = launch(["acp", "--agent", path]);
    await vi.waitFor(() => expect(peer.stderr()).toContain("module initializing"));
    peer.child.kill("SIGTERM");
    expect(await peer.closed).toEqual([0, null]);
    expect(peer.stdout()).toBe("");
  });

  it("bounds shutdown even when a disposer never resolves", async () => {
    const path = moduleFile(`
      import agent from ${JSON.stringify(sample)};
      export const sessionFactory = () => ({ agent, dispose: () => new Promise(() => {}) });
    `);
    const peer = launch(["acp", "--agent", path]);
    await peer.request("initialize", { protocolVersion: 1 });
    expect(await peer.request("session/new", { cwd: root, mcpServers: [] })).toHaveProperty(
      "result",
    );
    peer.child.kill("SIGTERM");
    expect(await peer.closed).toEqual([0, null]);
  }, 10_000);

  it("keeps scaffolding and help available without ACP and explains how to install it", async () => {
    const skills = launch(["skills", "list"], standalone);
    expect(await skills.closed).toEqual([0, null]);
    expect(skills.stdout()).toContain("skills/anvia-agent");
    const help = launch(["acp", "--help"], standalone);
    expect(await help.closed).toEqual([0, null]);
    expect(help.stdout()).toBe("");
    expect(help.stderr()).toContain("anvia acp --agent");
    const missing = launch(["acp", "--agent", "./agent.ts"], standalone);
    expect(await missing.closed).toEqual([1, null]);
    expect(missing.stdout()).toBe("");
    expect(missing.stderr()).toContain("pnpm add @anvia/acp @anvia/core");
  });

  it("sanitizes failures while dynamically importing an installed ACP peer", async () => {
    const directory = join(root, "broken");
    cpSync(fileURLToPath(new URL("../dist/", import.meta.url)), directory, { recursive: true });
    const peerDirectory = join(directory, "node_modules/@anvia/acp");
    mkdirSync(peerDirectory, { recursive: true });
    writeFileSync(
      join(peerDirectory, "package.json"),
      JSON.stringify({
        type: "module",
        exports: { "./launcher": "./launcher.js" },
      }),
    );
    writeFileSync(
      join(peerDirectory, "launcher.js"),
      'throw new Error("private-provider-credential");',
    );
    const peer = launch(["acp", "--agent", "./agent.ts"], join(directory, "cli.js"));
    expect(await peer.closed).toEqual([1, null]);
    expect(peer.stdout()).toBe("");
    expect(peer.stderr()).toContain("cannot load @anvia/acp");
    expect(peer.stderr()).not.toContain("private-provider-credential");
  });
});
