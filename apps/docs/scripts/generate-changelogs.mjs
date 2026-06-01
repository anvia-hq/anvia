import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../..");
const packagesRoot = join(repoRoot, "packages");
const outputDir = join(repoRoot, "apps/docs/content/docs/changelog");

const groupOrder = [
  "core",
  "providers",
  "embeddings",
  "vector-stores",
  "logger",
  "observability",
  "tools",
];
const groupTitles = new Map([
  ["core", "Core"],
  ["providers", "Providers"],
  ["embeddings", "Embeddings"],
  ["vector-stores", "Vector Stores"],
  ["logger", "Logger"],
  ["observability", "Observability"],
  ["tools", "Tools"],
]);

const packages = discoverPackages()
  .filter(({ pkg }) => pkg.private !== true)
  .filter(({ pkg }) => typeof pkg.name === "string" && typeof pkg.version === "string")
  .sort((a, b) => {
    const groupDiff = groupRank(a.group) - groupRank(b.group);
    return groupDiff === 0 ? a.pkg.name.localeCompare(b.pkg.name) : groupDiff;
  });

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

writeFileSync(join(outputDir, "meta.json"), `${JSON.stringify(createMeta(packages), null, 2)}\n`);
writeFileSync(join(outputDir, "index.mdx"), createIndex(packages));

for (const item of packages) {
  writeFileSync(join(outputDir, `${item.slug}.mdx`), createPackagePage(item));
}

console.info(
  `Generated ${packages.length + 2} changelog docs files in ${relative(repoRoot, outputDir)}`,
);

function discoverPackages() {
  return findPackageDirs(packagesRoot).map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const pathParts = relative(packagesRoot, dir).split("/");

    return {
      dir,
      pkg,
      group: pathParts[0],
      slug: packageSlug(pkg.name),
      changelogPath: join(dir, "CHANGELOG.md"),
    };
  });
}

function findPackageDirs(dir) {
  const entries = readdirSync(dir).sort();
  const dirs = [];

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    if (existsSync(join(entryPath, "package.json"))) {
      dirs.push(entryPath);
      continue;
    }

    dirs.push(...findPackageDirs(entryPath));
  }

  return dirs;
}

function packageSlug(name) {
  return name.replace(/^@anvia\//, "").replaceAll("/", "-");
}

function createMeta(items) {
  const pages = ["index"];

  for (const group of orderedGroups(items)) {
    const groupItems = items.filter((item) => item.group === group);
    if (groupItems.length === 0) continue;

    pages.push(`---${groupTitles.get(group) ?? titleCase(group)}---`);
    pages.push(...groupItems.map((item) => item.slug));
  }

  return {
    title: "Changelog",
    description: "Package release notes",
    icon: "History",
    root: true,
    defaultOpen: false,
    collapsible: true,
    pages,
  };
}

function createIndex(items) {
  const sections = [];

  for (const group of orderedGroups(items)) {
    const groupItems = items.filter((item) => item.group === group);
    if (groupItems.length === 0) continue;

    sections.push(`## ${groupTitles.get(group) ?? titleCase(group)}

| Package | Current version | Release notes |
| --- | --- | --- |
${groupItems
  .map(
    (item) =>
      `| \`${item.pkg.name}\` | \`${item.pkg.version}\` | [View changelog](/docs/changelog/${item.slug}) |`,
  )
  .join("\n")}`);
  }

  return `---
title: Package Changelog
description: Release history for Anvia packages.
---

Anvia package release notes are generated from the package changelog files maintained by Changesets.

Developers should keep writing release notes with \`pnpm changeset\`. The docs pages in this section are generated from \`packages/**/CHANGELOG.md\`.

${sections.join("\n\n")}
`;
}

function createPackagePage(item) {
  const relativeChangelogPath = relative(repoRoot, item.changelogPath);
  const sourceUrl = `https://github.com/anvia-hq/anvia/blob/main/${relativeChangelogPath}`;
  const body = existsSync(item.changelogPath)
    ? normalizeChangelog(readFileSync(item.changelogPath, "utf8"), item.pkg.name)
    : missingChangelog(item);

  return `---
title: ${frontmatterString(item.pkg.name)}
description: ${frontmatterString(`Release notes for ${item.pkg.name}.`)}
---

# \`${item.pkg.name}\`

${item.pkg.description}

Source: [\`${relativeChangelogPath}\`](${sourceUrl})

${body}
`;
}

function normalizeChangelog(content, packageName) {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return "No release notes have been recorded yet.\n";
  }

  return `${trimmed.replace(new RegExp(`^# ${escapeRegExp(packageName)}\\s*\\n+`), "")}\n`;
}

function missingChangelog(item) {
  return `## No release notes yet

\`${item.pkg.name}\` is public, but \`${relative(repoRoot, item.changelogPath)}\` does not exist yet.

Release notes will appear here after the next Changesets version bump creates the package changelog.
`;
}

function titleCase(value) {
  return value
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function orderedGroups(items) {
  const discovered = [...new Set(items.map((item) => item.group))];
  return discovered.sort((a, b) => {
    const rankDiff = groupRank(a) - groupRank(b);
    return rankDiff === 0 ? a.localeCompare(b) : rankDiff;
  });
}

function groupRank(group) {
  const index = groupOrder.indexOf(group);
  return index === -1 ? groupOrder.length : index;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function frontmatterString(value) {
  return JSON.stringify(value);
}
