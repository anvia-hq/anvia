import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertPreviewAllowed,
  createPreviewVersion,
  DEPENDENCY_FIELDS,
  findPublicPackages,
} from "./release-train.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const buildId = process.env.PREVIEW_BUILD_ID ?? createBuildId();
assertPreviewAllowed(root);
const packages = findPublicPackages(root);
const previewVersion = createPreviewVersion(buildId);

const previewVersions = new Map(packages.map((pkg) => [pkg.packageJson.name, previewVersion]));

for (const pkg of packages) {
  const nextVersion = previewVersions.get(pkg.packageJson.name);
  const updated = structuredClone(pkg.packageJson);
  updated.version = nextVersion;

  for (const field of DEPENDENCY_FIELDS) {
    rewriteInternalDependencies(updated[field], previewVersions);
  }

  const relativePath = path.relative(root, path.join(pkg.dir, "package.json"));
  console.info(`${pkg.packageJson.name}: ${pkg.packageJson.version} -> ${nextVersion}`);

  if (!dryRun) {
    writeFileSync(path.join(pkg.dir, "package.json"), `${JSON.stringify(updated, null, 2)}\n`);
  } else {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, version] of rewrittenDependencies(
        pkg.packageJson[field],
        previewVersions,
      )) {
        console.info(`  ${relativePath} ${field}.${name} -> ${version}`);
      }
    }
  }
}

if (dryRun) {
  console.info("Dry run complete. No package files were changed.");
}

function rewriteInternalDependencies(dependencies, versions) {
  if (dependencies === undefined) {
    return;
  }

  for (const name of Object.keys(dependencies)) {
    const version = versions.get(name);
    if (version !== undefined) {
      dependencies[name] = version;
    }
  }
}

function* rewrittenDependencies(dependencies, versions) {
  if (dependencies === undefined) {
    return;
  }

  for (const name of Object.keys(dependencies)) {
    const version = versions.get(name);
    if (version !== undefined) {
      yield [name, version];
    }
  }
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
