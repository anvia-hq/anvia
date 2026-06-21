import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const packagesRoot = path.join(root, "packages");
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const publishedPackagesFile = process.env.PUBLISHED_PACKAGES_FILE;
const releaseChannel = process.argv[2];

if (releaseChannel !== "stable" && releaseChannel !== "preview") {
  throw new Error("Usage: node scripts/notify-discord-release.mjs <stable|preview>");
}

if (webhookUrl === undefined || webhookUrl.length === 0) {
  console.warn("DISCORD_WEBHOOK_URL is not set. Skipping Discord release notification.");
  process.exit(0);
}

const packages = findPackageDirs(packagesRoot)
  .map((dir) => ({ dir, packageJson: readPackageJson(dir) }))
  .filter((pkg) => pkg.packageJson.private !== true)
  .filter((pkg) => typeof pkg.packageJson.name === "string")
  .filter((pkg) => typeof pkg.packageJson.version === "string")
  .sort((a, b) => a.packageJson.name.localeCompare(b.packageJson.name));
const publishedPackages = readPublishedPackages();
const releasedPackages =
  publishedPackages === undefined
    ? packages
    : packages.filter((pkg) => publishedPackages.has(pkg.packageJson.name));
if (publishedPackages !== undefined && releasedPackages.length === 0) {
  console.warn("No published packages were recorded. Skipping Discord release notification.");
  process.exit(0);
}

const releaseNotes =
  releaseChannel === "preview"
    ? previewReleaseNotes(releasedPackages)
    : stableReleaseNotes(releasedPackages);
const changedPackageCount = new Set(releaseNotes.flatMap((note) => note.packages)).size;
const packageSummary =
  changedPackageCount > 0
    ? `${changedPackageCount} changed package${changedPackageCount === 1 ? "" : "s"}`
    : `${releasedPackages.length} published package${releasedPackages.length === 1 ? "" : "s"}`;

const title =
  releaseChannel === "stable" ? "Stable packages published" : "Preview packages published";
const npmTag = releaseChannel === "stable" ? "latest" : "preview";
const color = releaseChannel === "stable" ? 0x22c55e : 0xf59e0b;
const repository = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const runUrl =
  repository !== undefined && process.env.GITHUB_RUN_ID !== undefined
    ? `${serverUrl}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
const commitUrl =
  repository !== undefined && process.env.GITHUB_SHA !== undefined
    ? `${serverUrl}/${repository}/commit/${process.env.GITHUB_SHA}`
    : undefined;
const shortSha = process.env.GITHUB_SHA?.slice(0, 7);

const fields = [
  {
    name: "npm tag",
    value: `\`${npmTag}\``,
    inline: true,
  },
  {
    name: "branch",
    value: `\`${process.env.GITHUB_REF_NAME ?? "unknown"}\``,
    inline: true,
  },
  {
    name: "commit",
    value:
      commitUrl !== undefined && shortSha !== undefined
        ? `[\`${shortSha}\`](${commitUrl})`
        : `\`${shortSha ?? "unknown"}\``,
    inline: true,
  },
  {
    name: "changes",
    value: releaseNoteList(releaseNotes),
    inline: false,
  },
];

if (runUrl !== undefined) {
  fields.push({
    name: "workflow run",
    value: `[Open run](${runUrl})`,
    inline: false,
  });
}

const response = await fetch(webhookUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  signal: AbortSignal.timeout(10_000),
  body: JSON.stringify({
    embeds: [
      {
        title,
        description:
          releaseChannel === "stable"
            ? `Stable packages were published successfully: ${packageSummary}.`
            : `Preview packages were published successfully: ${packageSummary}.`,
        color,
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  }),
});

if (!response.ok) {
  throw new Error(`Discord notification failed: ${response.status} ${await response.text()}`);
}

console.info(`Sent Discord notification for ${releaseChannel} release.`);

function previewReleaseNotes(releases) {
  const changesetNotes = changesetReleaseNotes();
  if (changesetNotes.length > 0) {
    return changesetNotes;
  }

  return latestChangelogNotes(releases);
}

function changesetReleaseNotes() {
  const changesetRoot = path.join(root, ".changeset");
  if (!existsSync(changesetRoot)) {
    return [];
  }

  return readdirSync(changesetRoot)
    .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
    .sort()
    .map((entry) => parseChangeset(path.join(changesetRoot, entry)))
    .filter((note) => note !== undefined);
}

function parseChangeset(filePath) {
  const content = readFileSync(filePath, "utf8").trim();
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (match === null) {
    return undefined;
  }

  const [, frontmatter, body] = match;
  const releases = [...frontmatter.matchAll(/^["']?([^"':]+(?:\/[^"':]+)?)["']?:\s*(\w+)/gm)].map(
    ([, name, bump]) => ({ name, bump }),
  );
  const summary = normalizeMarkdown(body);

  if (releases.length === 0 || summary.length === 0) {
    return undefined;
  }

  const bumps = new Set(releases.map((release) => release.bump));
  return {
    packages: releases.map((release) => release.name),
    summary: bumps.size === 1 ? `${[...bumps][0]}: ${summary}` : summary,
  };
}

function stableReleaseNotes(releases) {
  const notes = [];

  for (const pkg of releases) {
    const changelogPath = path.join(pkg.dir, "CHANGELOG.md");
    if (!existsSync(changelogPath)) {
      continue;
    }

    const entry = extractChangelogEntry(
      readFileSync(changelogPath, "utf8"),
      pkg.packageJson.version,
    );
    const changes = entry === undefined ? [] : changelogChanges(entry);
    for (const change of changes) {
      notes.push({
        packages: [pkg.packageJson.name],
        summary: change,
      });
    }
  }

  return dedupeReleaseNotes(notes);
}

function latestChangelogNotes(releases) {
  const notes = [];

  for (const pkg of releases) {
    const changelogPath = path.join(pkg.dir, "CHANGELOG.md");
    if (!existsSync(changelogPath)) {
      continue;
    }

    const entry = extractLatestChangelogEntry(readFileSync(changelogPath, "utf8"));
    const changes = entry === undefined ? [] : changelogChanges(entry);
    for (const change of changes) {
      notes.push({
        packages: [pkg.packageJson.name],
        summary: change,
      });
    }
  }

  return dedupeReleaseNotes(notes);
}

function extractLatestChangelogEntry(changelog) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+/.test(line));
  if (start === -1) {
    return undefined;
  }

  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return lines
    .slice(start, end === -1 ? lines.length : end)
    .join("\n")
    .trim();
}

