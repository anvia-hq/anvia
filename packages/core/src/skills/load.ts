import { skillInstructions } from "./instructions";
import { createSkillTools } from "./tools";
import type { Skill, SkillLoader, SkillSet } from "./types";

export async function loadSkills(loaders: SkillLoader | SkillLoader[]): Promise<SkillSet> {
  const ordered = Array.isArray(loaders) ? loaders : [loaders];
  const byName = new Map<string, Skill>();

  for (const loader of ordered) {
    for (const loaded of await loader.load()) {
      byName.delete(loaded.name);
      byName.set(loaded.name, loaded);
    }
  }

  const skills = [...byName.values()];
  return {
    skills,
    instructions: skillInstructions(skills),
    tools: skills.length === 0 ? [] : createSkillTools(skills),
  };
}
