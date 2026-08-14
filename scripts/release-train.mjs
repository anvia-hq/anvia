import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const RELEASE_BASE_VERSION = "1.0.0";
export const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export function createPreviewVersion(buildId) {
  if (!/^\d{8}T\d{6}\.sha-[0-9a-f]{7,40}$/.test(buildId)) {
    throw new Error("Preview build ID must use <YYYYMMDDTHHMMSS>.sha-<7-to-40-character-commit>.");
  }
  return `${RELEASE_BASE_VERSION}-preview.${buildId}`;
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

export function assertFixedReleaseTrain(root, packages = findPublicPackages(root)) {
  const config = readJson(path.join(root, ".changeset", "config.json"));
  const expected = packages.map(({ packageJson }) => packageJson.name).sort();

  if (!Array.isArray(config.fixed) || config.fixed.length !== 1) {
    throw new Error("Changesets must contain exactly one fixed release group.");
  }
  if (config.privatePackages?.version !== false || config.privatePackages?.tag !== false) {
    throw new Error("Changesets must exclude private workspaces from versioning and tagging.");
  }

  const actual = [...config.fixed[0]].sort();
  assertSameValues(actual, expected, "Changesets fixed group", "public package set");
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

export function assertSynchronizedVersions(packages, expectedVersion) {
  const versions = new Set(packages.map(({ packageJson }) => packageJson.version));
  if (versions.size !== 1 || !versions.has(expectedVersion)) {
    const details = packages
      .map(({ packageJson }) => `${packageJson.name}@${packageJson.version}`)
      .join(", ");
    throw new Error(`Expected every public package to be ${expectedVersion}; received ${details}.`);
  }
}

export function readPrereleaseState(root = process.cwd()) {
  const filePath = path.join(root, ".changeset", "pre.json");
  return existsSync(filePath) ? readJson(filePath) : undefined;
}

export function assertRcPrereleaseState(root, expectedVersion) {
  const state = readPrereleaseState(root);
  if (state === undefined || state.mode !== "pre" || state.tag !== "rc") {
    throw new Error(".changeset/pre.json must be in the rc prerelease mode.");
  }

  parseRcVersion(expectedVersion);
  const initialVersions = Object.keys(state.initialVersions ?? {}).sort();
  const packageNames = findPublicPackages(root)
    .map(({ packageJson }) => packageJson.name)
    .sort();
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
}

export function parseRcTag(tag, { publicOnly = false } = {}) {
  const match = tag.match(/^v(1\.0\.0-rc\.(0|[1-9]\d*))$/);
  if (match === null) {
    throw new Error(`Invalid release-candidate tag: ${tag}`);
  }

  const candidate = Number(match[2]);
  if (!Number.isSafeInteger(candidate)) {
    throw new Error(`Release-candidate number is too large: ${match[2]}`);
  }
  if (publicOnly && candidate === 0) {
    throw new Error("rc.0 is an unpublished preparation version and cannot trigger CD.");
  }

  return { version: match[1], candidate };
}

export function parseRcVersion(version) {
  return parseRcTag(`v${version}`).candidate;
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

export function assertPatchOnlyChangesets(changesets, allowedPackages) {
  if (changesets.length === 0) {
    throw new Error("A patch changeset is required for the next release candidate.");
  }

  const invalid = changesets.flatMap(({ id, releases }) =>
    releases
      .filter(({ bump }) => bump !== "patch")
      .map(({ name, bump }) => `${id}: ${name} (${bump})`),
  );
  if (invalid.length > 0) {
    throw new Error(`RC changesets must use patch bumps only: ${invalid.join(", ")}`);
  }

  if (allowedPackages !== undefined) {
    const unknown = changesets.flatMap(({ id, releases }) =>
      releases.filter(({ name }) => !allowedPackages.has(name)).map(({ name }) => `${id}: ${name}`),
    );
    if (unknown.length > 0) {
      throw new Error(
        `RC changesets may only target public release-train packages: ${unknown.join(", ")}`,
      );
    }
  }
}

export function assertInitialMajorChangeset(changesets, publicPackageNames) {
  const majorPackages = new Set(
    changesets.flatMap(({ releases }) =>
      releases.filter(({ bump }) => bump === "major").map(({ name }) => name),
    ),
  );
  const missing = [...publicPackageNames].filter((name) => !majorPackages.has(name)).sort();
  if (missing.length > 0) {
    throw new Error(
      `The initial 1.0 changeset must major-bump every public package: ${missing.join(", ")}`,
    );
  }
}

export function assertGitAncestor(root, ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${ancestor} must be an ancestor of ${descendant}.`);
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

function assertSameValues(actual, expected, actualLabel, expectedLabel) {
  if (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  ) {
    return;
  }

  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));
  throw new Error(
    `${actualLabel} does not match ${expectedLabel}. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`,
  );
}
