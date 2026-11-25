import { describe, expect, it } from "vitest";
import {
  assertEvalOutcomes,
  assertEvalTotals,
  evalExitCode,
  exactMatch,
  formatEvalResult,
  printEvalResult,
  runEvalCli,
  runEvalSuite,
} from "./helpers/imports";

describe("eval CLI result handling", () => {
  it("prints pretty and JSON results with per-case metric details", async () => {
    const result = await sampleResult();
    let pretty = "";
    let json = "";

    printEvalResult(result, { output: { stdout: (value) => (pretty += value) } });
    printEvalResult(result, {
      format: "json",
      output: { stdout: (value) => (json += value) },
    });

    expect(pretty).toContain("Cases: 2 total / 1 pass / 1 fail / 0 invalid");
    expect(pretty).toContain("exact_match: fail");
    expect(JSON.parse(json)).toMatchObject({
      metrics: { passed: 1, failed: 1, invalid: 0 },
      cases: { passed: 1, failed: 1, invalid: 0 },
    });
  });

  it("supports totals and per-metric negative-control expectations", async () => {
    const result = await sampleResult();
    const expectations = {
      totals: { passed: 1, failed: 1, invalid: 0 },
      outcomes: { red: { exact_match: "fail" as const } },
    };

    expect(evalExitCode(result)).toBe(1);
    expect(evalExitCode(result, expectations)).toBe(0);
    expect(() => assertEvalTotals(result, expectations.totals)).not.toThrow();
    expect(() => assertEvalOutcomes(result, expectations.outcomes)).not.toThrow();
    expect(() => assertEvalOutcomes(result, { red: { exact_match: "pass" } })).toThrow(
      /expected pass, received fail/,
    );

    const invalid = await runEvalSuite({
      name: "invalid",
      // @ts-expect-error direct suite definitions require implicit metric case fields.
      cases: [{ id: "missing-expected", input: "a" }],
      target: (input) => input,
      metrics: [exactMatch()],
    });
    expect(evalExitCode(invalid, { totals: { passed: 0, failed: 0, invalid: 1 } })).toBe(0);
  });

  it("runs suites in quiet mode without mutating exit state unless requested", async () => {
    const previousExitCode = process.exitCode;
    let output = "";
    try {
      process.exitCode = undefined;
      const result = await runEvalCli({
        name: "quiet",
        cases: [{ id: "case", input: "y", expected: "x" }],
        target: (input) => input,
        metrics: [exactMatch()],
        format: "quiet",
        output: { stdout: (value) => (output += value) },
      });

      expect(result.cases.failed).toBe(1);
      expect(output).toBe("");
      expect(process.exitCode).toBeUndefined();
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("formats results without writing and supports truncation and redaction", async () => {
    const result = await runEvalSuite({
      name: "safe-output",
      cases: [{ id: "secret", input: "private input", expected: "private output" }],
      target: () => "private output with extra text",
      metrics: [exactMatch()],
    });

    const pretty = formatEvalResult(result, { maxValueLength: 12 });
    const json = formatEvalResult(result, {
      format: "json",
      redact: (value, context) =>
        ["input", "score", "comment"].includes(context.kind) ? `[${context.kind}]` : value,
    });
    const parsed = JSON.parse(json);

    expect(pretty).toContain("private outp…");
    expect(json).not.toContain("private input");
    expect(parsed.results[0].case.input).toBe("[input]");
    expect(parsed.results[0].metrics[0].outcome).toMatchObject({
      score: "[score]",
      comment: "[comment]",
    });
    expect(parsed.results[0].scores.exact_match).toMatchObject({
      score: "[score]",
      comment: "[comment]",
    });
  });
});

function sampleResult() {
  return runEvalSuite({
    name: "sample",
    cases: [
      { id: "green", input: "a", expected: "a" },
      { id: "red", input: "b", expected: "a" },
    ],
    target: (input) => input,
    metrics: [exactMatch()],
  });
}
