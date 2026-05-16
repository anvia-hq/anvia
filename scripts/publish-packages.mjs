import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const packagesRoot = path.join(root, "packages");
const registry = process.env.npm_config_registry ?? process.env.NPM_CONFIG_REGISTRY;

const packageDirs = findPackageDirs(packagesRoot);
const packages = packageDirs
  .map((dir) => ({ dir, packageJson: readPackageJson(dir) }))
  .filter((pkg) => pkg.packageJson.private !== true)
  .filter((pkg) => typeof pkg.packageJson.name === "string")
  .filter((pkg) => typeof pkg.packageJson.version === "string");

const packageNames = new Set(packages.map((pkg) => pkg.packageJson.name));
const sortedPackages = topologicalSort(packages, packageNames);
const published = [];
const failed = [];

for (const pkg of sortedPackages) {
  const { name, version, publishConfig } = pkg.packageJson;
  if (await isVersionPublished(name, version)) {
    console.warn(
      `${name} is not being published because version ${version} is already published on npm`,
    );
    continue;
  }

  console.info(`Publishing "${name}" at "${version}"`);
  const args = ["publish", "--access", publishConfig?.access ?? "public", "--tag", "latest"];
  const result = spawnSync("npm", args, {
    cwd: pkg.dir,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status === 0) {
    published.push({ name, version });
    continue;
  }

  failed.push({ name, version });
}

if (published.length > 0) {
  console.info("packages published successfully:");
  for (const pkg of published) {
    console.info(`${pkg.name}@${pkg.version}`);
  }
  createGitTags(published);
}

if (failed.length > 0) {
  console.error("packages failed to publish:");
  for (const pkg of failed) {
    console.error(`${pkg.name}@${pkg.version}`);
  }
  process.exit(1);
}

if (published.length === 0) {
  console.warn("No unpublished projects to publish");
}

function findPackageDirs(dir) {
  const entries = readdirSync(dir).sort();
  const dirs = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry);
    if (!statSync(entryPath).isDirectory()) {
      continue;
    }
    if (existsSync(path.join(entryPath, "package.json"))) {
      dirs.push(entryPath);
      continue;
    }
    dirs.push(...findPackageDirs(entryPath));
  }
  return dirs;
}

function readPackageJson(dir) {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
}

async function isVersionPublished(name, version) {
  const args = ["view", `${name}@${version}`, "version", "--json"];
  if (registry !== undefined && registry.length > 0) {
    args.push("--registry", registry);
  }
  const result = spawnSync("npm", args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });

  if (result.status === 0 && result.stdout.trim().length > 0) {
    return true;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (output.includes("E404") || output.includes("No match found for version")) {
    return false;
  }

  console.error(output.trim());
  throw new Error(`Failed checking npm version for ${name}@${version}`);
}

function createGitTags(releases) {
  for (const release of releases) {
    const tag = `${release.name}@${release.version}`;
    const existing = spawnSync("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`], {
      cwd: root,
      stdio: "ignore",
    });
    if (existing.status === 0) {
      continue;
    }
    console.info("New tag:", tag);
    run("git", ["tag", tag], root);
  }
}

function topologicalSort(items, workspaceNames) {
  const itemByName = new Map(items.map((item) => [item.packageJson.name, item]));
  const visited = new Set();
  const visiting = new Set();
  const sorted = [];

  for (const item of items) {
    visit(item);
  }

  return sorted;

  function visit(item) {
    const name = item.packageJson.name;
    if (visited.has(name)) {
      return;
    }
    if (visiting.has(name)) {
      throw new Error(`Circular workspace dependency detected at ${name}`);
    }

    visiting.add(name);
    for (const dependency of workspaceDependencies(item.packageJson, workspaceNames)) {
      const dependencyItem = itemByName.get(dependency);
      if (dependencyItem !== undefined) {
        visit(dependencyItem);
      }
    }
    visiting.delete(name);
    visited.add(name);
    sorted.push(item);
  }
}

function workspaceDependencies(packageJson, workspaceNames) {
  return [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ].filter((dependency) => workspaceNames.has(dependency));
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}
