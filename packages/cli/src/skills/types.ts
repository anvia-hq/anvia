export type SkillFileStatus = "up-to-date" | "modified" | "missing";

export type InstalledSkillFile = {
  relativePath: string;
  path: string;
  status: SkillFileStatus;
};

export type InstalledSkillReport = {
  name: string;
  installed: boolean;
  complete: boolean;
  files: InstalledSkillFile[];
};

export const skillsTargetNames = ["anvia", "claude", "codex", "cursor", "agents"] as const;

export type SkillsTarget = (typeof skillsTargetNames)[number];

export function isSkillsTarget(value: string): value is SkillsTarget {
  return (skillsTargetNames as readonly string[]).includes(value);
}

export type SkillsTargetResult = {
  target: SkillsTarget;
  created: string[];
  updated: string[];
  skipped: number;
};

export type SkillsWriteResult = {
  report: InstalledSkillReport[];
  created: string[];
  updated: string[];
  targets: SkillsTargetResult[];
};

export type SkillsOptions = {
  cwd?: string;
  dir?: string;
  skillsDirectory?: string;
  targets?: readonly SkillsTarget[];
};

export type SkillsWriteMode = "init" | "update";

export type SkillsSyncOutcome = {
  created: string[];
  updated: string[];
  skipped: number;
};
