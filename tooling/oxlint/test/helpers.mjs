import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const oxlintPackage = fileURLToPath(import.meta.resolve("oxlint/package.json"));
const oxlintManifest = JSON.parse(readFileSync(oxlintPackage, "utf8"));
const oxlintBin = path.resolve(path.dirname(oxlintPackage), oxlintManifest.bin.oxlint);

export function lintCode(t, filename, code, extraArgs = []) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "anvia-lint-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const fixture = path.join(directory, filename);
  writeFileSync(fixture, code);

  const result = spawnSync(
    process.execPath,
    [
      oxlintBin,
      "--config",
      path.join(repositoryRoot, ".oxlintrc.json"),
      "--format",
      "json",
      ...extraArgs,
      fixture,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);

  return {
    status: result.status,
    diagnostics: JSON.parse(result.stdout).diagnostics,
    output: readFileSync(fixture, "utf8"),
  };
}
