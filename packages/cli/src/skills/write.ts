import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { syncAgentsDoc } from "./adapters/agents-doc";
import { syncClaudeSkills } from "./adapters/claude";
import { syncCursorRules } from "./adapters/cursor-rules";
import { syncSkillTree } from "./adapters/skill-tree";
import {
  bundledSkillsDirectory,
  collectSkillFiles,
  skillNames,
  skillsTargetDirectory,
} from "./discovery";
import type {
  InstalledSkillReport,
  SkillsOptions,
  SkillsTarget,
  SkillsTargetResult,
  SkillsWriteMode,
  SkillsWriteResult,
} from "./types";

export function inspectInstalledSkills(options: SkillsOptions = {}): InstalledSkillReport[] {
  const skillsDirectory = options.skillsDirectory ?? bundledSkillsDirectory();
  const target = skillsTargetDirectory(options);

  return skillNames({ skillsDirectory }).map((name) => {
    const files = collectSkillFiles(join(skillsDirectory, name)).map((relativePath) => {
      const path = join(target, name, relativePath);

      let status: InstalledSkillReport["files"][number]["status"] = "missing";

      if (existsSync(path)) {
        const installed = readFileSync(path, "utf8");
        const source = readFileSync(join(skillsDirectory, name, relativePath), "utf8");
        status = installed === source ? "up-to-date" : "modified";
      }

      return { relativePath, path, status };
    });

    return {
      name,
      installed: files.some((file) => file.status !== "missing"),
      complete: files.every((file) => file.status !== "missing"),
      files,
    };
  });
}

export function initSkills(options: SkillsOptions & { force?: boolean } = {}): SkillsWriteResult {
  return writeSkills({ ...options, mode: "init" });
}

export function updateSkills(options: SkillsOptions & { force?: boolean } = {}): SkillsWriteResult {
  return writeSkills({ ...options, mode: "update" });
}

function writeSkills(
  options: SkillsOptions & { force?: boolean; mode: SkillsWriteMode },
): SkillsWriteResult {
  const skillsDirectory = options.skillsDirectory ?? bundledSkillsDirectory();
  const cwd = options.cwd ?? process.cwd();
  const force = options.force === true;

  // Generated pointers (AGENTS.md section, Cursor rules) must reference the
  // directory the canonical copy actually lands in.
  const canonicalDir = options.dir ?? "skills";

  const targets = new Set<SkillsTarget>(options.targets ?? ["anvia"]);

  // The ./skills copy is the canonical content every pointer-based adapter
  // references, so it is always written; the target flags add adapters on top.
  targets.add("anvia");

  const results: SkillsTargetResult[] = [];

  const anvia = syncSkillTree({
    skillsDirectory,
    targetRoot: skillsTargetDirectory(options),
    force,
    mode: options.mode,
  });
  results.push({ target: "anvia", ...anvia });

  if (targets.has("claude")) {
    const claude = syncClaudeSkills({ cwd, skillsDirectory, force, mode: options.mode });
    results.push({ target: "claude", ...claude });
  }

  if (targets.has("cursor")) {
    const cursor = syncCursorRules({
      skillsDirectory,
      rulesDirectory: join(cwd, ".cursor", "rules"),
      canonicalDir,
      force,
      mode: options.mode,
    });
    results.push({ target: "cursor", ...cursor });
  }

  if (targets.has("agents") || targets.has("codex")) {
    const doc = syncAgentsDoc({
      agentsPath: join(cwd, "AGENTS.md"),
      skillsDirectory,
      canonicalDir,
    });
    const target: SkillsTarget = targets.has("agents") ? "agents" : "codex";
    results.push({ target, ...doc });
  }

  return {
    report: inspectInstalledSkills(options),
    created: anvia.created,
    updated: anvia.updated,
    targets: results,
  };
}
