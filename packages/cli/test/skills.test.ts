import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { initSkills, inspectInstalledSkills, skillNames, updateSkills } from "../src";

const skillsDirectory = join(import.meta.dirname, "../../../skills");

const expectedSkills = [
  "anvia-agent",
  "anvia-channels",
  "anvia-chat",
  "anvia-durable",
  "anvia-evals",
  "anvia-mcp",
  "anvia-pipeline",
  "anvia-rag",
  "anvia-studio",
  "release-notes",
];

function createProject(): string {
  return mkdtempSync(join(tmpdir(), "anvia-skills-"));
}

function skillPath(cwd: string, name: string, relativePath: string, dir = "skills"): string {
  return join(cwd, dir, name, relativePath);
}

function skillSource(name: string, relativePath: string): string {
  return readFileSync(join(skillsDirectory, name, relativePath), "utf8");
}

/**
 * Assert a copied skill script carries the executable bit.
 *
 * POSIX file modes cannot be represented on Windows, where `chmod` is a no-op, so the
 * assertion only holds on POSIX. The mode is still checked there; on Windows the copy
 * itself is covered by the surrounding existence and content assertions.
 */
function expectExecutableScript(path: string): void {
  if (process.platform === "win32") return;
  expect(statSync(path).mode & 0o111).not.toBe(0);
}

describe("skillNames", () => {
  it("lists every bundled skill", () => {
    expect(skillNames({ skillsDirectory })).toEqual(expectedSkills);
  });
});

