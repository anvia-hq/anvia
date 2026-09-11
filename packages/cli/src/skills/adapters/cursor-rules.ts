import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { skillDescription, skillNames } from "../discovery";
import type { SkillsSyncOutcome, SkillsWriteMode } from "../types";

export type CursorRulesSyncOptions = {
  skillsDirectory: string;
  rulesDirectory: string;
  canonicalDir: string;
  force: boolean;
  mode: SkillsWriteMode;
};

/**
 * Write one `.cursor/rules/<skill>.mdc` pointer per skill. The rule body stays
 * small on purpose: it points Cursor back at the canonical `./skills` copy.
 */
export function syncCursorRules(options: CursorRulesSyncOptions): SkillsSyncOutcome {
  const created: string[] = [];
  const updated: string[] = [];
  let skipped = 0;

  for (const name of skillNames({ skillsDirectory: options.skillsDirectory })) {
    // Skill directory names already carry their `anvia-` prefix (except the
    // release-notes demo), so the rule file is simply `<name>.mdc`.
    const targetPath = join(options.rulesDirectory, `${name}.mdc`);
    const content = cursorRuleContent(options.skillsDirectory, name, options.canonicalDir);

    if (!existsSync(targetPath)) {
      if (options.mode === "update" && !options.force) {
        continue;
      }

      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, content);
      created.push(targetPath);
      continue;
    }

    if (readFileSync(targetPath, "utf8") === content) {
      continue;
    }

    if (!options.force) {
      skipped += 1;
      continue;
    }

    writeFileSync(targetPath, content);
    updated.push(targetPath);
  }

  return { created, updated, skipped };
}

export function cursorRuleContent(
  skillsDirectory: string,
  name: string,
  canonicalDir: string,
): string {
  const description = skillDescription(skillsDirectory, name).replace(/"/g, '\\"');

  return [
    "---",
    `description: "${description}"`,
    "alwaysApply: false",
    "---",
    "",
    `When a task matches this skill, read \`${canonicalDir}/${name}/SKILL.md\` at the project root and`,
    "follow it, including the `references/` files and `scripts/` it points to. Run skill",
    "scripts with `sh` when they help verify the work.",
    "",
  ].join("\n");
}
