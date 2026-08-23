import { LangfuseClient, type LangfuseScoreArgs } from "@anvia/langfuse";
import { getLangfuseEnv } from "./env.js";

export type CreateTracingOptions = {
  name?: string;
  scoreBatchSize?: number;
  scoreFlushIntervalMs?: number;
  scoreMaxAttempts?: number;
};

export function createTracing(options: CreateTracingOptions = {}): LangfuseClient {
  const env = getLangfuseEnv();
  const hasScoreOptions =
    options.scoreBatchSize !== undefined ||
    options.scoreFlushIntervalMs !== undefined ||
    options.scoreMaxAttempts !== undefined;
  const clientOptions: ConstructorParameters<typeof LangfuseClient>[0] = {
    publicKey: env.publicKey,
    secretKey: env.secretKey,
    baseUrl: env.baseUrl,
    environment: env.environment,
    release: env.release,
    serviceName: options.name ?? env.serviceName ?? "langfuse-ops",
  };
  if (hasScoreOptions) {
    const scores: NonNullable<(typeof clientOptions)["scores"]> = {};
    if (options.scoreBatchSize !== undefined) scores.batchSize = options.scoreBatchSize;
    if (options.scoreFlushIntervalMs !== undefined) {
      scores.flushIntervalMs = options.scoreFlushIntervalMs;
    }
    if (options.scoreMaxAttempts !== undefined) {
      scores.retries = { maxAttempts: options.scoreMaxAttempts };
    }
    clientOptions.scores = scores;
  }
  return new LangfuseClient(clientOptions);
}

// Re-exported for convenience so demo scripts only need one import path.
export type { LangfuseScoreArgs };
