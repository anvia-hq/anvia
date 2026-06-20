import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const packagesRoot = path.join(root, "packages");
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const releaseChannel = process.argv[2];

if (releaseChannel !== "stable" && releaseChannel !== "preview") {
  throw new Error("Usage: node scripts/notify-discord-release.mjs <stable|preview>");
}

if (webhookUrl === undefined || webhookUrl.length === 0) {
  console.warn("DISCORD_WEBHOOK_URL is not set. Skipping Discord release notification.");
  process.exit(0);
}

const packages = findPackageDirs(packagesRoot)
  .map((dir) => readPackageJson(dir))
  .filter((pkg) => pkg.private !== true)
  .filter((pkg) => typeof pkg.name === "string")
  .filter((pkg) => typeof pkg.version === "string")
  .sort((a, b) => a.name.localeCompare(b.name));

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
    name: `packages (${packages.length})`,
    value: packageList(packages),
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
  body: JSON.stringify({
    embeds: [
      {
        title,
        description:
          releaseChannel === "stable"
            ? "Stable packages were published successfully."
            : "Preview packages were published successfully.",
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

function packageList(releases) {
  const lines = releases.map((pkg) => `\`${pkg.name}@${pkg.version}\``);
  const maxLength = 1000;
  let output = "";

  for (const line of lines) {
    const next = output.length === 0 ? line : `${output}\n${line}`;
    if (next.length > maxLength) {
      const remaining = lines.length - output.split("\n").length;
      return `${output}\nand ${remaining} more`;
    }
    output = next;
  }

  return output.length > 0 ? output : "No public packages found.";
}
