import {
  assertFixedReleaseTrain,
  assertGitAncestor,
  assertInitialMajorChangeset,
  assertNoPendingChangesets,
  assertRcPrereleaseState,
  assertStableReleaseState,
  assertSynchronizedVersions,
  assertWorkspaceInternalDependencies,
  findPublicPackages,
  parseRcTag,
  readPendingChangesets,
} from "./release-train.mjs";

const root = process.cwd();
const packages = findPublicPackages(root);
const tag = readOption("--tag");
const stable = process.argv.includes("--stable");

if (tag !== undefined && stable) {
  throw new Error("--tag and --stable cannot be used together.");
}

assertFixedReleaseTrain(root, packages);
assertWorkspaceInternalDependencies(packages);

if (!stable && packages.some(({ packageJson }) => packageJson.version.startsWith("0."))) {
  assertInitialMajorChangeset(
    readPendingChangesets(root),
    new Set(packages.map(({ packageJson }) => packageJson.name)),
  );
}

let stableVersion;
if (stable) {
  stableVersion = assertStableReleaseState(root, packages);
}

if (tag !== undefined) {
  const { version } = parseRcTag(tag, { publicOnly: true });
  assertSynchronizedVersions(packages, version);
  assertRcPrereleaseState(root, version);
  assertNoPendingChangesets(root);

  if (process.argv.includes("--require-staging-ancestor")) {
    assertGitAncestor(root, process.env.GITHUB_SHA ?? "HEAD", "origin/staging");
  }
}

console.info(
  tag !== undefined
    ? `Validated ${tag} for all ${packages.length} public packages.`
    : stableVersion !== undefined
      ? `Validated stable ${stableVersion} for all ${packages.length} public packages.`
      : `Validated the ${packages.length}-package Anvia release train.`,
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
