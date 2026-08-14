import {
  assertFixedReleaseTrain,
  assertInitialMajorChangeset,
  assertNoPendingChangesets,
  assertPatchOnlyChangesets,
  assertRcPrereleaseState,
  assertSynchronizedVersions,
  assertWorkspaceInternalDependencies,
  findPublicPackages,
  parseRcVersion,
  RELEASE_BASE_VERSION,
  readPendingChangesets,
  readPrereleaseState,
  run,
} from "./release-train.mjs";

const root = process.cwd();
const action = process.argv[2];
const packages = findPublicPackages(root);

assertFixedReleaseTrain(root, packages);
assertWorkspaceInternalDependencies(packages);

if (action === "enter") {
  if (readPrereleaseState(root) !== undefined) {
    throw new Error("Prerelease mode is already active.");
  }

  assertInitialMajorChangeset(
    readPendingChangesets(root),
    new Set(packages.map(({ packageJson }) => packageJson.name)),
  );

  run("pnpm", ["changeset", "pre", "enter", "rc"], root);
  run("pnpm", ["changeset", "version"], root);
  validateVersion(`${RELEASE_BASE_VERSION}-rc.0`);
  console.info("Prepared unpublished 1.0.0-rc.0. Commit the generated release state for review.");
} else if (action === "next") {
  const version = currentSynchronizedRcVersion();
  const candidate = parseRcVersion(version);
  assertRcPrereleaseState(root, version);
  assertPatchOnlyChangesets(
    readPendingChangesets(root),
    new Set(packages.map(({ packageJson }) => packageJson.name)),
  );

  run("pnpm", ["changeset", "version"], root);
  const nextVersion = `${RELEASE_BASE_VERSION}-rc.${candidate + 1}`;
  validateVersion(nextVersion);
  console.info(`Prepared ${nextVersion}. Commit the generated release state before tagging it.`);
} else if (action === "exit") {
  const version = currentSynchronizedRcVersion();
  assertRcPrereleaseState(root, version);
  assertNoPendingChangesets(root);

  run("pnpm", ["changeset", "pre", "exit"], root);
  run("pnpm", ["changeset", "version"], root);
  assertSynchronizedVersions(findPublicPackages(root), RELEASE_BASE_VERSION);
  if (readPrereleaseState(root) !== undefined) {
    throw new Error("Changesets did not remove .changeset/pre.json after exiting prerelease mode.");
  }
  console.info("Prepared stable 1.0.0. Commit the generated release state for review.");
} else {
  throw new Error("Usage: node scripts/version-release-candidate.mjs <enter|next|exit>");
}

function currentSynchronizedRcVersion() {
  const versions = new Set(packages.map(({ packageJson }) => packageJson.version));
  if (versions.size !== 1) {
    throw new Error("Every public package must have the same RC version.");
  }
  const [version] = versions;
  parseRcVersion(version);
  return version;
}

function validateVersion(version) {
  const updatedPackages = findPublicPackages(root);
  assertSynchronizedVersions(updatedPackages, version);
  assertRcPrereleaseState(root, version);
  assertWorkspaceInternalDependencies(updatedPackages);
}
