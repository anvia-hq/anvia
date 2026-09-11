import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { skillDescription, skillNames } from "../discovery";
import type { SkillsSyncOutcome } from "../types";

export const agentsSectionStart = "<!-- anvia-skills:start -->";
export const agentsSectionEnd = "<!-- anvia-skills:end -->";

export type AgentsDocSyncOptions = {
  agentsPath: string;
  skillsDirectory: string;
  canonicalDir: string;
};

/**
 * Maintain only the marker-owned `<!-- anvia-skills:* -->` section of
 * AGENTS.md. Everything outside the markers is left untouched.
 */
export function syncAgentsDoc(options: AgentsDocSyncOptions): SkillsSyncOutcome {
  const section = agentsSkillsSection(options.skillsDirectory, options.canonicalDir);

  if (!existsSync(options.agentsPath)) {
    mkdirSync(dirname(options.agentsPath), { recursive: true });
    writeFileSync(options.agentsPath, `# AGENTS.md\n\n${section}\n`);

    return { created: [options.agentsPath], updated: [], skipped: 0 };
  }

  const existing = readFileSync(options.agentsPath, "utf8");
  const startIndex = existing.indexOf(agentsSectionStart);
  const endIndex = existing.indexOf(agentsSectionEnd);

  let next: string;

  if (startIndex === -1 || endIndex === -1) {
    next = `${existing.replace(/\n+$/, "")}\n\n${section}\n`;
  } else {
    next =
      existing.slice(0, startIndex) + section + existing.slice(endIndex + agentsSectionEnd.length);
  }

  if (next === existing) {
    return { created: [], updated: [], skipped: 0 };
  }

  writeFileSync(options.agentsPath, next);

  return { created: [], updated: [options.agentsPath], skipped: 0 };
}

export function agentsSkillsSection(skillsDirectory: string, canonicalDir: string): string {
  const lines = skillNames({ skillsDirectory }).map(
    (name) => `- \`${canonicalDir}/${name}/SKILL.md\` — ${skillDescription(skillsDirectory, name)}`,
  );

  return [
    agentsSectionStart,
    "## Anvia Agent Skills",
    "",
    `This project keeps Anvia Agent Skills in \`${canonicalDir}/\`. When a task matches a skill, read`,
    "its `SKILL.md` first and follow it, including the `references/` files and `scripts/`",
    "it points to. Run skill scripts with `sh` when they help verify the work.",
    "",
    ...lines,
    agentsSectionEnd,
  ].join("\n");
}
