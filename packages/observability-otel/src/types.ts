import type { Tracer } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";

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
