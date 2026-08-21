import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { releasesReadyForTags } from "./publish-release-state.mjs";
import { releasePresentation } from "./release-notification.mjs";
import {
  assertFixedReleaseTrain,
  assertGitAncestor,
  assertInitialMajorChangeset,
  assertNoPendingChangesets,
  assertPatchOnlyChangesets,
  assertPreviewAllowed,
  assertRcPrereleaseState,
  assertStableReleaseState,
  assertSynchronizedVersions,
  assertWorkspaceInternalDependencies,
  createPreviewVersion,
  findPublicPackages,
  parseRcTag,
  readPendingChangesets,
  readPrereleaseState,
} from "./release-train.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rcScript = path.join(repositoryRoot, "scripts", "version-release-candidate.mjs");
const previewScript = path.join(repositoryRoot, "scripts", "prepare-preview-release.mjs");
const validatorScript = path.join(repositoryRoot, "scripts", "validate-release-train.mjs");

test("repository fixed group exactly matches public packages", () => {
  const packages = findPublicPackages(repositoryRoot);
  assert.equal(packages.length, 32);
  assert.doesNotThrow(() => assertFixedReleaseTrain(repositoryRoot, packages));
  assert.doesNotThrow(() => assertWorkspaceInternalDependencies(packages));
});

test("validates preview and public RC versions", () => {
  assert.equal(
    createPreviewVersion("20260814T120102.sha-abcdef0"),
    "1.0.0-preview.20260814T120102.sha-abcdef0",
  );
  assert.deepEqual(parseRcTag("v1.0.0-rc.2", { publicOnly: true }), {
    version: "1.0.0-rc.2",
    candidate: 2,
  });
  assert.throws(() => parseRcTag("v1.0.0-rc.0", { publicOnly: true }), /unpublished/);
  assert.throws(() => parseRcTag("v1.0.0-rc.01"), /Invalid/);
});

test("preview dry runs respect the release phase without changing package manifests", () => {
  const packages = findPublicPackages(repositoryRoot);
  const before = packages.map(({ dir }) => readFileSync(path.join(dir, "package.json"), "utf8"));
  const result = spawnSync(process.execPath, [previewScript, "--dry-run"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, PREVIEW_BUILD_ID: "20260814T120102.sha-abcdef0" },
  });

  if (readPrereleaseState(repositoryRoot) === undefined) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.match(/^@anvia\/[^:]+: .* -> 1\.0\.0-preview\.20260814T120102\.sha-abcdef0$/gm)
        ?.length,
      packages.length,
    );
  } else {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Preview releases are disabled/);
  }

  assert.deepEqual(
    packages.map(({ dir }) => readFileSync(path.join(dir, "package.json"), "utf8")),
    before,
  );
});

test("staging ancestry validation rejects a descendant as the ancestor", () => {
  assert.doesNotThrow(() => assertGitAncestor(repositoryRoot, "HEAD", "HEAD"));
  assert.throws(() => assertGitAncestor(repositoryRoot, "HEAD", "HEAD^"), /must be an ancestor/);
});

test("RC changesets reject minor and major bumps", () => {
  assert.doesNotThrow(() =>
    assertPatchOnlyChangesets([{ id: "fix", releases: [{ name: "@anvia/core", bump: "patch" }] }]),
  );
  assert.throws(
    () =>
      assertPatchOnlyChangesets([
        { id: "break", releases: [{ name: "@anvia/core", bump: "minor" }] },
      ]),
    /patch bumps only/,
  );
});

test("initial RC preparation requires a major declaration for the whole train", () => {
  const train = new Set(["@anvia/core", "@anvia/openai"]);
  assert.doesNotThrow(() =>
    assertInitialMajorChangeset(
      [
        {
          id: "v1",
          releases: [
            { name: "@anvia/core", bump: "major" },
            { name: "@anvia/openai", bump: "major" },
          ],
        },
      ],
      train,
    ),
  );
  assert.throws(
    () =>
      assertInitialMajorChangeset(
        [{ id: "v1", releases: [{ name: "@anvia/core", bump: "major" }] }],
        train,
      ),
    /@anvia\/openai/,
  );
});

