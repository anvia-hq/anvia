import { parse as parseYaml } from "yaml";
import { isRecord } from "../internal/record";
import type { Skill, SkillLoader, SkillValidationIssue } from "./types";
import { SkillValidationError } from "./types";

type SkillFrontmatter = {
  name?: unknown;
  description?: unknown;
  license?: unknown;
  metadata?: unknown;
};

type FsPromisesModule = typeof import("node:fs/promises");
type PathModule = typeof import("node:path");

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

export const skill = {
  local(path: string): SkillLoader {
    return {
      load: () => loadLocalSkills(path),
    };
  },
};

async function loadLocalSkills(path: string): Promise<Skill[]> {
  const [fs, pathModule] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const root = pathModule.resolve(path);

  if (await hasSkillFile(fs, pathModule, root)) {
    return [await readSkill(fs, pathModule, root)];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = pathModule.join(root, entry.name);

    if (await hasSkillFile(fs, pathModule, directory)) {
      skills.push(await readSkill(fs, pathModule, directory));
    }
  }
  return skills;
}

async function hasSkillFile(
  fs: FsPromisesModule,
  pathModule: PathModule,
  directory: string,
): Promise<boolean> {
  try {
    const info = await fs.stat(pathModule.join(directory, "SKILL.md"));
    return info.isFile();
  } catch {
    return false;
  }
}

async function readSkill(
  fs: FsPromisesModule,
  pathModule: PathModule,
  directory: string,
): Promise<Skill> {
  const skillPath = pathModule.join(directory, "SKILL.md");
  const markdown = await fs.readFile(skillPath, "utf8");
  const parsed = parseSkillMarkdown(markdown, skillPath);
  validateSkillFrontmatter(parsed.frontmatter, pathModule.basename(directory), skillPath);

  const name = parsed.frontmatter.name as string;
  const description = parsed.frontmatter.description as string;
  const license =
    typeof parsed.frontmatter.license === "string" ? parsed.frontmatter.license : undefined;
  const metadata = isRecord(parsed.frontmatter.metadata) ? parsed.frontmatter.metadata : undefined;

  return {
    name,
    description,
    instructions: parsed.body.trim(),
    directory,
    references: await listRelativeFiles(fs, pathModule, pathModule.join(directory, "references")),
    scripts: await listRelativeFiles(fs, pathModule, pathModule.join(directory, "scripts")),
    license,
    metadata,
  };
}

function parseSkillMarkdown(
  markdown: string,
  path: string,
): { frontmatter: SkillFrontmatter; body: string } {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    throw new SkillValidationError("Skill validation failed", [
      { path, message: "SKILL.md must start with YAML frontmatter" },
    ]);
  }

  const newline = markdown.startsWith("---\r\n") ? "\r\n" : "\n";
  const marker = `${newline}---${newline}`;
  const end = markdown.indexOf(marker, 3);

  if (end === -1) {
    throw new SkillValidationError("Skill validation failed", [
      { path, message: "SKILL.md frontmatter must end with ---" },
    ]);
  }

  const rawFrontmatter = markdown.slice(3 + newline.length, end);
  const body = markdown.slice(end + marker.length);
  const parsed = parseYaml(rawFrontmatter);

  if (!isRecord(parsed)) {
    throw new SkillValidationError("Skill validation failed", [
      { path, message: "SKILL.md frontmatter must be a YAML object" },
    ]);
  }

  return { frontmatter: parsed, body };
}

function validateSkillFrontmatter(
  frontmatter: SkillFrontmatter,
  directoryName: string,
  path: string,
): void {
  const issues: SkillValidationIssue[] = [];
  const name = frontmatter.name;
  const description = frontmatter.description;

  if (typeof name !== "string" || name.length === 0) {
    issues.push({ path, message: "name is required" });
  } else {
    if (name.length > MAX_NAME_LENGTH) {
      issues.push({ path, message: `name must be at most ${MAX_NAME_LENGTH} characters` });
    }

    if (!NAME_PATTERN.test(name)) {
      issues.push({
        path,
        message: "name must contain lowercase letters, numbers, and hyphens only",
      });
    }

    if (directoryName !== name) {
      issues.push({ path, message: "name must match the skill directory name" });
    }
  }

  if (typeof description !== "string" || description.length === 0) {
    issues.push({ path, message: "description is required" });
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    issues.push({
      path,
      message: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
    });
  }

  if (issues.length > 0) {
    throw new SkillValidationError("Skill validation failed", issues);
  }
}

async function listRelativeFiles(
  fs: FsPromisesModule,
  pathModule: PathModule,
  directory: string,
): Promise<string[]> {
  try {
    const info = await fs.stat(directory);

    if (!info.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const files: string[] = [];
  await collectFiles(fs, pathModule, directory, directory, files);
  return files.sort();
}

async function collectFiles(
  fs: FsPromisesModule,
  pathModule: PathModule,
  root: string,
  directory: string,
  files: string[],
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = pathModule.join(directory, entry.name);

    if (entry.isDirectory()) {
      await collectFiles(fs, pathModule, root, entryPath, files);
    } else if (entry.isFile()) {
      files.push(toPortablePath(pathModule.relative(root, entryPath), pathModule.sep));
    }
  }
}

function toPortablePath(filePath: string, sep: string): string {
  return sep === "/" ? filePath : filePath.split(sep).join("/");
}
