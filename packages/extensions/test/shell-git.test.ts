import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { git } from "../src/tools/git";
import { shell, type ShellCommandResult } from "../src/tools/shell";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("shell toolkit", () => {
  it("defaults requiresApproval to true and allows boolean or predicate overrides", async () => {
    const root = await makeTempDir("anvia-shell-");

    const defaultKit = shell({ rootDir: root });
    expect(defaultKit.tools[0]!.requiresApproval).toBe(true);

    const openKit = shell({ rootDir: root, requiresApproval: false });
    expect(openKit.tools[0]!.requiresApproval).toBe(false);

    const predicateKit = shell({
      rootDir: root,
      requiresApproval: {
        run_command: (args) => (args as { command: string }).command !== "echo",
      },
    });
    expect(typeof predicateKit.tools[0]!.requiresApproval).toBe("function");
  });

  it("executes commands in execFile mode with sanitized env and scoped cwd", async () => {
    const root = await makeTempDir("anvia-shell-exec-");
    const subDir = path.join(root, "sub");
    await mkdir(subDir);

    const secretKey = "ANVIA_TEST_SUPER_SECRET_KEY";
    process.env[secretKey] = "must-not-leak";

    try {
      const kit = shell({
        rootDir: root,
        requiresApproval: false,
        env: { CUSTOM_FLAG: "yes" },
      });
      const runTool = kit.tools[0]!;

      const res = (await runTool.call({
        command: process.execPath,
        args: [
          "-e",
          `console.log(JSON.stringify({ secret: process.env.${secretKey} ?? null, custom: process.env.CUSTOM_FLAG, cwd: process.cwd() }))`,
        ],
        cwd: "sub",
      })) as ShellCommandResult;

      expect(res.exitCode).toBe(0);
      expect(res.timedOut).toBe(false);
      expect(res.cwd).toBe("sub");
      const parsed = JSON.parse(res.stdout) as {
        secret: string | null;
        custom: string;
        cwd: string;
      };
      expect(parsed.secret).toBeNull();
      expect(parsed.custom).toBe("yes");
      expect(path.basename(parsed.cwd)).toBe("sub");

      await expect(
        runTool.call({ command: process.execPath, args: ["-v"], cwd: ".." }),
      ).rejects.toThrow(/escapes/);
    } finally {
      delete process.env[secretKey];
    }
  });

  it("enforces allowedCommands, deniedCommands, and blocks metacharacters in shell mode when allowlisted", async () => {
    const root = await makeTempDir("anvia-shell-policy-");
    expect(() => shell({ rootDir: root, allowedCommands: [] })).toThrow(/must not be empty/);

    const restricted = shell({
      rootDir: root,
      mode: "shell",
      allowedCommands: ["echo"],
      requiresApproval: false,
    });
    const runTool = restricted.tools[0]!;

    const ok = (await runTool.call({ command: "echo hello" })) as ShellCommandResult;
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.trim()).toBe("hello");

    await expect(runTool.call({ command: "echo hi; uname" })).rejects.toThrow(/metacharacters/);
    await expect(runTool.call({ command: "A=/echo uname" })).rejects.toThrow(/metacharacters/);
    await expect(runTool.call({ command: "uname" })).rejects.toThrow(/allowedCommands/);

    const execAllow = shell({
      rootDir: root,
      allowedCommands: ["git"],
      requiresApproval: false,
    });
    await expect(execAllow.tools[0]!.call({ command: "./git", args: ["status"] })).rejects.toThrow(
      /allowedCommands/,
    );

    const deniedShell = shell({
      rootDir: root,
      mode: "shell",
      deniedCommands: ["uname"],
      requiresApproval: false,
    });
    await expect(deniedShell.tools[0]!.call({ command: "echo ok; uname" })).rejects.toThrow(
      /metacharacters/,
    );

    const denied = shell({
      rootDir: root,
      deniedCommands: [path.basename(process.execPath)],
      requiresApproval: false,
    });
    await expect(
      denied.tools[0]!.call({ command: process.execPath, args: ["-v"] }),
    ).rejects.toThrow(/denied/);
  });

  it("terminates timed-out commands and truncates oversized output", async () => {
    const root = await makeTempDir("anvia-shell-bounds-");
    const kit = shell({
      rootDir: root,
      timeoutMs: 150,
      maxOutputChars: 30,
      requiresApproval: false,
    });
    const runTool = kit.tools[0]!;

    const noisy = (await runTool.call({
      command: process.execPath,
      args: ["-e", "process.stdout.write('a'.repeat(200))"],
    })) as ShellCommandResult;
    expect(noisy.truncated).toBe(true);
    expect(noisy.stdout.length).toBeLessThanOrEqual(30);

    const slow = (await runTool.call({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
    })) as ShellCommandResult;
    expect(slow.timedOut).toBe(true);
  });
});

describe("git toolkit", () => {
  async function initGitRepo(): Promise<string> {
    const dir = await makeTempDir("anvia-git-");
    execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: dir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: dir, stdio: "ignore" });
    await writeFile(path.join(dir, "README.md"), "hello\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "initial commit"], { cwd: dir, stdio: "ignore" });
    return dir;
  }

  it("registers read-only tools by default and inspects status, diff, log, show, branch", async () => {
    const repo = await initGitRepo();
    await writeFile(path.join(repo, "README.md"), "hello\nworld\n", "utf8");

    const kit = git({ rootDir: repo });
    const names = kit.tools.map((tool) => tool.name);
    expect(names).toEqual(["git_status", "git_diff", "git_log", "git_show", "git_branch"]);

    const byName = new Map(kit.tools.map((tool) => [tool.name, tool]));
    const status = (await byName.get("git_status")!.call({})) as { status: string };
    expect(status.status).toContain("README.md");

    const diff = (await byName.get("git_diff")!.call({ path: "README.md" })) as { diff: string };
    expect(diff.diff).toContain("+world");

    const log = (await byName.get("git_log")!.call({ maxCount: 5 })) as {
      commits: { subject: string }[];
    };
    expect(log.commits).toHaveLength(1);
    expect(log.commits[0]!.subject).toBe("initial commit");

    const show = (await byName.get("git_show")!.call({ ref: "HEAD", statOnly: true })) as {
      content: string;
    };
    expect(show.content).toContain("initial commit");

    const branch = (await byName.get("git_branch")!.call({})) as {
      current: string;
      branches: string[];
    };
    expect(branch.current).toBe("main");
    expect(branch.branches).toContain("main");

    await expect(byName.get("git_show")!.call({ ref: "--exec=evil" })).rejects.toThrow(
      /must not start with/,
    );
  });

  it("registers approval-gated git_commit and git_stage when readOnly is false", async () => {
    const repo = await initGitRepo();
    await writeFile(path.join(repo, "notes.txt"), "new note\n", "utf8");

    const kit = git({ rootDir: repo, readOnly: false });
    const byName = new Map(kit.tools.map((tool) => [tool.name, tool]));
    expect(byName.get("git_commit")!.requiresApproval).toBe(true);

    await byName.get("git_stage")!.call({ paths: ["notes.txt"] });
    const commitRes = (await byName.get("git_commit")!.call({ message: "add notes" })) as {
      output: string;
    };
    expect(commitRes.output).toContain("add notes");

    const log = (await byName.get("git_log")!.call({ maxCount: 5 })) as {
      commits: { subject: string }[];
    };
    expect(log.commits[0]!.subject).toBe("add notes");
  });
});
