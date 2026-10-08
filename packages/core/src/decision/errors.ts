import type { DecisionQuestionType } from "./types";

/** A provider declined one or more questions; no complete decision result is available. */
export class DecisionRefusalError extends Error {
  readonly provider: string;
  readonly modelId: string;
  readonly questionNames: readonly string[];
  readonly rawResponse: unknown;

  constructor(options: {
    provider: string;
    modelId: string;
    questionNames: readonly string[];
    rawResponse: unknown;
  }) {
    super(`${options.provider}/${options.modelId} refused one or more decision questions.`);
    this.name = "DecisionRefusalError";
    this.provider = options.provider;
    this.modelId = options.modelId;
    this.questionNames = Object.freeze([...options.questionNames]);
    this.rawResponse = options.rawResponse;
  }
}

export class DecisionCapabilityError extends Error {
  readonly provider: string;
  readonly modelId: string;
  readonly questionType: DecisionQuestionType;

  constructor(options: { provider: string; modelId: string; questionType: DecisionQuestionType }) {
    super(
      `${options.provider}/${options.modelId} does not support ${options.questionType} questions.`,
    );
    this.name = "DecisionCapabilityError";
    this.provider = options.provider;
    this.modelId = options.modelId;
    this.questionType = options.questionType;
  }
}

export class DecisionProviderOutputError extends Error {
  readonly provider: string;
  readonly modelId: string;
  readonly questionName: string | undefined;

  constructor(
    message: string,
    options: {
      provider: string;
      modelId: string;
      questionName?: string | undefined;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DecisionProviderOutputError";
    this.provider = options.provider;
    this.modelId = options.modelId;
    this.questionName = options.questionName;
  }
}
