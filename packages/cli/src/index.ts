import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const registryItemNames = [
  "chat",
  "thread",
  "message",
  "composer",
  "attachment",
  "markdown",
  "tool-fallback",
] as const;

export type RegistryItemName = (typeof registryItemNames)[number];

type RegistryFile = {
  content: string;
  path: string;
  target: string;
  type: "registry:component";
};

type RegistryCss = {
  [rule: string]: RegistryCss | string;
};

export type AnviaRegistryItem = {
  $schema: string;
  css?: RegistryCss;
  dependencies: string[];
  description: string;
  files: RegistryFile[];
  name: RegistryItemName;
  title: string;
  type: "registry:block" | "registry:component";
};

const itemFiles: Record<RegistryItemName, readonly string[]> = {
  attachment: ["attachment.tsx"],
  chat: [
    "attachment.tsx",
    "markdown.tsx",
    "tool-fallback.tsx",
    "message.tsx",
    "composer.tsx",
    "thread.tsx",
    "chat.tsx",
  ],
  composer: ["attachment.tsx", "composer.tsx"],
  markdown: ["markdown.tsx"],
  message: ["attachment.tsx", "markdown.tsx", "tool-fallback.tsx", "message.tsx"],
  thread: ["attachment.tsx", "markdown.tsx", "tool-fallback.tsx", "message.tsx", "thread.tsx"],
  "tool-fallback": ["tool-fallback.tsx"],
};

const revealCss = {
  "@keyframes anvia-stream-gradient-settle": {
    to: {
      opacity: "1",
    },
  },
  "@layer components": {
    '.anvia-markdown [data-state="revealing"]': {
      animation:
        "anvia-stream-gradient-settle var(--anvia-stream-reveal-duration, 180ms) linear both",
      opacity: "var(--anvia-stream-reveal-opacity, 1)",
    },
    "@media (prefers-reduced-motion: reduce)": {
      '.anvia-markdown [data-state="revealing"]': {
        animation: "none",
        opacity: "1",
      },
    },
  },
} satisfies RegistryCss;

export function createRegistryItem(
  name: RegistryItemName,
  options: { packageVersion?: string; registryDirectory?: string } = {},
): AnviaRegistryItem {
  const packageVersion = options.packageVersion ?? currentPackageVersion();
  const registryDirectory = options.registryDirectory ?? bundledRegistryDirectory();
  const files = itemFiles[name].map((filename) => ({
    content: readFileSync(join(registryDirectory, filename), "utf8"),
    path: `registry/anvia/${filename}`,
    target: `@components/anvia/${filename}`,
    type: "registry:component" as const,
  }));
  const item: AnviaRegistryItem = {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    dependencies: [`@anvia/react-ui@${packageVersion}`],
    description: registryItemDescription(name),
    files,
    name,
    title: `Anvia ${name}`,
    type: files.length === 1 ? "registry:component" : "registry:block",
  };
  if (name === "chat" || name === "markdown" || name === "message" || name === "thread") {
    item.css = revealCss;
  }
  return item;
}

export function initializeProject(
  options: { cwd?: string; force?: boolean; template?: "next" | "vite" } = {},
): void {
  const cwd = options.cwd ?? process.cwd();
  const args = ["init", "--cwd", cwd, "--yes", "--no-monorepo", "--base", "radix"];
  if (options.template !== undefined) args.push("--template", options.template);
  if (options.force === true) args.push("--force");
  runShadcn(args);
}