function extractChangelogEntry(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+\\[?${escapeRegExp(version)}\\]?\\b`);
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) {
    return undefined;
  }

  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return lines
    .slice(start, end === -1 ? lines.length : end)
    .join("\n")
    .trim();
}

function changelogChanges(entry) {
  const changes = [];
  let current;

  for (const line of entry.split(/\r?\n/)) {
    if (line.startsWith("- Updated dependencies")) {
      current = undefined;
      continue;
    }

    const bullet = line.match(/^-\s+(?:(?:[0-9a-f]{7,40}):\s*)?(.+)$/);
    if (bullet !== null) {
      if (current !== undefined) {
        changes.push(current.trim());
      }
      current = bullet[1];
      continue;
    }

    if (current !== undefined && /^\s{2,}\S/.test(line)) {
      current = `${current} ${line.trim()}`;
    }
  }

  if (current !== undefined) {
    changes.push(current.trim());
  }

  return changes
    .map((change) => normalizeMarkdown(change))
    .filter((change) => change.length > 0 && !change.startsWith("- @anvia/"));
}

function dedupeReleaseNotes(notes) {
  const seen = new Set();
  const deduped = [];

  for (const note of notes) {
    const key = note.summary;
    if (seen.has(key)) {
      const existing = deduped.find((item) => item.summary === note.summary);
      existing?.packages.push(...note.packages);
      continue;
    }

    seen.add(key);
    deduped.push({
      packages: [...note.packages],
      summary: note.summary,
    });
  }

  return deduped;
}

function normalizeMarkdown(value) {
  return value.replace(/\s+/g, " ").replace(/`/g, "").trim();
}

function releaseNoteList(notes) {
  if (notes.length === 0) {
    return "No release notes were found for this release.";
  }

  const maxLength = 1000;
  let output = "";

  for (const note of notes) {
    const packageLabel = compactPackageLabel(note.packages);
    const line = `- ${packageLabel}: ${note.summary}`;
    const next = output.length === 0 ? line : `${output}\n${line}`;
    if (next.length > maxLength) {
      if (output.length === 0) {
        return `${line.slice(0, maxLength - 3)}...`;
      }
      const remaining = notes.length - output.split("\n").length;
      return `${output}\nand ${remaining} more change${remaining === 1 ? "" : "s"}`;
    }
    output = next;
  }

  return output;
}

function compactPackageLabel(packageNames) {
  const unique = [...new Set(packageNames)].sort();
  if (unique.length === 1) {
    return `\`${unique[0]}\``;
  }

  if (unique.length <= 3) {
    return unique.map((name) => `\`${name}\``).join(", ");
  }

  return `${unique
    .slice(0, 2)
    .map((name) => `\`${name}\``)
    .join(", ")} and ${unique.length - 2} more`;
}

function findPackageDirs(dir) {
  const entries = readdirSync(dir).sort();
  const dirs = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry);
    if (!statSync(entryPath).isDirectory()) {
      continue;
    }

    if (existsSync(path.join(entryPath, "package.json"))) {
      dirs.push(entryPath);
      continue;
    }

    dirs.push(...findPackageDirs(entryPath));
  }

  return dirs;
}

function readPackageJson(dir) {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
}

function readPublishedPackages() {
  if (publishedPackagesFile === undefined || publishedPackagesFile.length === 0) {
    return undefined;
  }

  const filePath = path.resolve(root, publishedPackagesFile);
  if (!existsSync(filePath)) {
    return undefined;
  }

  let releases;
  try {
    releases = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
  if (!Array.isArray(releases)) {
    return undefined;
  }

  return new Set(
    releases.filter((release) => typeof release?.name === "string").map((release) => release.name),
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
