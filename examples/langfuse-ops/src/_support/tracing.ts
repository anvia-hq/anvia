import type { LangfuseRedactionOptions, LangfuseScoreArgs, LangfuseTracing } from "@anvia/langfuse";
import { langfuse } from "@anvia/langfuse";
import { getLangfuseEnv } from "./env.js";

export type CreateTracingOptions = {
  name?: string;
  redactInputs?: boolean;
  redactOutputs?: boolean | "deep";
  redaction?: LangfuseRedactionOptions;
  scoreBatchSize?: number;
  scoreFlushIntervalMs?: number;
  scoreMaxRetries?: number;
};

export function createTracing(options: CreateTracingOptions = {}): LangfuseTracing {
  const env = getLangfuseEnv();
  return langfuse.create({
    publicKey: env.publicKey,
    secretKey: env.secretKey,
    baseUrl: env.baseUrl,
    environment: env.environment,
    release: env.release,
    serviceName: options.name ?? env.serviceName ?? "langfuse-ops",
    ...(options.redactInputs !== undefined ? { redactInputs: options.redactInputs } : {}),
    ...(options.redactOutputs !== undefined ? { redactOutputs: options.redactOutputs } : {}),
    ...(options.redaction !== undefined ? { redaction: options.redaction } : {}),
    ...(options.scoreBatchSize !== undefined ? { scoreBatchSize: options.scoreBatchSize } : {}),
    ...(options.scoreFlushIntervalMs !== undefined
      ? { scoreFlushIntervalMs: options.scoreFlushIntervalMs }
      : {}),
    ...(options.scoreMaxRetries !== undefined ? { scoreMaxRetries: options.scoreMaxRetries } : {}),
  });
}

// Re-exported for convenience so demo scripts only need one import path.
export type { LangfuseScoreArgs };