describe("initSkills", () => {
  it("copies every skill with executable scripts and no folder README", () => {
    const cwd = createProject();
    const { created, report } = initSkills({ cwd, skillsDirectory });
    expect(created.length).toBeGreaterThan(0);
    expect(report.map((skill) => skill.name)).toEqual(expectedSkills);
    expect(report.every((skill) => skill.installed && skill.complete)).toBe(true);
    expect(existsSync(skillPath(cwd, "anvia-agent", "SKILL.md"))).toBe(true);
    expectExecutableScript(skillPath(cwd, "anvia-agent", "scripts/check-agent.sh"));
    expectExecutableScript(skillPath(cwd, "anvia-durable", "scripts/check-durable.sh"));
    expect(
      readFileSync(skillPath(cwd, "anvia-durable", "references/tasks-and-subagents.md"), "utf8"),
    ).toBe(skillSource("anvia-durable", "references/tasks-and-subagents.md"));
    expect(existsSync(join(cwd, "skills", "README.md"))).toBe(false);
    expect(readFileSync(skillPath(cwd, "anvia-rag", "SKILL.md"), "utf8")).toBe(
      skillSource("anvia-rag", "SKILL.md"),
    );
    rmSync(cwd, { recursive: true, force: true });
  });

  it("honors a custom target directory", () => {
    const cwd = createProject();
    initSkills({ cwd, dir: "agents", skillsDirectory });
    expect(existsSync(skillPath(cwd, "anvia-agent", "SKILL.md", "agents"))).toBe(true);
    expect(existsSync(skillPath(cwd, "anvia-agent", "SKILL.md"))).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("is idempotent when nothing changed", () => {
    const cwd = createProject();
    initSkills({ cwd, skillsDirectory });
    const second = initSkills({ cwd, skillsDirectory });
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(
      second.report.every((skill) => skill.files.every((file) => file.status === "up-to-date")),
    ).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("skips modified files unless forced", () => {
    const cwd = createProject();
    initSkills({ cwd, skillsDirectory });
    const skill = "anvia-agent";
    const file = "SKILL.md";
    writeFileSync(skillPath(cwd, skill, file), "# locally edited\n");
    const blocked = initSkills({ cwd, skillsDirectory });
    expect(blocked.updated).toEqual([]);
    expect(readFileSync(skillPath(cwd, skill, file), "utf8")).toBe("# locally edited\n");
    const item = blocked.report.find((entry) => entry.name === skill);
    expect(item?.files.find((entry) => entry.relativePath === file)?.status).toBe("modified");
    const forced = initSkills({ cwd, force: true, skillsDirectory });
    expect(forced.updated).toEqual([skillPath(cwd, skill, file)]);
    expect(readFileSync(skillPath(cwd, skill, file), "utf8")).toBe(skillSource(skill, file));
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("updateSkills", () => {
  it("writes nothing without force", () => {
    const cwd = createProject();
    initSkills({ cwd, skillsDirectory });
    writeFileSync(skillPath(cwd, "anvia-mcp", "SKILL.md"), "# locally edited\n");
    const result = updateSkills({ cwd, skillsDirectory });
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(readFileSync(skillPath(cwd, "anvia-mcp", "SKILL.md"), "utf8")).toBe(
      "# locally edited\n",
    );
    rmSync(cwd, { recursive: true, force: true });
  });

  it("restores missing files of installed skills with force", () => {
    const cwd = createProject();
    initSkills({ cwd, skillsDirectory });
    const missing = skillPath(cwd, "anvia-mcp", "references/clients.md");
    rmSync(missing, { force: true });
    const result = updateSkills({ cwd, force: true, skillsDirectory });
    expect([...result.created, ...result.updated]).toContain(missing);
    expect(readFileSync(missing, "utf8")).toBe(skillSource("anvia-mcp", "references/clients.md"));
    rmSync(cwd, { recursive: true, force: true });
  });

  it("does not install skills that were never installed, even with force", () => {
    const cwd = createProject();
    initSkills({ cwd, skillsDirectory });
    rmSync(join(cwd, "skills", "release-notes"), { recursive: true, force: true });
    const result = updateSkills({ cwd, force: true, skillsDirectory });
    expect(existsSync(join(cwd, "skills", "release-notes"))).toBe(false);
    expect(result.report.find((skill) => skill.name === "release-notes")?.installed).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reports three-state file status", () => {
    const cwd = createProject();
    initSkills({ cwd, skillsDirectory });
    writeFileSync(skillPath(cwd, "anvia-evals", "SKILL.md"), "# locally edited\n");
    rmSync(skillPath(cwd, "anvia-evals", "references/metrics.md"), { force: true });
    const report = inspectInstalledSkills({ cwd, skillsDirectory });
    const evals = report.find((skill) => skill.name === "anvia-evals");
    const statuses = new Map(evals?.files.map((file) => [file.relativePath, file.status]));
    expect(statuses.get("SKILL.md")).toBe("modified");
    expect(statuses.get("references/metrics.md")).toBe("missing");
    expect(statuses.get("references/judges.md")).toBe("up-to-date");
    expect(evals?.complete).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("adapter targets", () => {
  it("creates Claude-native skill folders alongside ./skills", () => {
    const cwd = createProject();
    const result = initSkills({ cwd, targets: ["claude"], skillsDirectory });
    expect(existsSync(join(cwd, ".claude", "skills", "anvia-agent", "SKILL.md"))).toBe(true);
    expect(existsSync(skillPath(cwd, "anvia-agent", "SKILL.md"))).toBe(true);
    expectExecutableScript(
      join(cwd, ".claude", "skills", "anvia-agent", "scripts", "check-agent.sh"),
    );
    const claude = result.targets.find((target) => target.target === "claude");
    expect(claude?.created.length).toBeGreaterThan(0);
    const second = initSkills({ cwd, targets: ["claude"], skillsDirectory });
    const claudeSecond = second.targets.find((target) => target.target === "claude");
    expect(claudeSecond?.created.length).toBe(0);
    expect(claudeSecond?.updated.length).toBe(0);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("appends a marker-managed AGENTS.md section and preserves user content", () => {
    const cwd = createProject();
    writeFileSync(join(cwd, "AGENTS.md"), "# My project\n\nCustom notes.\n");
    const result = initSkills({ cwd, targets: ["agents"], skillsDirectory });
    const doc = readFileSync(join(cwd, "AGENTS.md"), "utf8");
    expect(doc).toContain("# My project");
    expect(doc).toContain("Custom notes.");
    expect(doc).toContain("<!-- anvia-skills:start -->");
    expect(doc).toContain("<!-- anvia-skills:end -->");
    expect(doc).toContain("`skills/anvia-agent/SKILL.md`");
    const agents = result.targets.find((target) => target.target === "agents");
    expect(agents?.updated).toEqual([join(cwd, "AGENTS.md")]);
    const second = initSkills({ cwd, targets: ["agents"], skillsDirectory });
    const agentsSecond = second.targets.find((target) => target.target === "agents");
    expect(agentsSecond?.created.length).toBe(0);
    expect(agentsSecond?.updated.length).toBe(0);
    expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toBe(doc);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("treats --codex as the AGENTS.md target", () => {
    const cwd = createProject();
    const result = initSkills({ cwd, targets: ["codex"], skillsDirectory });
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(true);
    expect(result.targets.map((target) => target.target)).toEqual(["anvia", "codex"]);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates Cursor rules that point at the canonical skills folder", () => {
    const cwd = createProject();
    const result = initSkills({ cwd, targets: ["cursor"], skillsDirectory });
    const rule = join(cwd, ".cursor", "rules", "anvia-agent.mdc");
    expect(existsSync(rule)).toBe(true);
    const content = readFileSync(rule, "utf8");
    expect(content).toContain('description: "Build Anvia agents');
    expect(content).toContain("alwaysApply: false");
    expect(content).toContain("`skills/anvia-agent/SKILL.md`");
    expect(result.targets.find((target) => target.target === "cursor")?.created.length).toBe(
      expectedSkills.length,
    );
    writeFileSync(rule, '---\ndescription: "locally edited"\n---\n');
    const blocked = initSkills({ cwd, targets: ["cursor"], skillsDirectory });
    const cursorBlocked = blocked.targets.find((target) => target.target === "cursor");
    expect(cursorBlocked?.skipped).toBe(1);
    const forced = initSkills({ cwd, force: true, targets: ["cursor"], skillsDirectory });
    const cursorForced = forced.targets.find((target) => target.target === "cursor");
    expect(cursorForced?.updated).toEqual([rule]);
    expect(readFileSync(rule, "utf8")).toContain("alwaysApply: false");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes nothing outside ./skills by default", () => {
    const cwd = createProject();
    initSkills({ cwd, skillsDirectory });
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
    expect(existsSync(join(cwd, ".cursor"))).toBe(false);
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("points generated adapters and the loader at a custom --dir", () => {
    const cwd = createProject();
    const result = initSkills({
      cwd,
      dir: "agents",
      targets: ["cursor", "agents"],
      skillsDirectory,
    });
    expect(existsSync(join(cwd, "agents", "anvia-agent", "SKILL.md"))).toBe(true);
    expect(existsSync(skillPath(cwd, "anvia-agent", "SKILL.md"))).toBe(false);
    const doc = readFileSync(join(cwd, "AGENTS.md"), "utf8");
    expect(doc).toContain("`agents/anvia-agent/SKILL.md`");
    expect(doc).toContain("keeps Anvia Agent Skills in `agents/`");
    expect(doc).not.toContain("`skills/anvia-agent");
    const rule = readFileSync(join(cwd, ".cursor", "rules", "anvia-rag.mdc"), "utf8");
    expect(rule).toContain("`agents/anvia-rag/SKILL.md`");
    expect(rule).not.toContain("`skills/anvia-rag");
    expect(result.targets.find((target) => target.target === "cursor")?.created.length).toBe(
      expectedSkills.length,
    );
    // Re-running with the same directory stays up to date; switching directories
    // refreshes the generated pointers instead of leaving stale links.
    const again = initSkills({
      cwd,
      dir: "agents",
      targets: ["cursor", "agents"],
      skillsDirectory,
    });
    const cursorAgain = again.targets.find((target) => target.target === "cursor");
    expect(cursorAgain?.created.length).toBe(0);
    expect(cursorAgain?.updated.length).toBe(0);
    expect(again.targets.find((target) => target.target === "agents")?.updated.length).toBe(0);
    const switched = initSkills({ cwd, targets: ["cursor", "agents"], skillsDirectory });
    expect(switched.targets.find((target) => target.target === "agents")?.updated.length).toBe(1);
    expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toContain("`skills/anvia-agent/SKILL.md`");
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("skills update previews", () => {
  it.each(["agents", "codex"] as const)(
    "never creates AGENTS.md for the %s target during preview",
    (target) => {
      const cwd = createProject();
      try {
        const result = updateSkills({
          cwd,
          targets: [target, "cursor", "claude"],
          skillsDirectory,
        });
        expect(readdirSync(cwd)).toEqual([]);
        expect(result.targets.find((entry) => entry.target === target)?.pending).toEqual([
          join(cwd, "AGENTS.md"),
        ]);
        expect(
          result.targets.every((entry) => entry.created.length === 0 && entry.updated.length === 0),
        ).toBe(true);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  it("previews modified and missing files across all adapters, then applies the same changes", () => {
    const cwd = createProject();
    const targets = ["claude", "cursor", "agents"] as const;
    try {
      initSkills({ cwd, dir: "knowledge", targets, skillsDirectory });
      const canonical = skillPath(cwd, "anvia-agent", "SKILL.md", "knowledge");
      const claude = join(cwd, ".claude/skills/anvia-agent/SKILL.md");
      const cursor = join(cwd, ".cursor/rules/anvia-agent.mdc");
      const agents = join(cwd, "AGENTS.md");
      for (const path of [canonical, claude, agents]) writeFileSync(path, "# local instructions\n");
      rmSync(cursor);
      const result = updateSkills({ cwd, dir: "knowledge", targets, skillsDirectory });
      expect(result.targets.flatMap((entry) => entry.pending ?? []).sort()).toEqual(
        [canonical, claude, cursor, agents].sort(),
      );
      for (const path of [canonical, claude, agents])
        expect(readFileSync(path, "utf8")).toBe("# local instructions\n");
      expect(existsSync(cursor)).toBe(false);
      expect(
        result.targets.every((entry) => entry.created.length === 0 && entry.updated.length === 0),
      ).toBe(true);
      const applied = updateSkills({
        cwd,
        dir: "knowledge",
        targets,
        skillsDirectory,
        apply: true,
      });
      expect(
        applied.targets.flatMap((entry) => [...entry.created, ...entry.updated]).sort(),
      ).toEqual([canonical, claude, cursor, agents].sort());
      expect(readFileSync(canonical, "utf8")).toBe(skillSource("anvia-agent", "SKILL.md"));
      expect(readFileSync(claude, "utf8")).toBe(skillSource("anvia-agent", "SKILL.md"));
      expect(readFileSync(agents, "utf8")).toContain("# local instructions");
      expect(readFileSync(agents, "utf8")).toContain("knowledge/anvia-agent/SKILL.md");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
