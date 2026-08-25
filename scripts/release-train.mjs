import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function createPreviewVersion(version, buildId) {
  if (!stableVersionPattern.test(version)) {
    throw new Error(`Preview base version must be stable semver; received ${version}.`);
  }
  if (!/^\d{8}T\d{6}\.sha-[0-9a-f]{7,40}$/.test(buildId)) {
    throw new Error("Preview build ID must use <YYYYMMDDTHHMMSS>.sha-<7-to-40-character-commit>.");
  }
  return `${version}-preview.${buildId}`;
}

export function assertPreviewAllowed(root = process.cwd()) {
  if (readPrereleaseState(root) !== undefined) {
    throw new Error("Preview releases are disabled after the RC prerelease flow begins.");
  }
}

export function findPublicPackages(root = process.cwd()) {
  return findPackageDirs(path.join(root, "packages"))
    .map((dir) => ({ dir, packageJson: readJson(path.join(dir, "package.json")) }))
    .filter(({ packageJson }) => packageJson.private !== true)
    .filter(({ packageJson }) => typeof packageJson.name === "string")
    .filter(({ packageJson }) => typeof packageJson.version === "string")
    .sort((a, b) => a.packageJson.name.localeCompare(b.packageJson.name));
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function assertIndependentVersioning(root, packages = findPublicPackages(root)) {
  const config = readJson(path.join(root, ".changeset", "config.json"));
  if (!Array.isArray(config.fixed) || config.fixed.length !== 0) {
    throw new Error("Changesets fixed groups must be empty so packages version independently.");
  }
  if (!Array.isArray(config.linked) || config.linked.length !== 0) {
    throw new Error("Changesets linked groups must be empty so packages version independently.");
  }
  if (config.privatePackages?.version !== false || config.privatePackages?.tag !== false) {
    throw new Error("Changesets must exclude private workspaces from versioning and tagging.");
  }
  const publicNames = new Set(packages.map(({ packageJson }) => packageJson.name));
  const ignoredPublicPackages = (config.ignore ?? []).filter((name) => publicNames.has(name));
  if (ignoredPublicPackages.length > 0) {
    throw new Error(
      `Changesets must not ignore public packages: ${ignoredPublicPackages.sort().join(", ")}.`,
    );
  }
}

export function assertWorkspaceInternalDependencies(packages) {
  const packageNames = new Set(packages.map(({ packageJson }) => packageJson.name));

  for (const { packageJson } of packages) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(packageJson[field] ?? {})) {
        if (packageNames.has(name) && range !== "workspace:*") {
          throw new Error(
            `${packageJson.name} ${field}.${name} must use workspace:* (received ${range}).`,
          );
        }
      }
    }
  }
}

export function assertStableReleaseState(root, packages = findPublicPackages(root)) {
  const invalid = packages
    .filter(({ packageJson }) => !stableVersionPattern.test(packageJson.version))
    .map(({ packageJson }) => `${packageJson.name}@${packageJson.version}`);
  if (invalid.length > 0) {
    throw new Error(`Stable releases require stable semantic versions: ${invalid.join(", ")}.`);
  }
  if (readPrereleaseState(root) !== undefined) {
    throw new Error("Stable releases require Changesets prerelease mode to be exited.");
  }

  assertNoPendingChangesets(root);
  return packages.map(({ packageJson }) => ({
    name: packageJson.name,
    version: packageJson.version,
  }));
}

export function readPrereleaseState(root = process.cwd()) {
  const filePath = path.join(root, ".changeset", "pre.json");
  return existsSync(filePath) ? readJson(filePath) : undefined;
}

export function assertPrereleaseState(root, tag, packages = findPublicPackages(root)) {
  const state = readPrereleaseState(root);
  if (state === undefined || state.mode !== "pre" || state.tag !== tag) {
    throw new Error(`.changeset/pre.json must be in the ${tag} prerelease mode.`);
  }

  const initialVersions = Object.keys(state.initialVersions ?? {}).sort();
  const packageNames = packages.map(({ packageJson }) => packageJson.name).sort();
  const initialVersionSet = new Set(initialVersions);
  const missingPackages = packageNames.filter((name) => !initialVersionSet.has(name));
  if (missingPackages.length > 0) {
    throw new Error(
      `pre.json initialVersions is missing public packages: ${missingPackages.join(", ")}.`,
    );
  }

  if (!Array.isArray(state.changesets)) {
    throw new Error(".changeset/pre.json changesets must be an array.");
  }
  const prereleasePattern = new RegExp(
    `^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)-${escapeRegExp(tag)}\\.(0|[1-9]\\d*)$`,
  );
  const invalid = packages
    .filter(
      ({ packageJson }) =>
        !stableVersionPattern.test(packageJson.version) &&
        !prereleasePattern.test(packageJson.version),
    )
    .map(({ packageJson }) => `${packageJson.name}@${packageJson.version}`);
  if (invalid.length > 0) {
    throw new Error(
      `Packages must use stable versions or the ${tag} prerelease tag: ${invalid.join(", ")}.`,
    );
  }
  const prereleases = packages.filter(({ packageJson }) =>
    prereleasePattern.test(packageJson.version),
  );
  if (prereleases.length === 0) {
    throw new Error(`At least one public package must have a ${tag} prerelease version.`);
  }
  return prereleases;
}

export function readPendingChangesets(root = process.cwd()) {
  const changesetRoot = path.join(root, ".changeset");
  const consumed = new Set(readPrereleaseState(root)?.changesets ?? []);
  return readdirSync(changesetRoot)
    .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
    .sort()
    .map((entry) => {
      const content = readFileSync(path.join(changesetRoot, entry), "utf8");
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (match === null) {
        throw new Error(`Invalid changeset frontmatter: ${entry}`);
      }

      const releases = [
        ...match[1].matchAll(/^["']?([^"':]+(?:\/[^"':]+)?)['"]?:\s*(patch|minor|major)\s*$/gm),
      ].map(([, name, bump]) => ({ name, bump }));
      if (releases.length === 0) {
        throw new Error(`Changeset ${entry} does not declare any releases.`);
      }

      return { id: entry.slice(0, -3), releases };
    })
    .filter(({ id }) => !consumed.has(id));
}

export function assertNoPendingChangesets(root = process.cwd()) {
  const pending = readPendingChangesets(root);
  if (pending.length > 0) {
    throw new Error(
      `Pending changesets must be versioned first: ${pending.map(({ id }) => id).join(", ")}`,
    );
  }
}

export function assertReleasableChangesets(changesets, allowedPackages) {
  if (changesets.length === 0) {
    throw new Error("At least one changeset is required for a release.");
  }

  if (allowedPackages !== undefined) {
    const unknown = changesets.flatMap(({ id, releases }) =>
      releases.filter(({ name }) => !allowedPackages.has(name)).map(({ name }) => `${id}: ${name}`),
    );
    if (unknown.length > 0) {
      throw new Error(`Changesets may only target public packages: ${unknown.join(", ")}`);
    }
  }
}

export function run(command, args, root = process.cwd()) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed.`);
  }
}

function findPackageDirs(dir) {
  const directories = [];
  for (const entry of readdirSync(dir).sort()) {
    const entryPath = path.join(dir, entry);
    if (!statSync(entryPath).isDirectory()) {
      continue;
    }
    if (existsSync(path.join(entryPath, "package.json"))) {
      directories.push(entryPath);
    } else {
      directories.push(...findPackageDirs(entryPath));
    }
  }
  return directories;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
