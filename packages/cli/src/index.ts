import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
