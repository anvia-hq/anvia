import type { SkillsTargetResult, SkillsWriteResult } from "../index";

export function printAdapterTargets(targets: SkillsTargetResult[], anviaChanged: number): void {
  let changed = anviaChanged;

  for (const target of targets) {
    if (target.target === "anvia") {
      continue;
    }

    const written = target.created.length + target.updated.length;
    changed += written;

    if (target.target === "agents" || target.target === "codex") {
      printAgentsTarget(target);
      continue;
    }

    const label = target.target === "claude" ? ".claude/skills" : ".cursor/rules";

    if (written === 0) {
      printUpToDate(label, target.skipped);
      continue;
    }

    console.log(`${label}: synced ${written} ${written === 1 ? "file" : "files"}.`);
  }

  if (changed === 0) {
    console.log("No skill files changed.");
  }
}

export function reportSkills(result: SkillsWriteResult, mode: "init" | "update"): number {
  const createdPaths = new Set(result.created);
  const updatedPaths = new Set(result.updated);
  const isWritten = (path: string): boolean => createdPaths.has(path) || updatedPaths.has(path);

  let changeCount = 0;

  for (const skill of result.report) {
    const createdCount = skill.files.filter((file) => createdPaths.has(file.path)).length;
    const updatedCount = skill.files.filter((file) => updatedPaths.has(file.path)).length;
    const changedCount = createdCount + updatedCount;
    const skippedCount = skill.files.filter(
      (file) => file.status === "modified" && !isWritten(file.path),
    ).length;

    const skipNote =
      skippedCount > 0
        ? `  skipped ${skippedCount} modified ${skippedCount === 1 ? "file" : "files"} (use --force to overwrite).`
        : undefined;

    changeCount += changedCount;

    if (changedCount === 0) {
      reportUnchangedSkill(skill.name, skill.installed, skipNote);
      continue;
    }

    if (mode === "init") {
      reportChangedSkillInit(skill.name, createdCount, updatedCount, skipNote);
      continue;
    }

    console.log(
      `skills/${skill.name}: updated ${changedCount} ${changedCount === 1 ? "file" : "files"}.`,
    );
  }

  return changeCount;
}

function printAgentsTarget(target: SkillsTargetResult): void {
  if (target.created.length > 0) {
    console.log("Created AGENTS.md (Anvia skills section).");
  } else if (target.updated.length > 0) {
    console.log("Updated AGENTS.md (Anvia skills section).");
  } else {
    console.log("AGENTS.md: up to date.");
  }
}

function printUpToDate(label: string, skipped: number): void {
  if (skipped > 0) {
    console.log(
      `${label}: skipped ${skipped} modified ${skipped === 1 ? "file" : "files"} (use --force to overwrite).`,
    );
    return;
  }

  console.log(`${label}: up to date.`);
}

function reportUnchangedSkill(
  name: string,
  installed: boolean,
  skipNote: string | undefined,
): void {
  if (!installed) {
    console.log(`skills/${name}: not installed. Run \`anvia skills init\` first.`);
    return;
  }

  if (skipNote !== undefined) {
    console.log(`skills/${name}: ${skipNote.trimStart()}`);
    return;
  }

  console.log(`skills/${name}: up to date.`);
}

function reportChangedSkillInit(
  name: string,
  createdCount: number,
  updatedCount: number,
  skipNote: string | undefined,
): void {
  if (createdCount > 0) {
    const updatedNote = updatedCount > 0 ? `, updated ${updatedCount}` : "";
    console.log(
      `Created skills/${name} (${createdCount} ${createdCount === 1 ? "file" : "files"}${updatedNote}).`,
    );
  } else {
    console.log(
      `Updated skills/${name} (${updatedCount} ${updatedCount === 1 ? "file" : "files"}).`,
    );
  }

  if (skipNote !== undefined) {
    console.log(skipNote);
  }
}
