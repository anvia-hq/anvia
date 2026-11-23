import assert from "node:assert/strict";
import test from "node:test";
import { lintCode } from "./helpers.mjs";

const diagnosticCode = "anvia(padded-if)";

test("valid padded if statements and boundaries produce no diagnostics", (t) => {
  const result = lintCode(
    t,
    "valid.ts",
    `/* oxlint-disable anvia/no-inline-comments */
export function example(a: boolean, b: boolean, x: number) {
  if (a) {
    return 1;
  }

  let total = 2;

  // Leading comment after blank line
  if (b) {
    total += 1;
  } else if (x > 0) {
    total += x;
  } else {
    total -= 1;
  }

  if (x < 0) {
    if (b) {
      total -= 2;
    }
  }

  // Trailing section comment
  const after = total + 3;

  switch (x) {
    case 1:
      if (b) {
        return after;
      }

      break;
    default:
      break;
  }

  return after;
}
`,
  );

  assert.equal(result.status, 0, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
});

test("reports missing blank lines before, after, and between if statements", (t) => {
  const result = lintCode(
    t,
    "invalid.ts",
    `export function example(a: boolean, b: boolean) {
  const first = 1;
  if (a) {
    return first;
  }
  if (b) {
    return 2;
  }
  return 3;
}
`,
  );

  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.length, 3, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    result.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      line: d.labels[0].span.line,
      message: d.message,
    })),
    [
      {
        code: diagnosticCode,
        severity: "error",
        line: 3,
        message: "Expected a blank line before this if statement.",
      },
      {
        code: diagnosticCode,
        severity: "error",
        line: 6,
        message: "Expected a blank line before this if statement.",
      },
      {
        code: diagnosticCode,
        severity: "error",
        line: 9,
        message: "Expected a blank line after the preceding if statement.",
      },
    ],
  );
});

test("autofix inserts blank lines around if statements and preserves comments", (t) => {
  const input = `/* oxlint-disable anvia/no-inline-comments */
export function example(a: boolean, b: boolean) {
  const first = 1; // keep trailing comment on prev line
  // leading comment stays attached to if
  if (a) {
    return first;
  } // trailing comment on if
  if (b) {
    return 2;
  }
  // leading comment on next statement
  return 3;
}
`;
  const expected = `/* oxlint-disable anvia/no-inline-comments */
export function example(a: boolean, b: boolean) {
  const first = 1; // keep trailing comment on prev line

  // leading comment stays attached to if
  if (a) {
    return first;
  } // trailing comment on if

  if (b) {
    return 2;
  }

  // leading comment on next statement
  return 3;
}
`;

  const fixed = lintCode(t, "fixable.ts", input, ["--fix"]);
  assert.equal(fixed.status, 0);
  assert.equal(fixed.output, expected);

  const rechecked = lintCode(t, "recheck.ts", fixed.output);
  assert.equal(rechecked.status, 0);
  assert.deepEqual(rechecked.diagnostics, []);
});

test("handles same-line statements, top-level ifs, switch cases, and static blocks", (t) => {
  const input = `export const flag = true;
if (flag) {
  console.log("top");
}
export class Box {
  static {
    const a = 1;
    if (a > 0) {
      console.log(a);
    }
    console.log("done");
  }
}
export function oneline(a: boolean) {
  const x = 1; if (a) return x; return 0;
}
`;
  const expected = `export const flag = true;

if (flag) {
  console.log("top");
}

export class Box {
  static {
    const a = 1;

    if (a > 0) {
      console.log(a);
    }

    console.log("done");
  }
}
export function oneline(a: boolean) {
  const x = 1;

if (a) return x;

return 0;
}
`;

  const fixed = lintCode(t, "containers.ts", input, ["--fix"]);
  assert.equal(fixed.status, 0);
  assert.equal(fixed.output, expected);

  const rechecked = lintCode(t, "containers-recheck.ts", fixed.output);
  assert.equal(rechecked.status, 0);
  assert.deepEqual(rechecked.diagnostics, []);
});
