import type { JsonValue } from "@anvia/core/completion";
import type { AgentObserver } from "@anvia/core/observability";

export type LangfuseTracingOptions = {
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  baseUrl?: string | undefined;
  environment?: string | undefined;
  release?: string | undefined;
};

export type LangfuseScoreArgs = {
  traceId?: string | undefined;
  observationId?: string | undefined;
  name: string;
  value: number;
  comment?: string | undefined;
  metadata?: Record<string, JsonValue | undefined> | undefined;
};

export type LangfuseTracing = AgentObserver & {
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  score(args: LangfuseScoreArgs): Promise<void>;
};

export type LangfuseEvalReporterOptions = {
  publishInvalid?: boolean | undefined;
  strict?: boolean | undefined;
};
