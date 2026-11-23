import type { JsonObject } from "@anvia/core/completion";
import {
  type AnyEvalMetric,
  type EvalCaseResult,
  type EvalMetric,
  type EvalSuiteResult,
  resolveEvalTraceRef,
  type RunEvalSuiteOptions,
  runEvalSuite,
} from "@anvia/core/evals";
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

export type LangfuseEvalExperimentOptions<
  Input,
  Output,
  Expected = unknown,
  Metrics extends readonly EvalMetric<
    NoInfer<Input>,
    NoInfer<Output>,
    unknown,
    NoInfer<Expected>,
    string
  >[] = readonly EvalMetric<NoInfer<Input>, NoInfer<Output>, unknown, NoInfer<Expected>, string>[],
> = {
  suite: RunEvalSuiteOptions<Input, Output, Expected, Metrics>;
  experiment: Omit<LangfuseRunExperimentOptions<Input, Output, Expected>, "items" | "run"> & {
    pageSize?: number | undefined;
    timeoutMs?: number | undefined;
    publishScores?: boolean | undefined;
    reporterOptions?: LangfuseEvalReporterOptions | undefined;
    includeContexts?: boolean | undefined;
  };
};

export type LangfuseEvalExperimentResult<
  Input,
  Output,
  Expected = unknown,
  Metrics extends readonly AnyEvalMetric[] = readonly AnyEvalMetric[],
> = {
  suite: EvalSuiteResult<Input, Output, Expected, Metrics>;
  datasetRun: LangfuseRunExperimentResult;
};

export async function runLangfuseEvalExperiment<
  Input,
  Output,
  Expected = unknown,
  const Metrics extends readonly EvalMetric<
    NoInfer<Input>,
    NoInfer<Output>,
    unknown,
    NoInfer<Expected>,
    string
  >[] = readonly EvalMetric<NoInfer<Input>, NoInfer<Output>, unknown, NoInfer<Expected>, string>[],
>(
  client: LangfuseScorer & {
    datasetClient(options?: LangfuseDatasetClientOptions): LangfuseDatasetClient;
  },
  options: LangfuseEvalExperimentOptions<Input, Output, Expected, Metrics>,
): Promise<LangfuseEvalExperimentResult<Input, Output, Expected, Metrics>> {
  const evalOptions = options.suite;
  const experimentOptions = options.experiment;
  const clientOptions: LangfuseDatasetClientOptions = {};

  if (experimentOptions.pageSize !== undefined) clientOptions.pageSize = experimentOptions.pageSize;

  if (experimentOptions.timeoutMs !== undefined)
    clientOptions.timeoutMs = experimentOptions.timeoutMs;

  const datasetClient = client.datasetClient(clientOptions);

  const suiteOptions: RunEvalSuiteOptions<Input, Output, Expected, Metrics> =
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

  const items: LangfuseDatasetItem<Input, Expected>[] = suite.results.map(({ case: testCase }) => {
    const item: LangfuseDatasetItem<Input, Expected> = {
      id: testCase.id,
      input: testCase.input,
    };

    if (testCase.expected !== undefined) {
      item.expected = testCase.expected;
    }

    if (testCase.tags !== undefined && testCase.tags.length > 0) {
      item.tags = [...testCase.tags];
    }

    const metadata: JsonObject = {
      ...testCase.metadata,
    };

    if (testCase.tags !== undefined && testCase.tags.length > 0) {
      metadata.tags = [...testCase.tags];
    }

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

  const datasetItemMap = new Map<string, EvalCaseResult<Input, Output, Expected, Metrics>>();
  for (const result of suite.results) {
    datasetItemMap.set(result.case.id, result);
  }

  const runOptions: LangfuseRunExperimentOptions<Input, Output, Expected> = {
    datasetName: experimentOptions.datasetName,
    runName: experimentOptions.runName,
    items,
    run: async (item) => {
      const result = datasetItemMap.get(item.id);

      if (result === undefined) {
        return {
          output: undefined as Output,
          trace: undefined,
        };
      }

      const output = (result.output ?? undefined) as Output;
      const trace = await resolveExperimentTrace(evalOptions, result);
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

async function resolveExperimentTrace<
  Input,
  Output,
  Expected,
  Metrics extends readonly AnyEvalMetric[],
>(
  evalOptions: RunEvalSuiteOptions<Input, Output, Expected>,
  result: EvalCaseResult<Input, Output, Expected, Metrics>,
): Promise<{ traceId: string; observationId?: string | undefined } | undefined> {
  const trace =
    evalOptions.trace !== undefined
      ? await evalOptions.trace({
          suiteName: evalOptions.name,
          case: result.case,
          output: result.output,
          targetError: result.targetError,
          targetStatus: result.targetStatus,
        })
      : resolveEvalTraceRef({
          output: result.output,
          input: result.case.input,
          metadata: result.case.metadata,
        });

  if (trace === undefined) return undefined;

  if (trace.observationId !== undefined) {
    return { traceId: trace.traceId, observationId: trace.observationId };
  }

  return { traceId: trace.traceId };
}
