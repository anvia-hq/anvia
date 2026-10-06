import {
  assertIndependentVersioning,
  assertWorkspaceInternalDependencies,
  findPublicPackages,
  readReleasePlan,
  run,
} from "./release-train.mjs";

const root = process.cwd();
const packages = findPublicPackages(root);
assertIndependentVersioning(root, packages);
assertWorkspaceInternalDependencies(packages);
readReleasePlan(root);
run("pnpm", ["changeset", "version"], root);
