import assert from "node:assert/strict";
import test from "node:test";
import { lintCode } from "./helpers.mjs";

const diagnosticCode = "anvia(no-inline-comments)";

test("allows standalone JSDoc comments and tooling directives", (t) => {
  const result = lintCode(
    t,
    "valid.ts",
    `/// <reference types="node" />
// @vitest-environment happy-dom

/**
 * Computes a doubled value.
 */
export function double(value: number): number {
  // @ts-expect-error intentional check
  const invalid: string = value;
  void invalid;

  /* @__PURE__ */
  const label = String(value);
  void label;

  /* v8 ignore next */
  return value * 2;
}

/** Provider-agnostic request shape. */
export type RequestShape = {
  /** Maximum token budget for the call. */
  maxTokens?: number;
};

// oxlint-disable-next-line typescript/no-explicit-any
export const dynamicValue: any = 1;
`,
  );

  assert.equal(result.status, 0, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
});

test("reports line comments, non-JSDoc block comments, banners, and empty blocks", (t) => {
  const result = lintCode(
    t,
    "invalid.ts",
    `// standalone explanation
export function example(value: number): number {
  const doubled = value * 2; // trailing comment
  /* block comment */
  /*** decorative banner ***/
  /**/
  return doubled;
}
`,
  );

  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.length, 5, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    result.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      line: d.labels[0].span.line,
    })),
    [
      { code: diagnosticCode, severity: "error", line: 1 },
      { code: diagnosticCode, severity: "error", line: 3 },
      { code: diagnosticCode, severity: "error", line: 4 },
      { code: diagnosticCode, severity: "error", line: 5 },
      { code: diagnosticCode, severity: "error", line: 6 },
    ],
  );
});

test("reports trailing JSDoc comments on the same line as code", (t) => {
  const result = lintCode(
    t,
    "trailing-jsdoc.ts",
    `export const value = 1; /** not standalone jsdoc */
`,
  );

  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics[0].code, diagnosticCode);
  assert.equal(result.diagnostics[0].severity, "error");
  assert.equal(
    result.diagnostics[0].message,
    "JSDoc comments must be placed on their own line, not trailing code on the same line.",
  );
});

test("does not treat arbitrary @-prefixed prose comments as directives", (t) => {
  const result = lintCode(
    t,
    "prose-at.ts",
    `// @types/ws overloads are stricter than expected
export const ok = true;
`,
  );

  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics[0].code, diagnosticCode);
});

test("reports JSX block comments", (t) => {
  const result = lintCode(
    t,
    "component.tsx",
    `export function View() {
  return <div>{/* inline note */}ok</div>;
}
`,
  );

  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics[0].code, diagnosticCode);
});
