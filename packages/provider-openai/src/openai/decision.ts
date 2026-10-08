import type {
  DecisionCapabilities,
  DecisionModel,
  DecisionQuestions,
  DecisionRequest,
  DecisionResult,
  ModelCallOptions,
} from "@anvia/core/decision";
import type OpenAI from "openai";
import { normalizeDecisionError } from "./decision-errors";
import { MAX_WIRE_QUESTIONS, compileDecisionQuestions, decisionText } from "./decision-request";
import { mapDecisionResponse } from "./decision-response";
import type { OpenAIDecisionModelId } from "./models";

export class OpenAIDecisionModel implements DecisionModel<unknown> {
  readonly provider = "OpenAI";
  readonly capabilities: DecisionCapabilities = Object.freeze({
    questionSupport: Object.freeze({
      choice: "native",
      "multi-label": "composed",
      score: "native",
      check: "native",
    }),
    mixedQuestions: true,
    limits: Object.freeze({
      maxQuestionsPerRequest: MAX_WIRE_QUESTIONS,
      maxChoiceOptions: 255,
      maxRubricLevels: 10,
    }),
  });

  constructor(
    private readonly sdk: OpenAI,
    readonly modelId: OpenAIDecisionModelId,
  ) {}

  async decision<const Questions extends DecisionQuestions>(
    request: DecisionRequest<Questions>,
    options?: ModelCallOptions,
  ): Promise<DecisionResult<Questions, unknown>> {
    const { compiled, wireQuestions } = compileDecisionQuestions(request.questions);
    let rawResponse: unknown;
    try {
      rawResponse = await this.sdk.decisions.create(
        {
          ...request.providerOptions,
          model: this.modelId,
          input: decisionText(request.state),
          questions: wireQuestions,
        },
        { signal: options?.abortSignal, maxRetries: 0 },
      );
    } catch (error) {
      throw normalizeDecisionError(error, this.modelId, options?.abortSignal);
    }
    return mapDecisionResponse<Questions>(rawResponse, compiled, this.modelId);
  }
}
