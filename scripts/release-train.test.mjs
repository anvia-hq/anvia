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
  assertNoMajorReleases,
  assertNoMajorVersionChanges,
  assertNoPendingChangesets,
  assertPrereleaseState,
  assertReleasableChangesets,
  assertStableReleaseState,
  assertWorkspaceInternalDependencies,
  createPreviewVersion,
  findPublicPackages,
  readPendingChangesets,
  readReleasePlan,
} from "./release-train.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rcScript = path.join(repositoryRoot, "scripts", "version-release-candidate.mjs");
const previewScript = path.join(repositoryRoot, "scripts", "prepare-preview-release.mjs");
const validatorScript = path.join(repositoryRoot, "scripts", "validate-release-train.mjs");
const versionScript = path.join(repositoryRoot, "scripts", "version-packages.mjs");

test("repository config versions every public package independently", () => {
  const packages = findPublicPackages(repositoryRoot);
  assert.equal(packages.length, 38);
  assert.ok(packages.some(({ packageJson }) => packageJson.name === "@anvia/azure"));
  assert.ok(packages.some(({ packageJson }) => packageJson.name === "@anvia/jev"));
  assert.doesNotThrow(() => assertIndependentVersioning(repositoryRoot, packages));
  assert.doesNotThrow(() => assertWorkspaceInternalDependencies(packages));
});