export function addRegistryItem(
  name: RegistryItemName,
  options: { cwd?: string; overwrite?: boolean } = {},
): void {
  const cwd = options.cwd ?? process.cwd();
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "anvia-registry-"));
  const itemPath = join(temporaryDirectory, `${name}.json`);
  try {
    writeFileSync(itemPath, `${JSON.stringify(createRegistryItem(name), null, 2)}\n`);
    const args = ["add", itemPath, "--cwd", cwd, "--yes"];
    if (options.overwrite === true) args.push("--overwrite");
    runShadcn(args);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

export function isRegistryItemName(value: string): value is RegistryItemName {
  return registryItemNames.includes(value as RegistryItemName);
}

export type InstalledFileStatus = "up-to-date" | "modified" | "missing";

export type InstalledItemFile = {
  filename: string;
  path: string;
  status: InstalledFileStatus;
};

export type InstalledItemReport = {
  name: RegistryItemName;
  installed: boolean;
  complete: boolean;
  files: InstalledItemFile[];
};

export function inspectInstalledItems(
  options: {
    cwd?: string;
    items?: readonly RegistryItemName[];
    registryDirectory?: string;
  } = {},
): InstalledItemReport[] {
  const names = options.items ?? registryItemNames;
  const directory = componentsDirectory(options);
  const registry = options.registryDirectory ?? bundledRegistryDirectory();
  return names.map((name) => {
    const files = itemFiles[name].map((filename) => {
      const path = join(directory, "anvia", filename);
      let status: InstalledFileStatus = "missing";
      if (existsSync(path)) {
        const installed = readFileSync(path, "utf8");
        status = installed === registryFileContent(registry, filename) ? "up-to-date" : "modified";
      }
      return { filename, path, status };
    });
    return {
      name,
      installed: files.some((file) => file.status !== "missing"),
      complete: files.every((file) => file.status !== "missing"),
      files,
    };
  });
}

export function updateInstalledItems(
  options: {
    cwd?: string;
    items?: readonly RegistryItemName[];
    overwrite?: boolean;
    registryDirectory?: string;
  } = {},
): { report: InstalledItemReport[]; updated: string[] } {
  const registry = options.registryDirectory ?? bundledRegistryDirectory();
  const report = inspectInstalledItems(options);
  const updated: string[] = [];
  if (options.overwrite === true) {
    const actionable = new Map<string, string>();
    for (const item of report) {
      if (!item.installed) continue;
      for (const file of item.files) {
        if (file.status === "up-to-date" || actionable.has(file.path)) continue;
        actionable.set(file.path, registryFileContent(registry, file.filename));
      }
    }
    for (const [path, content] of actionable) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      updated.push(path);
    }
  }
  return { report, updated };
}

export function closestRegistryItemName(value: string): RegistryItemName | undefined {
  let best: RegistryItemName | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const name of registryItemNames) {
    const distance = levenshteinDistance(value, name);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return bestDistance <= 2 ? best : undefined;
}

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

