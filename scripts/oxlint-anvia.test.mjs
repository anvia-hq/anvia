import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const oxlintPackage = fileURLToPath(import.meta.resolve("oxlint/package.json"));
const oxlintManifest = JSON.parse(readFileSync(oxlintPackage, "utf8"));
const oxlintBin = path.resolve(path.dirname(oxlintPackage), oxlintManifest.bin.oxlint);
const diagnosticCode = "anvia(no-conditional-object-spread)";

function lint(t, filename, expressions) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "anvia-lint-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, filename);
  writeFileSync(
    fixture,
    expressions
      .map((expression, index) => `export const example${index} = ${expression};`)
      .join("\n"),
  );
  const result = spawnSync(
    process.execPath,
    [
      oxlintBin,
      "--config",
      path.join(repositoryRoot, ".oxlintrc.json"),
      "--format",
      "json",
      fixture,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return { status: result.status, diagnostics: JSON.parse(result.stdout).diagnostics };
}

test("conditional object spreads fail lint, including TypeScript wrappers", (t) => {
  const expressions = [
    "{ ...(flag ? value : {}) }",
    "{ ...(flag ? {} : value) }",
    "{ ...(flag && value) }",
    "{ ...(value || fallback) }",
    "{ ...(((flag ? value : {}))) }",
    "{ ...((flag ? value : {}) as object) }",
    "{ ...(<object>(flag ? value : {})) }",
    "{ ...((flag ? value : {})!) }",
    "{ ...((flag ? value : {}) satisfies object) }",
    "{ ...(((flag && value) as object)!) }",
    "{ nested: { ...(flag ? value : {}) } }",
  ];
  const result = lint(t, "invalid.ts", expressions);
  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.length, expressions.length, JSON.stringify(result.diagnostics));
  for (const [index, diagnostic] of result.diagnostics.entries()) {
    assert.equal(diagnostic.code, diagnosticCode);
    assert.equal(diagnostic.severity, "error");
    assert.equal(diagnostic.labels[0].span.line, index + 1);
  }
});

test("ordinary spreads, nullish fallbacks, arrays, calls, JSX, and rest remain allowed", (t) => {
  const result = lint(t, "valid.tsx", [
    "{ ...value }",
    "{ ...(value ?? fallback) }",
    "[...(values ?? [])]",
    "{ ...(value as object) }",
    "{ ...makeOptions(flag ? value : {}) }",
    "{ ...value, optional: flag ? value : undefined }",
    "[...(flag ? values : [])]",
    "call(...(flag ? values : []))",
    "<div {...(flag ? value : {})} />",
    "({ first: _first, ...rest }) => rest",
    '"{ ...(flag ? value : {}) }"',
    "(() => { const options = {}; if (flag) options.value = value; return options; })()",
  ]);
  assert.equal(result.status, 0, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
});

test("the rule also applies to test files", (t) => {
  const result = lint(t, "example.test.ts", ["{ ...(flag ? value : {}) }"]);
  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, diagnosticCode);
});
