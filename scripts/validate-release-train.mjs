import {
  assertFixedReleaseTrain,
  assertGitAncestor,
  assertInitialMajorChangeset,
  assertNoPendingChangesets,
  assertRcPrereleaseState,
  assertSynchronizedVersions,
  assertWorkspaceInternalDependencies,
  findPublicPackages,
  parseRcTag,
  readPendingChangesets,
} from "./release-train.mjs";

const root = process.cwd();
const packages = findPublicPackages(root);
const tag = readOption("--tag");

assertFixedReleaseTrain(root, packages);
assertWorkspaceInternalDependencies(packages);

if (packages.some(({ packageJson }) => packageJson.version.startsWith("0."))) {
  assertInitialMajorChangeset(
    readPendingChangesets(root),
    new Set(packages.map(({ packageJson }) => packageJson.name)),
  );
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
  tag === undefined
    ? `Validated the ${packages.length}-package Anvia release train.`
    : `Validated ${tag} for all ${packages.length} public packages.`,
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
