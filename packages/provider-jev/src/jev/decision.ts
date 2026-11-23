import type {
  DecisionCapabilities,
  DecisionModel,
  DecisionQuestions,
  DecisionRequest,
  DecisionResult,
  ModelCallOptions,
} from "@anvia/core/decision";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { compileJevQuestions, toEntry } from "./decision-request";
import { mapJevDecisionResponse } from "./decision-response";
import { normalizeJevError } from "./errors";
import type { JevDecisionModelId } from "./models";

export class JevDecisionModel implements DecisionModel<unknown> {
  readonly provider = "jev";
  readonly capabilities: DecisionCapabilities = Object.freeze({
    questionSupport: Object.freeze({
      choice: "native",
      "multi-label": "composed",
      score: "native",
      check: "native",
    }),
    mixedQuestions: true,
    limits: Object.freeze({ maxChoiceOptions: 255, maxRubricLevels: 10 }),
  });

  constructor(
    private readonly sdk: TypeSafeClient,
    readonly modelId: JevDecisionModelId,
  ) {}

  async decision<const Questions extends DecisionQuestions>(
    request: DecisionRequest<Questions>,
    options?: ModelCallOptions,
  ): Promise<DecisionResult<Questions, unknown>> {
    const { compiled, wireQuestions } = compileJevQuestions(request.questions);

    let rawResponse: unknown;
    try {
      const body = {
        ...request.providerOptions,
        state: toEntry(request.state) ?? { value: null },
        model: this.modelId,
        questions: Object.fromEntries(wireQuestions),
      };
      const requestOptions: NonNullable<Parameters<TypeSafeClient["systemOne"]>[1]> = {
        retry: { maxRetries: 0 },
      };

      if (options?.abortSignal !== undefined) {
        requestOptions.signal = options.abortSignal;
      }

      rawResponse = await this.sdk.systemOne(body, requestOptions);
    } catch (error) {
      throw normalizeJevError(error, options?.abortSignal);
    }

    return mapJevDecisionResponse<Questions>(
      rawResponse,
      compiled,
      wireQuestions.map(([key]) => key),
      this.modelId,
    );
  }
}
