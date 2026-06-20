import type { AgentObserver } from "@anvia/core/observability";
import type { Tracer } from "@opentelemetry/api";

export type OtelTracingOptions = {
  tracer?: Tracer | undefined;
  tracerName?: string | undefined;
  tracerVersion?: string | undefined;
  serviceName?: string | undefined;
};

export type OtelTracing = AgentObserver;
