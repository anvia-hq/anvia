import type { JsonValue } from "@anvia/core/completion";
import type { EvalReporter } from "@anvia/core/evals";

export type LensCaptureMode = "safe" | "full";

export type LensRedactorPattern = {
  name: string;
  regex: RegExp;
};

export type LensRedactionOptions = {
  patterns?: LensRedactorPattern[] | undefined;
  replacement?: string | undefined;
};

export type LensClientOptions = {
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
  optional?: boolean | undefined;
};

export type LensObserverOptions = Pick<
  LensClientOptions,
  "captureMode" | "captureMaxBytes" | "redactInputs" | "redactOutputs" | "redaction"
>;

export type LensEvalReporterOptions = {
  traceObserver?: string | undefined;
  publishInvalid?: boolean | undefined;
  includeMetadata?: boolean | undefined;
  includePayloads?: boolean | undefined;
  onMissingTrace?: "emit" | "ignore" | "warn" | "throw" | undefined;
};

export type LensEvalReporter<Input = unknown, Output = unknown, Expected = unknown> = EvalReporter<
  Input,
  Output,
  Expected
>;

export type LensDatasetClientOptions = {
  baseUrl?: string | undefined;
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  pageSize?: number | undefined;
  timeoutMs?: number | undefined;
};

export type LensDatasetGetOptions = {
  name: string;
  version?: string | undefined;
};

export type LensDatasetItem<Input = unknown, Expected = unknown> = {
  id: string;
  input: Input;
  expected?: Expected | undefined;
  context?: string[] | undefined;
  retrievalContext?: string[] | undefined;
  metadata?: Record<string, JsonValue | undefined> | undefined;
};

export type LensDataset<Input = unknown, Expected = unknown> = {
  name: string;
  version: string;
  description?: string | undefined;
  metadata?: Record<string, JsonValue | undefined> | undefined;
  items: LensDatasetItem<Input, Expected>[];
};

export type LensDatasetClient = {
  getDataset<Input = unknown, Expected = unknown>(
    options: LensDatasetGetOptions,
  ): Promise<LensDataset<Input, Expected>>;
};
