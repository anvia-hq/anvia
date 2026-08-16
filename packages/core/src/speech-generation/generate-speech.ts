import type { JsonObject } from "../completion/types";
import { throwIfAborted } from "../internal/abort";
import type { ModelCallOptions } from "../model-call-options";
import {
  type ResolvedRetryOptions,
  type RetrySetting,
  resolveRetryOptions,
  runWithRetries,
} from "../retry";
import type {
  SpeechGenerationModel,
  SpeechGenerationRequest,
  SpeechGenerationResult,
} from "./types";

export type GenerateSpeechOptions<Model extends SpeechGenerationModel = SpeechGenerationModel> = {
  model: Model;
  text: string;
  voice: string;
  speed?: number | undefined;
  providerOptions?: JsonObject | undefined;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
};

type RawResponseOf<Model> =
  Model extends SpeechGenerationModel<infer RawResponse> ? RawResponse : unknown;

export async function generateSpeech<Model extends SpeechGenerationModel>(
  options: GenerateSpeechOptions<Model>,
): Promise<SpeechGenerationResult<RawResponseOf<Model>>> {
  assertNonEmptyString(options.text, "Speech text");
  assertNonEmptyString(options.voice, "Speech voice");
  throwIfAborted(options.abortSignal);
  const speed = options.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError("Speech speed must be a positive finite number.");
  }

  const request: SpeechGenerationRequest = { text: options.text, voice: options.voice, speed };
  if (options.providerOptions !== undefined) request.providerOptions = options.providerOptions;
  return runWithRetries(
    () => {
      throwIfAborted(options.abortSignal);
      return options.model.speechGeneration(
        request,
        modelCallOptions(options.abortSignal),
      ) as Promise<SpeechGenerationResult<RawResponseOf<Model>>>;
    },
    resolveRetries(options.retries),
    { streaming: false, abortSignal: options.abortSignal },
  );
}

function resolveRetries(setting: RetrySetting | undefined): ResolvedRetryOptions | undefined {
  return setting === undefined || setting === false ? undefined : resolveRetryOptions(setting);
}

function modelCallOptions(abortSignal: AbortSignal | undefined): ModelCallOptions | undefined {
  return abortSignal === undefined ? undefined : { abortSignal };
}

function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}
