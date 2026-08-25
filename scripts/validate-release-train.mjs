import {
  assertIndependentVersioning,
  assertNoPendingChangesets,
  assertPrereleaseState,
  assertReleasableChangesets,
  assertStableReleaseState,
  assertWorkspaceInternalDependencies,
  findPublicPackages,
  readPendingChangesets,
} from "./release-train.mjs";

const root = process.cwd();
const packages = findPublicPackages(root);
const prereleaseTag = readOption("--prerelease");
const stable = process.argv.includes("--stable");

if (prereleaseTag !== undefined && stable) {
  throw new Error("--prerelease and --stable cannot be used together.");
}

assertIndependentVersioning(root, packages);
assertWorkspaceInternalDependencies(packages);

if (!stable && prereleaseTag === undefined) {
  const pending = readPendingChangesets(root);
  if (pending.length > 0) {
    assertReleasableChangesets(
      pending,
      new Set(packages.map(({ packageJson }) => packageJson.name)),
    );
  }
}

let stableReleases;
if (stable) {
  stableReleases = assertStableReleaseState(root, packages);
}

let prereleases;
if (prereleaseTag !== undefined) {
  prereleases = assertPrereleaseState(root, prereleaseTag, packages);
  assertNoPendingChangesets(root);
}

console.info(
  prereleases !== undefined
    ? `Validated ${prereleases.length} independently versioned ${prereleaseTag} package${prereleases.length === 1 ? "" : "s"}.`
    : stableReleases !== undefined
      ? `Validated stable versions for ${stableReleases.length} independently versioned public packages.`
      : `Validated independent versioning for ${packages.length} public packages.`,
);

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}
