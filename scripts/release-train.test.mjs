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
  assertIndependentVersioning,
  assertNoPendingChangesets,
  assertPrereleaseState,
  assertReleasableChangesets,
  assertStableReleaseState,
  assertWorkspaceInternalDependencies,
  createPreviewVersion,
  findPublicPackages,
  readPendingChangesets,
} from "./release-train.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rcScript = path.join(repositoryRoot, "scripts", "version-release-candidate.mjs");
const previewScript = path.join(repositoryRoot, "scripts", "prepare-preview-release.mjs");
const validatorScript = path.join(repositoryRoot, "scripts", "validate-release-train.mjs");

test("repository config versions every public package independently", () => {
  const packages = findPublicPackages(repositoryRoot);
  assert.equal(packages.length, 35);
  assert.doesNotThrow(() => assertIndependentVersioning(repositoryRoot, packages));
  assert.doesNotThrow(() => assertWorkspaceInternalDependencies(packages));
});

test("independent config rejects fixed, linked, and ignored public packages", () => {
  const fixture = createReleaseFixture();
  const configPath = path.join(fixture, ".changeset", "config.json");
  try {
    const config = readJson(configPath);
    writeJson(configPath, { ...config, fixed: [["@fixture/a", "@fixture/b"]] });
    assert.throws(() => assertIndependentVersioning(fixture), /fixed groups must be empty/);

    writeJson(configPath, { ...config, linked: [["@fixture/a", "@fixture/b"]] });
    assert.throws(() => assertIndependentVersioning(fixture), /linked groups must be empty/);

    writeJson(configPath, { ...config, ignore: ["@fixture/a"] });
    assert.throws(() => assertIndependentVersioning(fixture), /must not ignore public packages/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("preview versions use each package release plan version", () => {
  assert.equal(
    createPreviewVersion("1.4.2", "20260814T120102.sha-abcdef0"),
    "1.4.2-preview.20260814T120102.sha-abcdef0",
  );
  assert.throws(
    () => createPreviewVersion("1.4.2-rc.0", "20260814T120102.sha-abcdef0"),
    /stable semver/,
  );
});

test("preview dry runs version only packages in the Changesets release plan", () => {
  const fixture = createReleaseFixture();
  try {
    initializeGitFixture(fixture);
    writeChangeset(fixture, "a-preview", "patch", "Preview package A.", ["a"]);
    const packages = findPublicPackages(fixture);
    const before = packages.map(({ dir }) => readFileSync(path.join(dir, "package.json"), "utf8"));
    const result = spawnSync(process.execPath, [previewScript, "--dry-run"], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, PREVIEW_BUILD_ID: "20260814T120102.sha-abcdef0" },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /^@fixture\/a: 1\.0\.2 -> 1\.0\.3-preview\.20260814T120102\.sha-abcdef0$/m,
    );
    assert.equal(result.stdout.match(/^@fixture\//gm)?.length, 1);

    assert.deepEqual(
      packages.map(({ dir }) => readFileSync(path.join(dir, "package.json"), "utf8")),
      before,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("tag recovery includes only current-commit retries", () => {
  const existing = [
    { name: "@anvia/core", version: "1.0.2" },
    { name: "@anvia/studio", version: "1.0.3" },
  ];
  const published = [{ name: "@anvia/openai", version: "1.1.0" }];
  const recoverableTags = new Set(["@anvia/studio@1.0.3"]);

  assert.deepEqual(releasesReadyForTags(existing, published, [], recoverableTags), [
    published[0],
    existing[1],
  ]);
  assert.deepEqual(releasesReadyForTags(existing, published, [published[0]], recoverableTags), []);
});

test("release candidate preparation versions only changed packages", () => {
  const fixture = createReleaseFixture();
  try {
    writeChangeset(fixture, "a-fix", "patch", "Fix package A.", ["a"]);
    runRcScript(fixture, "enter");
    assertPackageVersion(fixture, "a", "1.0.3-rc.0");
    assertPackageVersion(fixture, "b", "2.4.0");
    assert.equal(assertPrereleaseState(fixture, "rc").length, 1);
    assert.equal(spawnPrereleaseValidator(fixture).status, 0);

    const missingChangeset = spawnRcScript(fixture, "next");
    assert.notEqual(missingChangeset.status, 0);
    assert.match(missingChangeset.stderr, /At least one changeset/);

    writeChangeset(fixture, "b-feature", "minor", "Add package B support.", ["b"]);
    runRcScript(fixture, "next");
    assertPackageVersion(fixture, "a", "1.0.3-rc.0");
    assertPackageVersion(fixture, "b", "2.5.0-rc.0");
    assert.equal(assertPrereleaseState(fixture, "rc").length, 2);

    runRcScript(fixture, "exit");
    assertPackageVersion(fixture, "a", "1.0.3");
    assertPackageVersion(fixture, "b", "2.5.0");
    assert.equal(existsSync(path.join(fixture, ".changeset", "pre.json")), false);
    assert.equal(assertStableReleaseState(fixture).length, 2);
    assert.equal(spawnStableValidator(fixture).status, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("stable validation permits different package versions and rejects pending changesets", () => {
  const fixture = createReleaseFixture();
  try {
    assert.equal(assertStableReleaseState(fixture).length, 2);
    writeChangeset(fixture, "pending", "patch", "A pending fix.", ["a"]);
    assert.throws(() => assertStableReleaseState(fixture), /Pending changesets/);
    assert.throws(() => assertNoPendingChangesets(fixture), /pending/);
    assert.doesNotThrow(() =>
      assertReleasableChangesets(
        readPendingChangesets(fixture),
        new Set(["@fixture/a", "@fixture/b"]),
      ),
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("manual RC publishing and OIDC setup remain explicit in the workflow", () => {
  const workflow = readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );
  const publishJob = workflow.slice(workflow.indexOf("\n  publish:"));
  const installDependencies = publishJob.indexOf("- name: Install dependencies");
  const publishPackages = publishJob.indexOf("- name: Publish packages");

  assert.match(workflow, /RC publishing must run from staging/);
  assert.match(workflow, /validate-release-train\.mjs --prerelease rc/);
  assert.doesNotMatch(workflow, /v1\.0\.0-rc\.\*/);
  assert.doesNotMatch(workflow, /Require current release branch\n\s+if:/);
  assert.notEqual(installDependencies, -1);
  assert.notEqual(publishPackages, -1);
  assert.ok(installDependencies < publishPackages);
  assert.match(publishJob, /- name: Install dependencies\n\s+run: pnpm install --frozen-lockfile/);
});

test("RC notifications retain their dedicated npm presentation", () => {
  assert.deepEqual(releasePresentation("rc"), {
    title: "Release candidate packages published",
    npmTag: "rc",
    color: 0x8b5cf6,
    description: "Release candidate packages",
  });
});

function createReleaseFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvia-independent-release-test-"));
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
    fixed: [],
    linked: [],
    access: "public",
    baseBranch: "main",
    updateInternalDependencies: "patch",
    privatePackages: { version: false, tag: false },
    ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: {
      onlyUpdatePeerDependentsWhenOutOfRange: true,
    },
    ignore: [],
  });
  writeJson(path.join(root, "packages", "a", "package.json"), {
    name: "@fixture/a",
    version: "1.0.2",
  });
  writeJson(path.join(root, "packages", "b", "package.json"), {
    name: "@fixture/b",
    version: "2.4.0",
  });
  writeJson(path.join(root, "packages", "private-example", "package.json"), {
    name: "private-example",
    version: "0.1.0",
    private: true,
    devDependencies: { "@fixture/a": "workspace:*" },
  });
  return root;
}

function writeChangeset(root, id, bump, summary, packages) {
  const releases = packages.map((name) => `"@fixture/${name}": ${bump}`).join("\n");
  writeFileSync(path.join(root, ".changeset", `${id}.md`), `---\n${releases}\n---\n\n${summary}\n`);
}

function initializeGitFixture(root) {
  runCommand("git", ["init", "--initial-branch=main"], root);
  runCommand("git", ["config", "user.email", "release-test@anvia.dev"], root);
  runCommand("git", ["config", "user.name", "Anvia Release Test"], root);
  runCommand(
    "git",
    [
      "add",
      ".changeset/config.json",
      "package.json",
      "pnpm-workspace.yaml",
      "packages/a/package.json",
      "packages/b/package.json",
      "packages/private-example/package.json",
    ],
    root,
  );
  runCommand("git", ["commit", "-m", "Initialize release fixture"], root);
}

function runCommand(command, args, root) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
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

function spawnPrereleaseValidator(root) {
  return spawnSync(process.execPath, [validatorScript, "--prerelease", "rc"], {
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

function assertPackageVersion(root, packageDir, expected) {
  assert.equal(readJson(path.join(root, "packages", packageDir, "package.json")).version, expected);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
