import type { JsonValue } from "@anvia/core/completion";
import type { AgentObserver } from "@anvia/core/observability";

export type LangfuseTracingOptions = {
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  baseUrl?: string | undefined;
  environment?: string | undefined;
  release?: string | undefined;
  serviceName?: string | undefined;
  timeoutMs?: number | undefined;
  scoreBatchSize?: number | undefined;
  scoreFlushIntervalMs?: number | undefined;
  scoreMaxRetries?: number | undefined;
};

export type LangfuseScoreDataType = "NUMERIC" | "CATEGORICAL" | "BOOLEAN";

export type LangfuseScoreArgs = {
  traceId?: string | undefined;
  observationId?: string | undefined;
  name: string;
  value: number | string;
  dataType?: LangfuseScoreDataType | undefined;
  comment?: string | undefined;
  metadata?: Record<string, JsonValue | undefined> | undefined;
  configId?: string | undefined;
  scoreConfigId?: string | undefined;
  environment?: string | undefined;
  timestamp?: Date | string | undefined;
};

export type LangfuseTraceHandle = {
  readonly traceId: string;
  readonly observationId: string;
  addAttributes(attributes: Record<string, JsonValue | undefined>): void;
  addEvent(name: string, attributes?: Record<string, JsonValue | undefined>): void;
};

export type LangfuseTracing = AgentObserver & {
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  score(args: LangfuseScoreArgs): Promise<void>;
  flushScores(): Promise<void>;
  scoreQueueDepth(): number;
  getCurrentTrace(): LangfuseTraceHandle | undefined;
};

export type LangfuseEvalReporterOptions = {
  publishInvalid?: boolean | undefined;
  strict?: boolean | undefined;
};
