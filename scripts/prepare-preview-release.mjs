import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertPreviewAllowed,
  createPreviewVersion,
  findPublicPackages,
  readReleasePlan,
} from "./release-train.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const buildId = process.env.PREVIEW_BUILD_ID ?? createBuildId();
assertPreviewAllowed(root);

const packages = findPublicPackages(root);
const packagesByName = new Map(packages.map((pkg) => [pkg.packageJson.name, pkg]));
const releasePlan = readReleasePlan(root);
const releases = releasePlan.releases.filter((release) => release.type !== "none");
const unknownReleases = releases.filter((release) => !packagesByName.has(release.name));

if (unknownReleases.length > 0) {
  throw new Error(
    `Preview releases may only target public packages: ${unknownReleases.map(({ name }) => name).join(", ")}.`,
  );
}

if (releases.length === 0) {
  throw new Error("Preview publishing requires at least one pending public-package changeset.");
}

for (const release of releases) {
  const pkg = packagesByName.get(release.name);
  if (pkg === undefined) {
    throw new Error(`Changesets planned a release for unknown public package ${release.name}.`);
  }
  const nextVersion = createPreviewVersion(release.newVersion, buildId);
  const updated = structuredClone(pkg.packageJson);
  updated.version = nextVersion;

  console.info(`${pkg.packageJson.name}: ${pkg.packageJson.version} -> ${nextVersion}`);
  if (!dryRun) {
    writeFileSync(path.join(pkg.dir, "package.json"), `${JSON.stringify(updated, null, 2)}\n`);
  }
}

if (dryRun) {
  console.info("Dry run complete. No package files were changed.");
}

function createBuildId() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
  const shortSha = getShortSha();
  if (shortSha === undefined) {
    throw new Error("Preview versioning requires a Git commit SHA.");
  }
  return `${timestamp}.sha-${shortSha}`;
}

function getShortSha() {
  const envSha = process.env.GITHUB_SHA;
  if (envSha !== undefined && envSha.length >= 7) {
    return envSha.slice(0, 7);
  }

  const result = spawnSync("git", ["rev-parse", "--short=7", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return undefined;
  }

  return result.stdout.trim();
}
