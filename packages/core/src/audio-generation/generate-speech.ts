import type { JsonValue } from "../completion/types";
import { type RetryOptions, resolveRetryOptions, runWithRetries } from "../retry";
import type { AudioGenerationModel, AudioGenerationRequest } from "./types";

export type GenerateSpeechOptions<Model extends AudioGenerationModel = AudioGenerationModel> = {
  model: Model;
  voice: string;
  speed?: number | undefined;
  additionalParams?: JsonValue | undefined;
  retries?: RetryOptions | undefined;
};

export function generateSpeech<Model extends AudioGenerationModel>(
  text: string,
  options: GenerateSpeechOptions<Model>,
): Promise<Awaited<ReturnType<Model["audioGeneration"]>>> {
  assertNonEmptyString(text, "Speech text");
  assertNonEmptyString(options.voice, "Speech voice");
  const speed = options.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError("Speech speed must be a positive finite number.");
  }

  const request: AudioGenerationRequest = { text, voice: options.voice, speed };
  if (options.additionalParams !== undefined) {
    request.additionalParams = options.additionalParams;
  }
  const retries = options.retries === undefined ? undefined : resolveRetryOptions(options.retries);
  return runWithRetries<Awaited<ReturnType<Model["audioGeneration"]>>>(
    () =>
      options.model.audioGeneration(request) as Promise<
        Awaited<ReturnType<Model["audioGeneration"]>>
      >,
    retries,
    { streaming: false },
  );
}

function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}
