import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packages } from "../src/lib/packages.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "../..");
const docsRoot = join(appRoot, "src/content/docs/packages");

let generated = 0;

for (const packageInfo of packages) {
  const sourceChangelogPath = join(repoRoot, packageInfo.changelogPath);
  const docsDirectory = join(docsRoot, packageInfo.slug);
  const docsChangelogPath = join(docsDirectory, "changelog.md");

  if (!existsSync(sourceChangelogPath)) {
    throw new Error(
      `Missing source changelog for ${packageInfo.name}: ${packageInfo.changelogPath}`,
    );
  }
  if (!existsSync(docsDirectory)) {
    throw new Error(`Missing docs package directory for ${packageInfo.name}: ${docsDirectory}`);
  }

  const changelogBody = sourceChangelogBody(
    packageInfo.name,
    packageInfo.changelogPath,
    readFileSync(sourceChangelogPath, "utf8"),
  );

  const generatedMarkdown = [
    "---",
    `title: ${JSON.stringify(`${packageInfo.name}: Changelog`)}`,
    `description: ${JSON.stringify(`Release history for ${packageInfo.name}.`)}`,
    "section: packages",
    "sidebar:",
    `  group: ${JSON.stringify(packageInfo.name)}`,
    "  order: 5",
    '  label: "Changelog"',
    "---",
    "",
    `Release history mirrored from \`${packageInfo.changelogPath}\`.`,
    "",
    changelogBody,
    "",
  ].join("\n");

  writeFileSync(docsChangelogPath, generatedMarkdown);
  generated += 1;
}

console.log(`Generated ${generated} package changelog docs.`);

function sourceChangelogBody(packageName: string, changelogPath: string, source: string): string {
  const normalized = source.replace(/\r\n/g, "\n").trimEnd();
  const lines = normalized.split("\n");
  const heading = lines[0];

  if (heading === undefined || !heading.startsWith("# ")) {
    throw new Error(`Expected ${changelogPath} to start with a package heading.`);
  }

  const sourcePackageName = heading.slice(2).trim();
  if (sourcePackageName !== packageName) {
    throw new Error(
      `Changelog heading mismatch for ${changelogPath}: expected ${packageName}, found ${sourcePackageName}.`,
    );
  }

  const body = lines.slice(1).join("\n").replace(/^\n+/, "");
  if (!body.startsWith("## ")) {
    throw new Error(
      `Expected ${changelogPath} to contain version sections after the package heading.`,
    );
  }

  return body;
}