test("partial publish recovery includes registry-existing packages in tag creation", () => {
  const existing = [{ name: "@anvia/core", version: "1.0.0-rc.1" }];
  const published = [{ name: "@anvia/openai", version: "1.0.0-rc.1" }];
  assert.deepEqual(releasesReadyForTags(existing, published, []), [...existing, ...published]);
  assert.deepEqual(releasesReadyForTags(existing, published, [published[0]]), []);
});

test("RC notifications use the dedicated npm channel and presentation", () => {
  assert.deepEqual(releasePresentation("rc"), {
    title: "Release candidate packages published",
    npmTag: "rc",
    color: 0x8b5cf6,
    description: "Release candidate packages",
  });
});

test("Changesets drives rc.0 through rc.2 and exits to stable 1.0.0", () => {
  const fixture = createReleaseFixture();
  try {
    runRcScript(fixture, "enter");
    assertFixtureVersion(fixture, "1.0.0-rc.0");
    assertRcPrereleaseState(fixture, "1.0.0-rc.0");
    const preStatePath = path.join(fixture, ".changeset", "pre.json");
    const preState = JSON.parse(readFileSync(preStatePath, "utf8"));
    writeJson(preStatePath, { ...preState, tag: "next" });
    assert.throws(() => assertRcPrereleaseState(fixture, "1.0.0-rc.0"), /rc prerelease mode/);
    writeJson(preStatePath, preState);
    assert.throws(() => assertPreviewAllowed(fixture), /disabled/);
    const packageBPath = path.join(fixture, "packages", "b", "package.json");
    const packageB = JSON.parse(readFileSync(packageBPath, "utf8"));
    writeJson(packageBPath, { ...packageB, version: "1.0.0-rc.9" });
    assert.throws(
      () => assertSynchronizedVersions(findPublicPackages(fixture), "1.0.0-rc.0"),
      /Expected every public package/,
    );
    writeJson(packageBPath, packageB);
    assert.match(
      readFileSync(path.join(fixture, "packages", "a", "CHANGELOG.md"), "utf8"),
      /1\.0\.0-rc\.0/,
    );

    writeChangeset(fixture, "invalid-minor", "minor", "Attempt an invalid RC minor.", ["a"]);
    const invalidRc = spawnRcScript(fixture, "next");
    assert.notEqual(invalidRc.status, 0);
    assert.match(invalidRc.stderr, /patch bumps only/);
    assertFixtureVersion(fixture, "1.0.0-rc.0");
    rmSync(path.join(fixture, ".changeset", "invalid-minor.md"));

    writeChangeset(fixture, "public-ready", "patch", "Prepare the public release candidate.", [
      "a",
    ]);
    assert.equal(readPendingChangesets(fixture).length, 1);
    assert.throws(() => assertNoPendingChangesets(fixture), /public-ready/);
    assertPatchOnlyChangesets(readPendingChangesets(fixture));
    runRcScript(fixture, "next");
    assertFixtureVersion(fixture, "1.0.0-rc.1");
    assert.doesNotThrow(() => assertNoPendingChangesets(fixture));
    assert.equal(spawnValidator(fixture, "v1.0.0-rc.1").status, 0);
    const wrongTag = spawnValidator(fixture, "v1.0.0-rc.2");
    assert.notEqual(wrongTag.status, 0);
    assert.match(wrongTag.stderr, /Expected every public package/);

    writeChangeset(fixture, "rc-fix", "patch", "Fix a release-candidate issue.", ["b"]);
    runRcScript(fixture, "next");
    assertFixtureVersion(fixture, "1.0.0-rc.2");
    assert.throws(() => assertStableReleaseState(fixture), /non-prerelease semantic version/);
    const prereleaseStable = spawnStableValidator(fixture);
    assert.notEqual(prereleaseStable.status, 0);
    assert.match(prereleaseStable.stderr, /non-prerelease semantic version/);

    runRcScript(fixture, "exit");
    assertFixtureVersion(fixture, "1.0.0");
    assert.equal(existsSync(path.join(fixture, ".changeset", "pre.json")), false);
    assert.equal(
      JSON.parse(
        readFileSync(path.join(fixture, "packages", "private-example", "package.json"), "utf8"),
      ).version,
      "0.1.0",
    );
    assert.throws(() => assertRcPrereleaseState(fixture, "1.0.0"), /prerelease mode/);
    assert.equal(assertStableReleaseState(fixture), "1.0.0");
    assert.equal(spawnStableValidator(fixture).status, 0);

    writeChangeset(fixture, "unversioned-fix", "patch", "A pending stable fix.", ["a"]);
    assert.throws(() => assertStableReleaseState(fixture), /Pending changesets/);
    const pendingStable = spawnStableValidator(fixture);
    assert.notEqual(pendingStable.status, 0);
    assert.match(pendingStable.stderr, /Pending changesets/);
    rmSync(path.join(fixture, ".changeset", "unversioned-fix.md"));

    const changelog = readFileSync(path.join(fixture, "packages", "a", "CHANGELOG.md"), "utf8");
    assert.match(changelog, /1\.0\.0-rc\.1/);
    assert.match(changelog, /1\.0\.0-rc\.2/);
    assert.match(changelog, /## 1\.0\.0/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function createReleaseFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvia-release-train-test-"));
  mkdirSync(path.join(root, ".changeset"));
  mkdirSync(path.join(root, "packages", "a"), { recursive: true });
  mkdirSync(path.join(root, "packages", "b"), { recursive: true });
  mkdirSync(path.join(root, "packages", "private-example"), { recursive: true });
  symlinkSync(path.join(repositoryRoot, "node_modules"), path.join(root, "node_modules"), "dir");

  writeJson(path.join(root, "package.json"), {
    name: "release-fixture",
    private: true,
    packageManager: "pnpm@11.0.4",
    workspaces: ["packages/*"],
  });
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeJson(path.join(root, ".changeset", "config.json"), {
    changelog: "@changesets/cli/changelog",
    commit: false,
    fixed: [["@fixture/a", "@fixture/b"]],
    linked: [],
    access: "public",
    baseBranch: "main",
    updateInternalDependencies: "patch",
    privatePackages: { version: false, tag: false },
    ignore: [],
  });
  writeJson(path.join(root, "packages", "a", "package.json"), {
    name: "@fixture/a",
    version: "0.9.0",
  });
  writeJson(path.join(root, "packages", "b", "package.json"), {
    name: "@fixture/b",
    version: "0.2.0",
    peerDependencies: { "@fixture/a": "workspace:*" },
  });
  writeJson(path.join(root, "packages", "private-example", "package.json"), {
    name: "private-example",
    version: "0.1.0",
    private: true,
    devDependencies: { "@fixture/a": "workspace:*" },
  });
  writeChangeset(root, "version-one", "major", "Prepare version 1.0.");
  return root;
}

function writeChangeset(root, id, bump, summary, packages = ["a", "b"]) {
  const releases = packages.map((name) => `"@fixture/${name}": ${bump}`).join("\n");
  writeFileSync(path.join(root, ".changeset", `${id}.md`), `---\n${releases}\n---\n\n${summary}\n`);
}

function runRcScript(root, action) {
  const result = spawnRcScript(root, action);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function spawnRcScript(root, action) {
  return spawnSync(process.execPath, [rcScript, action], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
}

function spawnValidator(root, tag) {
  return spawnSync(process.execPath, [validatorScript, "--tag", tag], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
}

function spawnStableValidator(root) {
  return spawnSync(process.execPath, [validatorScript, "--stable"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
}

function assertFixtureVersion(root, version) {
  const packages = findPublicPackages(root);
  assertSynchronizedVersions(packages, version);
  assert.equal(packages[1].packageJson.peerDependencies["@fixture/a"], "workspace:*");
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