test("public package discovery ignores stale node_modules in directories without manifests", () => {
  const fixture = createReleaseFixture();
  try {
    const stale = path.join(fixture, "packages", "removed-package", "node_modules", "dependency");
    mkdirSync(stale, { recursive: true });
    writeJson(path.join(stale, "package.json"), { name: "stale-dependency", version: "1.0.0" });
    assert.deepEqual(
      findPublicPackages(fixture).map(({ packageJson }) => packageJson.name),
      ["@fixture/a", "@fixture/b"],
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
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

test("workspace validation requires compatible peers and exact ordinary dependencies", () => {
  const a = { packageJson: { name: "@fixture/a", version: "1.0.2" } };
  const b = {
    packageJson: {
      name: "@fixture/b",
      version: "2.4.0",
      peerDependencies: { "@fixture/a": "workspace:^" },
      dependencies: { "@fixture/a": "workspace:*" },
      devDependencies: { "@fixture/a": "workspace:*" },
    },
  };
  assert.doesNotThrow(() => assertWorkspaceInternalDependencies([a, b]));
  b.packageJson.peerDependencies["@fixture/a"] = "workspace:*";
  assert.throws(
    () => assertWorkspaceInternalDependencies([a, b]),
    /peerDependencies.*must use workspace:\^/,
  );
  b.packageJson.peerDependencies["@fixture/a"] = "workspace:^";
  b.packageJson.dependencies["@fixture/a"] = "workspace:^";
  assert.throws(
    () => assertWorkspaceInternalDependencies([a, b]),
    /dependencies.*must use workspace:\*/,
  );
});

test("compatible workspace peers prevent automatic major bumps for minor releases", () => {
  const fixture = createReleaseFixture();
  try {
    initializeGitFixture(fixture);
    const manifestPath = path.join(fixture, "packages", "b", "package.json");
    const manifest = readJson(manifestPath);
    manifest.peerDependencies = { "@fixture/a": "workspace:*" };
    manifest.devDependencies = { "@fixture/a": "workspace:*" };
    writeJson(manifestPath, manifest);
    writeChangeset(fixture, "a-minor", "minor", "Add an API to A.", ["a"]);
    writeChangeset(fixture, "b-minor", "minor", "Add a feature to B.", ["b"]);
    const output = path.join(fixture, "plan.json");
    const plan = () => {
      runCommand("pnpm", ["changeset", "status", "--output", output], fixture);
      return readJson(output).releases;
    };
    assert.equal(plan().find(({ name }) => name === "@fixture/b").newVersion, "3.0.0");
    manifest.peerDependencies["@fixture/a"] = "workspace:^";
    writeJson(manifestPath, manifest);
    const compatible = plan();
    assert.equal(compatible.find(({ name }) => name === "@fixture/a").newVersion, "1.1.0");
    assert.equal(compatible.find(({ name }) => name === "@fixture/b").newVersion, "2.5.0");
    assert.equal(
      compatible.some(({ type }) => type === "major"),
      false,
    );

    // A real breaking dependency release must still be visible in the plan.
    writeChangeset(fixture, "a-minor", "major", "Change A's contract.", ["a"]);
    assert.equal(plan().find(({ name }) => name === "@fixture/b").type, "major");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("supported 0.x peer lines keep dependents and their consumers on existing majors", () => {
  const fixture = createReleaseFixture();
  try {
    initializeGitFixture(fixture);
    writeJson(path.join(fixture, "packages", "a", "package.json"), {
      name: "@fixture/a",
      version: "0.1.1",
    });
    writeJson(path.join(fixture, "packages", "b", "package.json"), {
      name: "@fixture/b",
      version: "1.3.0",
      peerDependencies: { "@fixture/a": "workspace:^0.1.1 || ^0.2.0" },
      peerDependenciesMeta: { "@fixture/a": { optional: true } },
      devDependencies: { "@fixture/a": "workspace:*" },
    });
    mkdirSync(path.join(fixture, "packages", "c"));
    writeJson(path.join(fixture, "packages", "c", "package.json"), {
      name: "@fixture/c",
      version: "1.1.4",
      peerDependencies: { "@fixture/b": "workspace:^" },
    });
    writeChangeset(fixture, "a-minor", "minor", "Add durable streaming.", ["a"]);
    writeChangeset(fixture, "b-peers", "patch", "Accept supported durable lines.", ["b"]);
    assert.doesNotThrow(() => assertWorkspaceInternalDependencies(findPublicPackages(fixture)));
    const { releases } = readReleasePlan(fixture);
    assert.equal(releases.find(({ name }) => name === "@fixture/a").newVersion, "0.2.0");
    assert.equal(releases.find(({ name }) => name === "@fixture/b").newVersion, "1.3.1");
    assert.equal(
      releases.some(({ name, type }) => name === "@fixture/c" && type !== "none"),
      false,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("major changesets and numeric major increases are prohibited for every package", () => {
  assert.throws(
    () =>
      assertReleasableChangesets([
        { id: "breaking", releases: [{ name: "@fixture/a", bump: "major" }] },
      ]),
    /Major releases are prohibited.*@fixture\/a/,
  );
  assert.throws(
    () =>
      assertNoMajorReleases([
        { name: "@fixture/a", type: "patch", oldVersion: "1.3.0", newVersion: "2.0.0" },
      ]),
    /Major releases are prohibited/,
  );
  assert.doesNotThrow(() =>
    assertNoMajorReleases([
      { name: "@fixture/a", type: "minor", oldVersion: "0.1.1", newVersion: "0.2.0" },
      { name: "@fixture/b", type: "minor", oldVersion: "1.3.0", newVersion: "1.4.0-rc.0" },
    ]),
  );
});

test("release-plan validation works in detached CI checkouts without a local main branch", () => {
  const fixture = createReleaseFixture();
  try {
    initializeGitFixture(fixture);
    runCommand("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], fixture);
    runCommand("git", ["checkout", "--detach"], fixture);
    runCommand("git", ["branch", "-D", "main"], fixture);
    const configPath = path.join(fixture, ".changeset", "config.json");
    writeJson(configPath, { ...readJson(configPath), baseBranch: "origin/main" });
    writeChangeset(fixture, "a-fix", "patch", "Fix package A.", ["a"]);
    assert.equal(
      readReleasePlan(fixture).releases.find(({ name }) => name === "@fixture/a").newVersion,
      "1.0.3",
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("stable, RC, preview, and validation commands reject implicit major cascades", () => {
  const fixture = createReleaseFixture();
  try {
    initializeGitFixture(fixture);
    const dependencyPath = path.join(fixture, "packages", "a", "package.json");
    writeJson(dependencyPath, { ...readJson(dependencyPath), version: "0.1.1" });
    const dependentPath = path.join(fixture, "packages", "b", "package.json");
    writeJson(dependentPath, {
      ...readJson(dependentPath),
      peerDependencies: { "@fixture/a": "workspace:^" },
    });
    writeChangeset(fixture, "a-minor", "minor", "Add an API to A.", ["a"]);
    const before = [dependencyPath, dependentPath].map((file) => readFileSync(file, "utf8"));
    for (const args of [
      [versionScript],
      [rcScript, "enter"],
      [previewScript, "--dry-run"],
      [validatorScript],
    ]) {
      const result = spawnSync(process.execPath, args, {
        cwd: fixture,
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "true",
          GITHUB_BASE_REF: "",
          PREVIEW_BUILD_ID: "20260814T120102.sha-abcdef0",
        },
      });
      assert.notEqual(result.status, 0, args.join(" "));
      assert.match(result.stderr, /Major releases are prohibited.*@fixture\/b/);
      assert.deepEqual(
        [dependencyPath, dependentPath].map((file) => readFileSync(file, "utf8")),
        before,
      );
      assert.equal(existsSync(path.join(fixture, ".changeset", "pre.json")), false);
      assert.equal(existsSync(path.join(fixture, ".changeset", "a-minor.md")), true);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("versioned release PRs cannot hide major bumps by consuming changesets", () => {
  const fixture = createReleaseFixture();
  try {
    initializeGitFixture(fixture);
    const manifestPath = path.join(fixture, "packages", "a", "package.json");
    writeJson(manifestPath, { ...readJson(manifestPath), version: "2.0.0" });
    assert.throws(
      () => assertNoMajorVersionChanges(fixture, "main"),
      /Major releases are prohibited.*@fixture\/a/,
    );
    const result = spawnSync(process.execPath, [validatorScript, "--base-ref", "main"], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Major releases are prohibited/);
    writeJson(manifestPath, { ...readJson(manifestPath), version: "1.1.0" });
    assert.doesNotThrow(() => assertNoMajorVersionChanges(fixture, "main"));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("RC entry rolls back a rejected peer cascade and accepts declared prerelease compatibility", () => {
  const fixture = createReleaseFixture();
  try {
    initializeGitFixture(fixture);
    const manifestPath = path.join(fixture, "packages", "b", "package.json");
    const manifest = {
      ...readJson(manifestPath),
      peerDependencies: { "@fixture/a": "workspace:^" },
    };
    writeJson(manifestPath, manifest);
    writeChangeset(fixture, "a-minor", "minor", "Add an API to A.", ["a"]);
    assert.doesNotThrow(() => readReleasePlan(fixture));
    const rejected = spawnRcScript(fixture, "enter");
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Major releases are prohibited.*@fixture\/b/);
    assert.equal(existsSync(path.join(fixture, ".changeset", "pre.json")), false);
    assertPackageVersion(fixture, "a", "1.0.2");
    assertPackageVersion(fixture, "b", "2.4.0");
    assert.equal(existsSync(path.join(fixture, ".changeset", "a-minor.md")), true);

    manifest.peerDependencies["@fixture/a"] = "workspace:^1.0.2 || ^1.1.0-0";
    writeJson(manifestPath, manifest);
    writeChangeset(fixture, "b-peers", "patch", "Accept tested prerelease peers.", ["b"]);
    runRcScript(fixture, "enter");
    assertPackageVersion(fixture, "a", "1.1.0-rc.0");
    assertPackageVersion(fixture, "b", "2.4.1-rc.0");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "0.x minor boundary",
    current: "0.2.3",
    next: "0.3.0",
    dependentNext: "3.0.0",
    prerelease: false,
  },
  {
    name: "prerelease tuple boundary",
    current: "1.2.3-rc.0",
    next: "1.3.0-rc.1",
    dependentNext: "3.0.0-rc.0",
    prerelease: true,
  },
]) {
  test(`workspace peers release unchanged dependents across the ${scenario.name}`, () => {
    const fixture = createReleaseFixture();
    try {
      initializeGitFixture(fixture);
      const dependencyPath = path.join(fixture, "packages", "a", "package.json");
      writeJson(dependencyPath, { ...readJson(dependencyPath), version: scenario.current });
      const dependentPath = path.join(fixture, "packages", "b", "package.json");
      writeJson(dependentPath, {
        ...readJson(dependentPath),
        peerDependencies: { "@fixture/a": "workspace:^" },
      });
      if (scenario.prerelease) {
        writeJson(path.join(fixture, ".changeset", "pre.json"), {
          mode: "pre",
          tag: "rc",
          changesets: [],
          initialVersions: { "@fixture/a": "1.2.2", "@fixture/b": "2.4.0" },
        });
      }
      // Only A changes: B must be released solely because its peer range is exceeded.
      writeChangeset(fixture, "a-minor", "minor", "Add an API to A.", ["a"]);
      const output = path.join(fixture, "plan.json");
      runCommand("pnpm", ["changeset", "status", "--output", output], fixture);
      const { releases } = readJson(output);
      assert.equal(releases.find(({ name }) => name === "@fixture/a").newVersion, scenario.next);
      const dependent = releases.find(({ name }) => name === "@fixture/b");
      assert.ok(dependent, "Out-of-range peers must receive an implicit release");
      assert.deepEqual(dependent.changesets, []);
      assert.equal(dependent.type, "major");
      assert.equal(dependent.oldVersion, "2.4.0");
      assert.equal(dependent.newVersion, scenario.dependentNext);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}

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
    initializeGitFixture(fixture);
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
  const prepareJob = workflow.slice(
    workflow.indexOf("\n  prepare:"),
    workflow.indexOf("\n  publish:"),
  );
  assert.ok(
    prepareJob.indexOf("- name: Install dependencies") <
      prepareJob.indexOf("- name: Validate preview release state"),
  );
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
  // Fixtures borrow the repository install; pnpm must never reinstall through that symlink.
  writeFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\nverifyDepsBeforeRun: false\n",
  );
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
    env: { ...process.env, CI: "true", GITHUB_BASE_REF: "" },
  });
}

function spawnStableValidator(root) {
  return spawnSync(process.execPath, [validatorScript, "--stable"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true", GITHUB_BASE_REF: "" },
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