export function skillNames(options: { skillsDirectory?: string } = {}): string[] {
  const directory = options.skillsDirectory ?? bundledSkillsDirectory();
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function inspectInstalledSkills(options: SkillsOptions = {}): InstalledSkillReport[] {
  const skillsDirectory = options.skillsDirectory ?? bundledSkillsDirectory();
  const target = skillsTargetDirectory(options);
  return skillNames({ skillsDirectory }).map((name) => {
    const files = collectSkillFiles(join(skillsDirectory, name)).map((relativePath) => {
      const path = join(target, name, relativePath);
      let status: SkillFileStatus = "missing";
      if (existsSync(path)) {
        const installed = readFileSync(path, "utf8");
        const source = readFileSync(join(skillsDirectory, name, relativePath), "utf8");
        status = installed === source ? "up-to-date" : "modified";
      }
      return { relativePath, path, status };
    });
    return {
      name,
      installed: files.some((file) => file.status !== "missing"),
      complete: files.every((file) => file.status !== "missing"),
      files,
    };
  });
}

export function initSkills(options: SkillsOptions & { force?: boolean } = {}): SkillsWriteResult {
  return writeSkills({ ...options, mode: "init" });
}

export function updateSkills(options: SkillsOptions & { force?: boolean } = {}): SkillsWriteResult {
  return writeSkills({ ...options, mode: "update" });
}

function writeSkills(
  options: SkillsOptions & { force?: boolean; mode: "init" | "update" },
): SkillsWriteResult {
  const skillsDirectory = options.skillsDirectory ?? bundledSkillsDirectory();
  const cwd = options.cwd ?? process.cwd();
  const force = options.force === true;
  const targets = new Set<SkillsTarget>(options.targets ?? ["anvia"]);
  // The ./skills copy is the canonical content every pointer-based adapter
  // references, so it is always written; the target flags add adapters on top.
  targets.add("anvia");
  const results: SkillsTargetResult[] = [];

  const anvia = syncSkillTree({
    skillsDirectory,
    targetRoot: skillsTargetDirectory(options),
    force,
    mode: options.mode,
  });
  results.push({ target: "anvia", ...anvia });

  if (targets.has("claude")) {
    const claude = syncSkillTree({
      skillsDirectory,
      targetRoot: join(cwd, ".claude", "skills"),
      force,
      mode: options.mode,
    });
    results.push({ target: "claude", ...claude });
  }
  if (targets.has("cursor")) {
    const cursor = syncCursorRules({
      skillsDirectory,
      rulesDirectory: join(cwd, ".cursor", "rules"),
      force,
      mode: options.mode,
    });
    results.push({ target: "cursor", ...cursor });
  }
  if (targets.has("agents") || targets.has("codex")) {
    const doc = syncAgentsDoc({
      agentsPath: join(cwd, "AGENTS.md"),
      skillsDirectory,
    });
    const target: SkillsTarget = targets.has("agents") ? "agents" : "codex";
    results.push({ target, ...doc });
  }

  return {
    report: inspectInstalledSkills(options),
    created: anvia.created,
    updated: anvia.updated,
    targets: results,
  };
}

function syncSkillTree(options: {
  skillsDirectory: string;
  targetRoot: string;
  force: boolean;
  mode: "init" | "update";
}): { created: string[]; updated: string[]; skipped: number } {
  const created: string[] = [];
  const updated: string[] = [];
  let skipped = 0;
  for (const name of skillNames({ skillsDirectory: options.skillsDirectory })) {
    const sourceRoot = join(options.skillsDirectory, name);
    const targetRoot = join(options.targetRoot, name);
    const sourceFiles = collectSkillFiles(sourceRoot);
    if (
      options.mode === "update" &&
      !sourceFiles.some((file) => existsSync(join(targetRoot, file)))
    ) {
      continue;
    }
    for (const relativePath of sourceFiles) {
      const sourcePath = join(sourceRoot, relativePath);
      const targetPath = join(targetRoot, relativePath);
      const content = readFileSync(sourcePath, "utf8");
      if (!existsSync(targetPath)) {
        if (options.mode === "update" && !options.force) continue;
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, content);
        chmodSync(targetPath, statSync(sourcePath).mode & 0o777);
        created.push(targetPath);
        continue;
      }
      if (readFileSync(targetPath, "utf8") === content) continue;
      if (!options.force) {
        skipped += 1;
        continue;
      }
      writeFileSync(targetPath, content);
      chmodSync(targetPath, statSync(sourcePath).mode & 0o777);
      updated.push(targetPath);
    }
  }
  return { created, updated, skipped };
}

function syncCursorRules(options: {
  skillsDirectory: string;
  rulesDirectory: string;
  force: boolean;
  mode: "init" | "update";
}): { created: string[]; updated: string[]; skipped: number } {
  const created: string[] = [];
  const updated: string[] = [];
  let skipped = 0;
  for (const name of skillNames({ skillsDirectory: options.skillsDirectory })) {
    // Skill directory names already carry their `anvia-` prefix (except the
    // release-notes demo), so the rule file is simply `<name>.mdc`.
    const targetPath = join(options.rulesDirectory, `${name}.mdc`);
    const content = cursorRuleContent(options.skillsDirectory, name);
    if (!existsSync(targetPath)) {
      if (options.mode === "update" && !options.force) continue;
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, content);
      created.push(targetPath);
      continue;
    }
    if (readFileSync(targetPath, "utf8") === content) continue;
    if (!options.force) {
      skipped += 1;
      continue;
    }
    writeFileSync(targetPath, content);
    updated.push(targetPath);
  }
  return { created, updated, skipped };
}

function syncAgentsDoc(options: { agentsPath: string; skillsDirectory: string }): {
  created: string[];
  updated: string[];
  skipped: number;
} {
  const section = agentsSkillsSection(options.skillsDirectory);
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
  if (next === existing) return { created: [], updated: [], skipped: 0 };
  writeFileSync(options.agentsPath, next);
  return { created: [], updated: [options.agentsPath], skipped: 0 };
}

const agentsSectionStart = "<!-- anvia-skills:start -->";
const agentsSectionEnd = "<!-- anvia-skills:end -->";

