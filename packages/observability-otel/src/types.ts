import type { AgentObserver } from "@anvia/core/observability";
import type { Tracer } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";

export type OtelTracingOptions = {
  tracer?: Tracer | undefined;
  tracerName?: string | undefined;
  tracerVersion?: string | undefined;
  serviceName?: string | undefined;
  captureMode?: "safe" | "full" | undefined;
  captureMaxBytes?: number | undefined;
  transformInput?: ((value: unknown) => unknown) | undefined;
  transformOutput?: ((value: unknown) => unknown) | undefined;
};

export type OtelTracing = AgentObserver;

export type OtelEvalReporterOptions = {
  logger?: Logger | undefined;
  loggerName?: string | undefined;
  loggerVersion?: string | undefined;
  publishInvalid?: boolean | undefined;
  includeMetadata?: boolean | undefined;
  onMissingTrace?: "emit" | "ignore" | "warn" | "throw" | undefined;
};
