import type { Skill } from "./types";

export function skillInstructions(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  return [
    "You have access to Agent Skills.",
    "Skills are compact capability packages. Use the skill tools to load full instructions, references, or scripts only when a skill is relevant.",
    "",
    "Available skills:",
    ...skills.map(formatSkill),
    "",
    "Skill tools:",
    "- get_skill_instructions: load full SKILL.md guidance for a skill.",
    "- get_skill_reference: read a reference file from a skill.",
    "- get_skill_script: read a script file from a skill.",
    "- run_skill_script: execute a script from a skill with arguments.",
  ].join("\n");
}

function formatSkill(skill: Skill): string {
  const lines = [`- ${skill.name}: ${skill.description}`];
  if (skill.references.length > 0) {
    lines.push(`  references: ${skill.references.join(", ")}`);
  }
  if (skill.scripts.length > 0) {
    lines.push(`  scripts: ${skill.scripts.join(", ")}`);
  }
  return lines.join("\n");
}