function agentsSkillsSection(skillsDirectory: string): string {
  const lines = skillNames({ skillsDirectory }).map(
    (name) => `- \`skills/${name}/SKILL.md\` — ${skillDescription(skillsDirectory, name)}`,
  );
  return [
    agentsSectionStart,
    "## Anvia Agent Skills",
    "",
    "This project keeps Anvia Agent Skills in `skills/`. When a task matches a skill, read",
    "its `SKILL.md` first and follow it, including the `references/` files and `scripts/`",
    "it points to. Run skill scripts with `sh` when they help verify the work.",
    "",
    ...lines,
    agentsSectionEnd,
  ].join("\n");
}

function cursorRuleContent(skillsDirectory: string, name: string): string {
  const description = skillDescription(skillsDirectory, name).replace(/"/g, '\\"');
  return [
    "---",
    `description: "${description}"`,
    "alwaysApply: false",
    "---",
    "",
    `When a task matches this skill, read \`skills/${name}/SKILL.md\` at the project root and`,
    "follow it, including the `references/` files and `scripts/` it points to. Run skill",
    "scripts with `sh` when they help verify the work.",
    "",
  ].join("\n");
}

function skillDescription(skillsDirectory: string, name: string): string {
  const source = readFileSync(join(skillsDirectory, name, "SKILL.md"), "utf8");
  return (/^description:\s*(.+)$/m.exec(source)?.[1] ?? "").trim();
}

function skillsTargetDirectory(options: { cwd?: string; dir?: string } = {}): string {
  const cwd = options.cwd ?? process.cwd();
  return join(cwd, options.dir ?? "skills");
}

function collectSkillFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
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

function componentsDirectory(options: { cwd?: string } = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const manifestPath = join(cwd, "components.json");
  let manifest: { aliases?: { components?: string } };
  try {
    manifest = JSON.parse(stripJsonComments(readFileSync(manifestPath, "utf8"))) as {
      aliases?: { components?: string };
    };
  } catch {
    throw new Error(`Missing or unreadable components.json in ${cwd}. Run \`anvia init\` first.`);
  }
  const alias = manifest.aliases?.components ?? "@/components";
  return resolveAliasDirectory(cwd, alias);
}

function resolveAliasDirectory(cwd: string, alias: string): string {
  for (const configName of ["tsconfig.json", "jsconfig.json"]) {
    let config: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    try {
      config = JSON.parse(stripJsonComments(readFileSync(join(cwd, configName), "utf8"))) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
    } catch {
      continue;
    }
    const paths = config.compilerOptions?.paths;
    if (paths === undefined) continue;
    const target = resolveAliasTarget(alias, paths);
    if (target === undefined) continue;
    return join(cwd, config.compilerOptions?.baseUrl ?? ".", target);
  }
  throw new Error(
    `Cannot resolve the components alias "${alias}" from tsconfig.json or jsconfig.json in ${cwd}.`,
  );
}

function resolveAliasTarget(alias: string, paths: Record<string, string[]>): string | undefined {
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (target === undefined) continue;
    if (key.endsWith("/*")) {
      const prefix = key.slice(0, -2);
      if (alias === prefix) return target.replace(/\/\*$/, "");
      if (alias.startsWith(`${prefix}/`)) {
        return join(target.replace(/\/\*$/, ""), alias.slice(prefix.length + 1));
      }
    } else if (key === alias) {
      return target;
    }
  }
  return undefined;
}

function stripJsonComments(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    result += character;
  }
  return result;
}

function registryFileContent(registryDirectory: string, filename: string): string {
  return readFileSync(join(registryDirectory, filename), "utf8");
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j]!;
      previous[j] = Math.min(
        above + 1,
        previous[j - 1]! + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length]!;
}

function runShadcn(args: string[]): void {
  const require = createRequire(import.meta.url);
  const shadcnEntry = require.resolve("shadcn");
  const result = spawnSync(process.execPath, [shadcnEntry, ...args], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`shadcn ${args[0] ?? "command"} failed with exit code ${result.status}.`);
  }
}

function bundledRegistryDirectory(): string {
  return fileURLToPath(new URL("./registry/", import.meta.url));
}

function bundledSkillsDirectory(): string {
  return fileURLToPath(new URL("./skills/", import.meta.url));
}

function currentPackageVersion(): string {
  const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string") {
    throw new Error(`Missing package version in ${basename(manifestPath)}.`);
  }
  return manifest.version;
}

function registryItemDescription(name: RegistryItemName): string {
  if (name === "chat") return "A complete editable Anvia chat interface.";
  return `Editable Anvia ${name} UI.`;
}
