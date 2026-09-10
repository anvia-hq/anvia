import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    for (const item of report) {
      for (const file of item.files) {
        if (file.status === "up-to-date") continue;
        mkdirSync(dirname(file.path), { recursive: true });
        writeFileSync(file.path, registryFileContent(registry, file.filename));
        updated.push(file.path);
      }
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
    const key = Object.keys(paths).find((candidate) => candidate.replace(/\/\*$/, "") === alias);
    const target = key === undefined ? undefined : paths[key]?.[0];
    if (target === undefined) continue;
    return join(cwd, config.compilerOptions?.baseUrl ?? ".", target.replace(/\/\*$/, ""));
  }
  throw new Error(
    `Cannot resolve the components alias "${alias}" from tsconfig.json or jsconfig.json in ${cwd}.`,
  );
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
