import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const distCli = join(import.meta.dirname, "../dist/cli.js");

// Guards the dist-relative asset lookup (dist/skills/) that source-level tests
// bypass by passing an explicit skillsDirectory. Skips when the package has
// not been built; CI builds before testing so this runs there.
describe.runIf(existsSync(distCli))("built CLI skills assets", () => {
  it("lists bundled skills from dist/skills", () => {
    const result = spawnSync(process.execPath, [distCli, "skills", "list"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const skillLines = result.stdout.split("\n").filter((line) => line.startsWith("skills/"));

    expect(skillLines).toContain("skills/anvia-agent");
    expect(skillLines.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("skills available");
  });
});

function run(args: string[]) {
  return spawnSync(process.execPath, [distCli, ...args], { encoding: "utf8" });
}

function snapshot(root: string): Record<string, { content: string; mode: number; mtime: number }> {
  const files: Record<string, { content: string; mode: number; mtime: number }> = {};
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        const stat = statSync(path);
        files[path] = { content: readFileSync(path, "utf8"), mode: stat.mode, mtime: stat.mtimeMs };
      }
    }
  }
  visit(root);
  return files;
}

describe.runIf(existsSync(distCli))("built CLI update contract", () => {
  it("previews all skills targets without changing bytes, modes, or timestamps, then applies", () => {
    const cwd = mkdtempSync(join(tmpdir(), "anvia-cli-preview-"));
    const flags = ["--cwd", cwd, "--dir", "knowledge", "--claude", "--cursor", "--codex"];
    try {
      expect(run(["skills", "init", ...flags]).status).toBe(0);
      const canonical = join(cwd, "knowledge/anvia-agent/SKILL.md");
      const agents = join(cwd, "AGENTS.md");
      writeFileSync(canonical, "# local skill\n");
      writeFileSync(agents, "# project instructions\n");
      const before = snapshot(cwd);
      const preview = run(["skills", "update", ...flags]);
      expect(preview.status).toBe(0);
      expect(preview.stdout).toContain("codex: would update");
      expect(preview.stdout).toContain("--apply");
      expect(snapshot(cwd)).toEqual(before);
      expect(run(["skills", "update", ...flags, "--apply"]).status).toBe(0);
      expect(readFileSync(canonical, "utf8")).not.toBe("# local skill\n");
      expect(readFileSync(agents, "utf8")).toContain("# project instructions");
      expect(readFileSync(agents, "utf8")).toContain("anvia-skills:start");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("previews and applies UI updates through both grouped and legacy commands", () => {
    const cwd = mkdtempSync(join(tmpdir(), "anvia-cli-ui-"));
    try {
      writeFileSync(
        join(cwd, "components.json"),
        JSON.stringify({ aliases: { components: "@/components" } }),
      );
      writeFileSync(
        join(cwd, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      );
      const directory = join(cwd, "src/components/anvia");
      mkdirSync(directory, { recursive: true });
      const path = join(directory, "markdown.tsx");
      writeFileSync(path, "// local component\n");
      const before = snapshot(cwd);
      for (const prefix of [["ui", "update"], ["update"]]) {
        const preview = run([...prefix, "markdown", "--cwd", cwd]);
        expect(preview.status).toBe(0);
        expect(preview.stdout).toContain("--apply");
        expect(snapshot(cwd)).toEqual(before);
      }
      expect(run(["ui", "update", "markdown", "--cwd", cwd, "--apply"]).status).toBe(0);
      expect(readFileSync(path, "utf8")).toBe(
        readFileSync(join(import.meta.dirname, "../registry/markdown.tsx"), "utf8"),
      );
      writeFileSync(path, "// another edit\n");
      expect(run(["update", "markdown", "--cwd", cwd, "--overwrite"]).status).toBe(0);
      expect(readFileSync(path, "utf8")).not.toBe("// another edit\n");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns a failing exit code for unknown commands and flags", () => {
    expect(run(["unknown"]).status).toBe(1);
    const invalid = run(["skills", "update", "--aply"]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Unknown option "--aply"');
  });

  it("uses the bundled React UI version independently of the CLI version", async () => {
    const { createRegistryItem } = await import(join(import.meta.dirname, "../dist/index.js"));
    const reactUi = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../react-ui/package.json"), "utf8"),
    ) as { version: string };
    expect(createRegistryItem("chat").dependencies).toEqual([`@anvia/react-ui@${reactUi.version}`]);
  });
});
