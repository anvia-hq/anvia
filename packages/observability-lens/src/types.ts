import type { EvalReporter } from "@anvia/core/evals";
import type { AgentObserver } from "@anvia/core/observability";

export type LensCaptureMode = "safe" | "full";

export type LensRedactorPattern = {
  name: string;
  regex: RegExp;
};

export type LensRedactionOptions = {
  patterns?: LensRedactorPattern[] | undefined;
  replacement?: string | undefined;
};

export type LensTracingOptions = {
  baseUrl?: string | undefined;
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  serviceName?: string | undefined;
  environment?: string | undefined;
  release?: string | undefined;
  timeoutMs?: number | undefined;
  captureMode?: LensCaptureMode | undefined;
  captureMaxBytes?: number | undefined;
  redactInputs?: boolean | undefined;
  redactOutputs?: boolean | undefined;
  redaction?: LensRedactionOptions | undefined;
};

export type LensEvalReporterOptions = {
  publishInvalid?: boolean | undefined;
  includeMetadata?: boolean | undefined;
  onMissingTrace?: "emit" | "ignore" | "warn" | "throw" | undefined;
};

export type LensTracing = AgentObserver & {
  flush(): Promise<void>;
  shutdown(): Promise<void>;
};

export type LensEvalReporter<Input = unknown, Output = unknown, Expected = unknown> = EvalReporter<
  Input,
  Output,
  Expected
>;
