import type { DecisionQuestionType } from "./types";

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
