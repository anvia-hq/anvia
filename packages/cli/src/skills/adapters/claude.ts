import { join } from "node:path";

import type { SkillsSyncOutcome, SkillsWriteMode } from "../types";
import { syncSkillTree } from "./skill-tree";

export type ClaudeSyncOptions = {
  cwd: string;
  skillsDirectory: string;
  force: boolean;
  mode: SkillsWriteMode;
};

/**
 * Write the self-contained `.claude/skills/<name>/` copy. Unlike the Cursor
 * and AGENTS.md adapters, this one duplicates content so Claude Code works
 * without resolving pointers back into `./skills`.
 */
export function syncClaudeSkills(options: ClaudeSyncOptions): SkillsSyncOutcome {
  return syncSkillTree({
    skillsDirectory: options.skillsDirectory,
    targetRoot: join(options.cwd, ".claude", "skills"),
    force: options.force,
    mode: options.mode,
  });
}
