import type { JsonValue } from "@anvia/core/completion";
import type { EvalCaseResult, EvalSuiteResult, RunEvalSuiteOptions } from "@anvia/core/evals";
import { runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "./eval-reporter.js";
import type {
  LangfuseDatasetClient,
  LangfuseDatasetClientOptions,
  LangfuseDatasetItem,
  LangfuseEvalReporterOptions,
  LangfuseRunExperimentOptions,
  LangfuseRunExperimentResult,
  LangfuseScorer,
} from "./types.js";

export type LangfuseEvalExperimentOptions<Input, Output, Expected = unknown> = {
  suite: RunEvalSuiteOptions<Input, Output, Expected>;
  experiment: Omit<LangfuseRunExperimentOptions<Input, Output, Expected>, "items" | "run"> & {
    pageSize?: number | undefined;
    timeoutMs?: number | undefined;
    publishScores?: boolean | undefined;
    reporterOptions?: LangfuseEvalReporterOptions | undefined;
    includeContexts?: boolean | undefined;
  };
};

export type LangfuseEvalExperimentResult<Input, Output, Expected = unknown> = {
  suite: EvalSuiteResult<Input, Output, Expected>;
  datasetRun: LangfuseRunExperimentResult;
};

export async function runLangfuseEvalExperiment<Input, Output, Expected = unknown>(
  client: LangfuseScorer & {
    datasetClient(options?: LangfuseDatasetClientOptions): LangfuseDatasetClient;
  },
  options: LangfuseEvalExperimentOptions<Input, Output, Expected>,
): Promise<LangfuseEvalExperimentResult<Input, Output, Expected>> {
  const evalOptions = options.suite;
  const experimentOptions = options.experiment;
  const clientOptions: LangfuseDatasetClientOptions = {};
  if (experimentOptions.pageSize !== undefined) clientOptions.pageSize = experimentOptions.pageSize;
  if (experimentOptions.timeoutMs !== undefined)
    clientOptions.timeoutMs = experimentOptions.timeoutMs;
  const datasetClient = client.datasetClient(clientOptions);

  const suiteOptions: RunEvalSuiteOptions<Input, Output, Expected> =
    experimentOptions.publishScores === true
      ? {
          ...evalOptions,
          reporters: [
            ...(evalOptions.reporters ?? []),
            createLangfuseEvalReporter<Input, Output, Expected>(
              client,
              experimentOptions.reporterOptions,
            ),
          ],
        }
      : evalOptions;
  const suite = await runEvalSuite(suiteOptions);

  const items: LangfuseDatasetItem<Input, Expected>[] = evalOptions.cases.map((testCase) => {
    const item: LangfuseDatasetItem<Input, Expected> = {
      id: testCase.id,
      input: testCase.input,
    };
    if (testCase.expected !== undefined) {
      item.expected = testCase.expected;
    }
    const metadata: Record<string, JsonValue | undefined> = {
      ...testCase.metadata,
    };
    if (experimentOptions.includeContexts === true && testCase.context !== undefined) {
      metadata.context = [...testCase.context];
    }
    if (experimentOptions.includeContexts === true && testCase.retrievalContext !== undefined) {
      metadata.retrievalContext = [...testCase.retrievalContext];
    }
    if (Object.keys(metadata).length > 0) {
      item.metadata = metadata;
    }
    return item;
  });

  const datasetItemMap = new Map<string, EvalCaseResult<Input, Output, Expected>>();
  for (const result of suite.results) {
    datasetItemMap.set(result.case.id, result);
  }

  const runOptions: LangfuseRunExperimentOptions<Input, Output, Expected> = {
    datasetName: experimentOptions.datasetName,
    runName: experimentOptions.runName,
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
  };
  if (experimentOptions.description !== undefined) {
    runOptions.description = experimentOptions.description;
  }
  if (experimentOptions.metadata !== undefined) runOptions.metadata = experimentOptions.metadata;
  const datasetRun = await datasetClient.runExperiment<Input, Output, Expected>(runOptions);

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
