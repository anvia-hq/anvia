import assert from "node:assert/strict";
import test from "node:test";
import { lintCode } from "./helpers.mjs";

const diagnosticCode = "eslint(no-nested-ternary)";

test("nested ternary expressions fail lint", (t) => {
  const result = lintCode(
    t,
    "invalid.ts",
    `export const label = a ? (b ? "ab" : "a") : "none";
export const chained = a ? "a" : b ? "b" : "c";
`,
  );

  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.length, 2, JSON.stringify(result.diagnostics));
  for (const diagnostic of result.diagnostics) {
    assert.equal(diagnostic.code, diagnosticCode);
    assert.equal(diagnostic.severity, "error");
  }
});

test("flat ternary expressions remain allowed", (t) => {
  const result = lintCode(
    t,
    "valid.ts",
    `export const label = a ? "yes" : "no";
export const fallback = b ? value : other;
`,
  );

  assert.equal(result.status, 0);
  assert.deepEqual(result.diagnostics, []);
});
