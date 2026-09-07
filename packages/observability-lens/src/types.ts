import type { JsonValue } from "@anvia/core/completion";
import type { EvalReporter } from "@anvia/core/evals";
import type { OtelScoreArgs } from "@anvia/otel";

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

export type LensPipelineObserverOptions = LensObserverOptions;

export type LensScoreArgs = OtelScoreArgs;

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

export type LensPromptRef = {
  readonly name: string;
  readonly version: number;
};

export type LensPromptJson =
  | null
  | string
  | number
  | boolean
  | readonly LensPromptJson[]
  | { readonly [key: string]: LensPromptJson };

export type LensChatMessage = {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly name?: string;
};

type LensPromptSnapshot = LensPromptRef & {
  readonly ref: LensPromptRef;
  readonly config: { readonly [key: string]: LensPromptJson };
  readonly labels: readonly string[];
  readonly selector: { readonly label: string } | { readonly version: number };
  readonly variables: readonly string[];
};

export type LensTextPrompt = LensPromptSnapshot & {
  readonly type: "text";
  readonly template: string;
  readonly messages: null;
  readonly compile: (variables?: Readonly<Record<string, string>>) => string;
};

export type LensChatPrompt = LensPromptSnapshot & {
  readonly type: "chat";
  readonly template: null;
  readonly messages: readonly LensChatMessage[];
  readonly compile: (variables?: Readonly<Record<string, string>>) => LensChatMessage[];
};

export type LensPrompt = LensTextPrompt | LensChatPrompt;

export type LensPromptClientOptions = {
  baseUrl?: string | undefined;
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  cacheTtlMs?: number | undefined;
  timeoutMs?: number | undefined;
};

export type LensPromptGetOptions = {
  name: string;
  cache?: "default" | "reload" | "no-store" | undefined;
  signal?: AbortSignal | undefined;
} & ({ label?: string | undefined; version?: never } | { label?: never; version: number });

export type LensPromptClient = {
  getPrompt(options: LensPromptGetOptions): Promise<LensPrompt>;
  clearCache(): void;
};
