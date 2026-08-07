import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AgentEvalTargetOptions,
  answerRelevancy,
  type CompletionModel,
  contains,
  defineEvalCases,
  defineEvalSuite,
  type EvalCasesForMetrics,
  EvalOutcome,
  type EvalReporter,
  exactMatch,
  faithfulness,
  hallucination,
  runEvalSuite,
  selectPromptOutput,
} from "./helpers/imports";

type PromptResult = {
  output: string;
};

describe("eval type safety", () => {
  it("preserves case ids, target output, metric names, and score types", async () => {
    const model = null as unknown as CompletionModel;
    const cases = defineEvalCases([
      {
        id: "refund",
        input: "When?" as string,
        expected: "Within 30 days" as string,
      },
    ]);
    const suite = defineEvalSuite({
      name: "typed suite",
      cases,
      target: (input): PromptResult => {
        expectTypeOf(input).toEqualTypeOf<string>();
        return { output: input };
      },
      metrics: [
        exactMatch({ name: "correct", actual: selectPromptOutput }),
        answerRelevancy({ name: "relevant", model }),
      ] as const,
    });

    expectTypeOf(cases[0].id).toEqualTypeOf<"refund">();
    expectTypeOf(suite.target).returns.toEqualTypeOf<PromptResult | Promise<PromptResult>>();

    const result = await runEvalSuite(suite);
    const caseResult = result.results[0];
    expect(caseResult).toBeDefined();
    if (caseResult === undefined) throw new Error("Expected an eval case result.");
    expectTypeOf(caseResult.scores.correct).toEqualTypeOf<
      ReturnType<typeof EvalOutcome.pass<boolean>>
    >();
    expectTypeOf(caseResult.scores.relevant).toEqualTypeOf<
      ReturnType<typeof EvalOutcome.pass<number>>
    >();
    expect(caseResult.scores.correct.outcome).toBe("fail");
  });

  it("binds custom metric input, output, and expected types once", () => {
    const typedSuite = defineEvalSuite<string, PromptResult, string>();
    const noLeak = typedSuite.defineMetric({
      name: "no_secret_leak",
      dataType: "BOOLEAN",
      evaluate: ({ output, case: testCase }) =>
        output.output.includes(testCase.expected ?? "")
          ? EvalOutcome.fail(false)
          : EvalOutcome.pass(true),
    });

    expectTypeOf(noLeak.name).toEqualTypeOf<"no_secret_leak">();
    expectTypeOf(noLeak.evaluate).returns.toEqualTypeOf<
      | ReturnType<typeof EvalOutcome.pass<boolean>>
      | Promise<ReturnType<typeof EvalOutcome.pass<boolean>>>
    >();

    typedSuite.defineMetric({
      name: "wrong_score",
      // @ts-expect-error BOOLEAN metrics must produce boolean scores.
      dataType: "BOOLEAN",
      evaluate: () => EvalOutcome.pass("good"),
    });
  });

  it("requires case expectations only when a metric reads them implicitly", () => {
    const casesWithoutExpected = defineEvalCases([{ id: "refund", input: "When?" }]);
    const implicitContains = contains();
    expectTypeOf(implicitContains.caseRequirements).toEqualTypeOf<
      { expected: string | RegExp } | undefined
    >();
    type RequiredCases = EvalCasesForMetrics<
      typeof casesWithoutExpected,
      readonly [typeof implicitContains]
    >;
    // @ts-expect-error the mapped case type requires expected.
    const requiredCases: RequiredCases = casesWithoutExpected;
    expect(requiredCases).toBe(casesWithoutExpected);

    defineEvalSuite({
      name: "missing expected",
      // @ts-expect-error contains() reads case.expected when expected is not configured.
      cases: casesWithoutExpected,
      target: (input) => input,
      metrics: [implicitContains],
    });

    defineEvalSuite({
      name: "configured expected",
      cases: casesWithoutExpected,
      target: (input) => input,
      metrics: [contains({ expected: "30 days" })],
    });
  });

  it("preserves Expected in agent target callbacks", () => {
    const options: AgentEvalTargetOptions<string, string, { answer: string }> = {
      output: (_response, testCase) => {
        expectTypeOf(testCase.expected).toEqualTypeOf<{ answer: string } | undefined>();
        return testCase.expected?.answer ?? "";
      },
    };

    expect(options.output).toBeTypeOf("function");
  });

  it("requires implicit context fields while allowing explicit selectors", () => {
    const model = null as unknown as CompletionModel;
    const cases = defineEvalCases([{ id: "grounding", input: "What is covered?" }]);

    defineEvalSuite({
      name: "missing contexts",
      // @ts-expect-error implicit hallucination and faithfulness inputs require both context fields.
      cases,
      target: () => "Coverage lasts 30 days.",
      metrics: [hallucination({ model }), faithfulness({ model })],
    });

    defineEvalSuite({
      name: "explicit contexts",
      cases,
      target: () => "Coverage lasts 30 days.",
      metrics: [
        hallucination({ model, context: ["Coverage lasts 30 days."] }),
        faithfulness({ model, retrievalContext: ["Coverage lasts 30 days."] }),
      ],
    });
  });

  it("accepts infrastructure reporters without suite-specific wrappers", () => {
    const reporter: EvalReporter = {
      report: () => undefined,
    };
    const suite = defineEvalSuite({
      name: "reporter suite",
      cases: [{ id: "case", input: "hello", expected: "hello" }],
      target: (input) => input,
      metrics: [exactMatch()],
      reporters: [reporter],
    });

    expect(suite.reporters).toEqual([reporter]);
  });
});
