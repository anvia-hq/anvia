import {
  assertIndependentVersioning,
  assertNoMajorVersionChanges,
  assertReleasableChangesets,
  assertStableReleaseState,
  assertWorkspaceInternalDependencies,
  findPublicPackages,
  readPendingChangesets,
  readReleasePlan,
} from "./release-train.mjs";

const root = process.cwd();
const packages = findPublicPackages(root);
const stable = process.argv.includes("--stable");

assertIndependentVersioning(root, packages);
assertWorkspaceInternalDependencies(packages);
const baseRef =
  readOption("--base-ref") ??
  (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined);
if (baseRef !== undefined) assertNoMajorVersionChanges(root, baseRef);

if (!stable) {
  const pending = readPendingChangesets(root);
  if (pending.length > 0) {
    assertReleasableChangesets(
      pending,
      new Set(packages.map(({ packageJson }) => packageJson.name)),
    );
    readReleasePlan(root);
  }
}

let stableReleases;
if (stable) {
  stableReleases = assertStableReleaseState(root, packages);
}

console.info(
  stableReleases !== undefined
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
