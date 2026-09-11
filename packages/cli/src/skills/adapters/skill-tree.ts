import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { collectSkillFiles, skillNames } from "../discovery";
import type { SkillsSyncOutcome, SkillsWriteMode } from "../types";

export type SkillTreeSyncOptions = {
  skillsDirectory: string;
  targetRoot: string;
  force: boolean;
  mode: SkillsWriteMode;
};

/**
 * Copy the canonical `./skills/<name>/` tree (used by the `anvia` target and
 * the self-contained `.claude/skills/<name>/` copy).
 */
export function syncSkillTree(options: SkillTreeSyncOptions): SkillsSyncOutcome {
  const created: string[] = [];
  const updated: string[] = [];
  let skipped = 0;

  for (const name of skillNames({ skillsDirectory: options.skillsDirectory })) {
    const sourceRoot = join(options.skillsDirectory, name);
    const targetRoot = join(options.targetRoot, name);
    const sourceFiles = collectSkillFiles(sourceRoot);

    if (options.mode === "update" && !isSkillInstalled(targetRoot, sourceFiles)) {
      continue;
    }

    for (const relativePath of sourceFiles) {
      const outcome = syncOneFile(sourceRoot, targetRoot, relativePath, options);

      if (outcome === "created") {
        created.push(join(targetRoot, relativePath));
      } else if (outcome === "updated") {
        updated.push(join(targetRoot, relativePath));
      } else if (outcome === "skipped") {
        skipped += 1;
      }
    }
  }

  return { created, updated, skipped };
}

function isSkillInstalled(targetRoot: string, sourceFiles: string[]): boolean {
  return sourceFiles.some((file) => existsSync(join(targetRoot, file)));
}

function syncOneFile(
  sourceRoot: string,
  targetRoot: string,
  relativePath: string,
  options: Pick<SkillTreeSyncOptions, "force" | "mode">,
): "created" | "updated" | "unchanged" | "skipped" {
  const sourcePath = join(sourceRoot, relativePath);
  const targetPath = join(targetRoot, relativePath);
  const content = readFileSync(sourcePath, "utf8");

  if (!existsSync(targetPath)) {
    if (options.mode === "update" && !options.force) {
      return "skipped";
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content);
    chmodSync(targetPath, statSync(sourcePath).mode & 0o777);

    return "created";
  }

  if (readFileSync(targetPath, "utf8") === content) {
    return "unchanged";
  }

  if (!options.force) {
    return "skipped";
  }

  writeFileSync(targetPath, content);
  chmodSync(targetPath, statSync(sourcePath).mode & 0o777);

  return "updated";
}
