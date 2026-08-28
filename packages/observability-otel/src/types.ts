import type { Tracer } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import type { JsonValue } from "@anvia/core/completion";

export type OtelObserverOptions = {
  tracer?: Tracer | undefined;
  tracerName?: string | undefined;
  tracerVersion?: string | undefined;
  serviceName?: string | undefined;
  captureMode?: "safe" | "full" | undefined;
  captureMaxBytes?: number | undefined;
  transformInput?: ((value: unknown) => unknown) | undefined;
  transformOutput?: ((value: unknown) => unknown) | undefined;
};

export type OtelPipelineObserverOptions = OtelObserverOptions;

export type OtelEvalReporterOptions = {
  traceObserver?: string | undefined;
  logger?: Logger | undefined;
  loggerName?: string | undefined;
  loggerVersion?: string | undefined;
  publishInvalid?: boolean | undefined;
  includeMetadata?: boolean | undefined;
  includePayloads?: boolean | undefined;
  captureMaxBytes?: number | undefined;
  transformInput?: ((value: unknown) => unknown) | undefined;
  transformOutput?: ((value: unknown) => unknown) | undefined;
  onMissingTrace?: "emit" | "ignore" | "warn" | "throw" | undefined;
};

export type OtelScoreDataType = "NUMERIC" | "CATEGORICAL" | "BOOLEAN";
export type OtelScoreOutcome = "pass" | "fail" | "invalid" | "unknown";
export type OtelScoreSource = "telemetry" | "end_user";

export type OtelScoreArgs = {
  id?: string | undefined;
  traceId: string;
  observationId?: string | undefined;
  responseId?: string | undefined;
  name: string;
  value: number | string;
  dataType?: OtelScoreDataType | undefined;
  outcome?: OtelScoreOutcome | undefined;
  label?: string | undefined;
  source?: OtelScoreSource | undefined;
  suiteName?: string | undefined;
  comment?: string | undefined;
  metadata?: Record<string, JsonValue | undefined> | undefined;
  configId?: string | undefined;
};

export type OtelScorerOptions = {
  logger?: Logger | undefined;
  loggerName?: string | undefined;
  loggerVersion?: string | undefined;
};

export type OtelScorer = {
  score(args: OtelScoreArgs): void;
};
