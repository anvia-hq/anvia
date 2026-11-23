import assert from "node:assert/strict";
import test from "node:test";
import { lintCode } from "./helpers.mjs";

const diagnosticCode = "anvia(no-conditional-object-spread)";

function lintExpressions(t, filename, expressions) {
  const code = expressions
    .map((expression, index) => `export const example${index} = ${expression};`)
    .join("\n");

  return lintCode(t, filename, code);
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
  const result = lintExpressions(t, "invalid.ts", expressions);
  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.length, expressions.length, JSON.stringify(result.diagnostics));
  for (const [index, diagnostic] of result.diagnostics.entries()) {
    assert.equal(diagnostic.code, diagnosticCode);
    assert.equal(diagnostic.severity, "error");
    assert.equal(diagnostic.labels[0].span.line, index + 1);
  }
});

test("ordinary spreads, nullish fallbacks, arrays, calls, JSX, and rest remain allowed", (t) => {
  const result = lintExpressions(t, "valid.tsx", [
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
    `(() => {
  const options = {};

  if (flag) {
    options.value = value;
  }

  return options;
})()`,
  ]);
  assert.equal(result.status, 0, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
});

test("the rule also applies to test files", (t) => {
  const result = lintExpressions(t, "example.test.ts", ["{ ...(flag ? value : {}) }"]);
  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, diagnosticCode);
});
