import { throwIfAborted } from "../internal/abort";
import { mapWithConcurrency } from "../internal/concurrency";
import { resolveRetryOptions, runWithRetries } from "../retry";
import { assertResult } from "./result";
import type {
  DecideBatchOptions,
  DecideOptions,
  DecisionBatchItem,
  DecisionBatchResult,
  DecisionModel,
  DecisionQuestions,
  DecisionRawResponseOf,
  DecisionRequest,
  DecisionResult,
} from "./types";
import { assertRequest } from "./validation";

export async function decide<
  const Questions extends DecisionQuestions,
  Model extends DecisionModel,
>(
  options: DecideOptions<Questions, Model>,
): Promise<DecisionResult<Questions, DecisionRawResponseOf<Model>>> {
  throwIfAborted(options.abortSignal);
  const request: DecisionRequest<Questions> = {
    state: options.state,
    questions: options.questions,
    providerOptions: options.providerOptions,
  };
  assertRequest(request, options.model);
  const retries =
    options.retries === undefined || options.retries === false
      ? undefined
      : resolveRetryOptions(options.retries);
  return runWithRetries(
    async () => {
      throwIfAborted(options.abortSignal);
      let result;
      try {
        result = await options.model.decision(request, { abortSignal: options.abortSignal });
      } catch (error) {
        throwIfAborted(options.abortSignal);
        throw error;
      }
      throwIfAborted(options.abortSignal);
      assertResult(result, request, options.model);
      return result as DecisionResult<Questions, DecisionRawResponseOf<Model>>;
    },
    retries,
    { streaming: false, abortSignal: options.abortSignal },
  );
}

/** Execute independent inputs with bounded concurrency, preserving order and individual failures. */
export async function decideBatch<
  const Questions extends DecisionQuestions,
  Model extends DecisionModel,
>(
  options: DecideBatchOptions<Questions, Model>,
): Promise<DecisionBatchResult<Questions, DecisionRawResponseOf<Model>>> {
  throwIfAborted(options.abortSignal);
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency <= 0) {
    throw new RangeError("concurrency must be a positive safe integer.");
  }
  const inputs = Array.from(options.inputs);
  const items = await mapWithConcurrency(
    inputs.map((input, index) => ({ input, index })),
    options.concurrency,
    async ({
      input,
      index,
    }): Promise<DecisionBatchItem<Questions, DecisionRawResponseOf<Model>>> => {
      throwIfAborted(options.abortSignal);
      try {
        const result = await decide({
          ...input,
          model: options.model,
          retries: options.retries,
          abortSignal: options.abortSignal,
        });
        return { index, status: "completed", result };
      } catch (error) {
        throwIfAborted(options.abortSignal);
        return { index, status: "failed", error };
      }
    },
  );
  throwIfAborted(options.abortSignal);
  return { items };
}
