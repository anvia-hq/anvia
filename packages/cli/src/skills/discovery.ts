import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function bundledSkillsDirectory(): string {
  return fileURLToPath(new URL("../skills/", import.meta.url));
}

export function skillNames(options: { skillsDirectory?: string } = {}): string[] {
  const directory = options.skillsDirectory ?? bundledSkillsDirectory();

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function skillsTargetDirectory(options: { cwd?: string; dir?: string } = {}): string {
  const cwd = options.cwd ?? process.cwd();

  return join(cwd, options.dir ?? "skills");
}

export function collectSkillFiles(root: string): string[] {
  const files: string[] = [];

  const visit = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const entry of entries) {
      if (entry.isDirectory()) {
        visit(join(directory, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        files.push(`${prefix}${entry.name}`);
      }
    }
  };

  visit(root, "");

  return files;
}

export function skillDescription(skillsDirectory: string, name: string): string {
  const source = readFileSync(join(skillsDirectory, name, "SKILL.md"), "utf8");

  return (/^description:\s*(.+)$/m.exec(source)?.[1] ?? "").trim();
}
