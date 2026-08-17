import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEPENDENCY_FIELDS, findPublicPackages } from "./release-train.mjs";

const root = process.cwd();
const representativePackages = new Set([
  "@anvia/core",
  "@anvia/grok",
  "@anvia/lens",
  "@anvia/memory-sqlite",
  "@anvia/neo4j",
  "@anvia/openai",
  "@anvia/otel",
  "@anvia/pgvector",
  "@anvia/react",
  "@anvia/react-ui",
  "@anvia/studio",
]);
const packages = findPublicPackages(root);
const packagesByName = new Map(packages.map((pkg) => [pkg.packageJson.name, pkg]));

for (const name of representativePackages) {
  if (!packagesByName.has(name)) {
    throw new Error(`Representative package is missing: ${name}`);
  }
}

for (const pkg of packages.filter(({ packageJson }) =>
  representativePackages.has(packageJson.name),
)) {
  const packedManifest = packAndReadManifest(pkg);
  assertPackedInternalVersions(packedManifest, packagesByName);
  console.info(`Verified packed internal versions for ${pkg.packageJson.name}.`);
}

export function assertPackedInternalVersions(manifest, packagesByName) {
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      const internalPackage = packagesByName.get(name);
      if (internalPackage === undefined) {
        continue;
      }
      const expected = internalPackage.packageJson.version;
      if (range !== expected) {
        throw new Error(
          `${manifest.name} packed ${field}.${name} as ${range}; expected exact ${expected}.`,
        );
      }
    }
  }
}

function packAndReadManifest(pkg) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "anvia-release-train-pack-"));
  try {
    const packed = spawnSync("pnpm", ["pack", "--pack-destination", tempDir, "--json"], {
      cwd: pkg.dir,
      encoding: "utf8",
      env: process.env,
    });
    if (packed.status !== 0) {
      throw new Error(`Failed to pack ${pkg.packageJson.name}: ${packed.stderr || packed.stdout}`);
    }

    const result = JSON.parse(packed.stdout);
    const filename = path.resolve(pkg.dir, result.filename);
    const extracted = spawnSync("tar", ["-xOf", filename, "package/package.json"], {
      encoding: "utf8",
    });
    if (extracted.status !== 0) {
      throw new Error(`Failed to read ${pkg.packageJson.name} tarball: ${extracted.stderr}`);
    }
    return JSON.parse(extracted.stdout);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
