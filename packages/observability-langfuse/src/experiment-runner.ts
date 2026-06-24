import type { JsonValue } from "@anvia/core/completion";
import type { EvalCaseResult, EvalSuiteResult, RunEvalSuiteOptions } from "@anvia/core/evals";
import { runEvalSuite } from "@anvia/core/evals";
import { createLangfuseDatasetClient } from "./dataset-client.js";
import type {
  LangfuseDatasetClient,
  LangfuseDatasetItem,
  LangfuseRunExperimentOptions,
  LangfuseRunExperimentResult,
  LangfuseTracing,
} from "./types.js";

export type RunEvalAsExperimentOptions<Input, Output, Expected = unknown> = Omit<
  LangfuseRunExperimentOptions<Input, Output, Expected>,
  "items" | "run"
> & {
  tracing: Pick<LangfuseTracing, "score">;
  client?: LangfuseDatasetClient;
  pageSize?: number | undefined;
  timeoutMs?: number | undefined;
};

export type RunEvalAsExperimentResult<Input, Output, Expected = unknown> = {
  suite: EvalSuiteResult<Input, Output, Expected>;
  datasetRun: LangfuseRunExperimentResult;
};

export async function runEvalAsExperiment<Input, Output, Expected = unknown>(
  evalOptions: RunEvalSuiteOptions<Input, Output, Expected>,
  experimentOptions: RunEvalAsExperimentOptions<Input, Output, Expected>,
): Promise<RunEvalAsExperimentResult<Input, Output, Expected>> {
  const client =
    experimentOptions.client ??
    createLangfuseDatasetClient(experimentOptions.tracing, {
      ...(experimentOptions.pageSize === undefined ? {} : { pageSize: experimentOptions.pageSize }),
      ...(experimentOptions.timeoutMs === undefined
        ? {}
        : { timeoutMs: experimentOptions.timeoutMs }),
    });

  const suite = await runEvalSuite(evalOptions);

  const items: LangfuseDatasetItem<Input, Expected>[] = evalOptions.cases.map((testCase) => {
    const item: LangfuseDatasetItem<Input, Expected> = {
      id: testCase.id,
      input: testCase.input,
    };
    if (testCase.expected !== undefined) {
      item.expected = testCase.expected;
    }
    if (testCase.metadata !== undefined) {
      item.metadata = testCase.metadata as Record<string, JsonValue | undefined>;
    }
    return item;
  });

  const datasetItemMap = new Map<string, EvalCaseResult<Input, Output, Expected>>();
  for (const result of suite.results) {
    datasetItemMap.set(result.case.id, result);
  }

  const datasetRun = await client.runExperiment<Input, Output, Expected>({
    datasetName: experimentOptions.datasetName,
    runName: experimentOptions.runName,
    ...(experimentOptions.description === undefined
      ? {}
      : { description: experimentOptions.description }),
    ...(experimentOptions.metadata === undefined ? {} : { metadata: experimentOptions.metadata }),
    items,
    run: (item) => {
      const result = datasetItemMap.get(item.id);
      if (result === undefined) {
        return {
          output: undefined as Output,
          trace: undefined,
        };
      }
      const output = (result.output ?? undefined) as Output;
      const trace = readTraceFromOutput(result.output);
      return { output, trace };
    },
  });

  return { suite, datasetRun };
}

function readTraceFromOutput(
  output: unknown,
): { traceId: string; observationId?: string | undefined } | undefined {
  if (typeof output !== "object" || output === null || !("trace" in output)) {
    return undefined;
  }
  const trace = (output as { trace?: unknown }).trace;
  if (typeof trace !== "object" || trace === null) {
    return undefined;
  }
  const traceId = (trace as { traceId?: unknown }).traceId;
  if (typeof traceId !== "string") {
    return undefined;
  }
  const observationId = (trace as { observationId?: unknown }).observationId;
  if (typeof observationId === "string") {
    return { traceId, observationId };
  }
  return { traceId };
}
