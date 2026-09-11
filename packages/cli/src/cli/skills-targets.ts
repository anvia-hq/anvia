import { isSkillsTarget, type SkillsTarget } from "../index";

const targetFlags = [
  ["--claude", "claude"],
  ["--codex", "codex"],
  ["--cursor", "cursor"],
  ["--agents", "agents"],
] as const;

export function parseSkillsTargets(args: string[]): SkillsTarget[] {
  const targets: SkillsTarget[] = [];

  for (const [flag, target] of targetFlags) {
    if (args.includes(flag) && isSkillsTarget(target)) {
      targets.push(target);
    }
  }

  return targets;
}
