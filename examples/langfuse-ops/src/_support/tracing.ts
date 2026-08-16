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
  return new LangfuseClient({
    publicKey: env.publicKey,
    secretKey: env.secretKey,
    baseUrl: env.baseUrl,
    environment: env.environment,
    release: env.release,
    serviceName: options.name ?? env.serviceName ?? "langfuse-ops",
    ...(hasScoreOptions
      ? {
          scores: {
            ...(options.scoreBatchSize !== undefined ? { batchSize: options.scoreBatchSize } : {}),
            ...(options.scoreFlushIntervalMs !== undefined
              ? { flushIntervalMs: options.scoreFlushIntervalMs }
              : {}),
            ...(options.scoreMaxAttempts !== undefined
              ? { retries: { maxAttempts: options.scoreMaxAttempts } }
              : {}),
          },
        }
      : {}),
  });
}

// Re-exported for convenience so demo scripts only need one import path.
export type { LangfuseScoreArgs };
