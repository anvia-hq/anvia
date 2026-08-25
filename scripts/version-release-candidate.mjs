import {
  assertIndependentVersioning,
  assertNoPendingChangesets,
  assertPrereleaseState,
  assertReleasableChangesets,
  assertStableReleaseState,
  assertWorkspaceInternalDependencies,
  findPublicPackages,
  readPendingChangesets,
  readPrereleaseState,
  run,
} from "./release-train.mjs";

const root = process.cwd();
const action = process.argv[2];
const packages = findPublicPackages(root);
const publicPackageNames = new Set(packages.map(({ packageJson }) => packageJson.name));

assertIndependentVersioning(root, packages);
assertWorkspaceInternalDependencies(packages);

if (action === "enter") {
  if (readPrereleaseState(root) !== undefined) {
    throw new Error("Prerelease mode is already active.");
  }

  assertReleasableChangesets(readPendingChangesets(root), publicPackageNames);
  run("pnpm", ["changeset", "pre", "enter", "rc"], root);
  run("pnpm", ["changeset", "version"], root);
  const prereleases = validatePrerelease();
  console.info(
    `Prepared ${prereleases.length} independently versioned release-candidate package${prereleases.length === 1 ? "" : "s"}.`,
  );
} else if (action === "next") {
  assertPrereleaseState(root, "rc", packages);
  assertReleasableChangesets(readPendingChangesets(root), publicPackageNames);
  run("pnpm", ["changeset", "version"], root);
  const prereleases = validatePrerelease();
  console.info(
    `Updated ${prereleases.length} independently versioned release-candidate package${prereleases.length === 1 ? "" : "s"}.`,
  );
} else if (action === "exit") {
  assertPrereleaseState(root, "rc", packages);
  assertNoPendingChangesets(root);
  run("pnpm", ["changeset", "pre", "exit"], root);
  run("pnpm", ["changeset", "version"], root);
  const stableReleases = assertStableReleaseState(root, findPublicPackages(root));
  console.info(
    `Exited prerelease mode with ${stableReleases.length} independently versioned public packages.`,
  );
} else {
  throw new Error("Usage: node scripts/version-release-candidate.mjs <enter|next|exit>");
}

function validatePrerelease() {
  const updatedPackages = findPublicPackages(root);
  const prereleases = assertPrereleaseState(root, "rc", updatedPackages);
  assertNoPendingChangesets(root);
  assertWorkspaceInternalDependencies(updatedPackages);
  return prereleases;
}
