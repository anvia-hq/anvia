import type { JsonValue } from "@anvia/core/completion";
import type { AgentObserver } from "@anvia/core/observability";

export type LangfuseRedactionMode = boolean | "deep";

export type LangfuseRedactionOptions = {
  patterns?: RedactorPattern[];
  replacement?: string;
};

export type RedactorPattern = {
  name: string;
  regex: RegExp;
};

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
  redactInputs?: LangfuseRedactionMode | undefined;
  redactOutputs?: LangfuseRedactionMode | undefined;
  redaction?: LangfuseRedactionOptions | undefined;
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
  onMissingTrace?: "ignore" | "warn" | "throw" | undefined;
  truncateInputAt?: number | undefined;
  includeMessages?: boolean | undefined;
};

export type LangfuseDatasetClientOptions = {
  baseUrl?: string | undefined;
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  pageSize?: number | undefined;
  timeoutMs?: number | undefined;
};

export type LangfuseDatasetItem<Input = unknown, Expected = unknown> = {
  id: string;
  input: Input;
  expected?: Expected | undefined;
  metadata?: Record<string, JsonValue | undefined> | undefined;
};

export type LangfuseDataset<Input = unknown, Expected = unknown> = {
  name: string;
  description?: string | undefined;
  metadata?: Record<string, JsonValue | undefined> | undefined;
  items: LangfuseDatasetItem<Input, Expected>[];
};

export type LangfuseRunItemResult<Output = unknown> = {
  output: Output;
  trace?: { traceId: string; observationId?: string | undefined } | undefined;
};

export type LangfuseRunItemError = {
  itemId: string;
  error: unknown;
};

export type LangfuseRunExperimentOptions<Input = unknown, Output = unknown, Expected = unknown> = {
  datasetName: string;
  runName: string;
  description?: string | undefined;
  metadata?: Record<string, JsonValue | undefined> | undefined;
  items?: LangfuseDatasetItem<Input, Expected>[] | undefined;
  run: (
    item: LangfuseDatasetItem<Input, Expected>,
  ) => LangfuseRunItemResult<Output> | Promise<LangfuseRunItemResult<Output>>;
};

export type LangfuseRunExperimentResult = {
  runName: string;
  datasetName: string;
  posted: number;
  errors: LangfuseRunItemError[];
};

export type LangfuseDatasetClient = {
  createDataset(dataset: {
    name: string;
    description?: string | undefined;
    metadata?: Record<string, JsonValue | undefined> | undefined;
  }): Promise<LangfuseDataset<unknown, unknown>>;
  getDataset<Input, Expected>(name: string): Promise<LangfuseDataset<Input, Expected>>;
  upsertItems<Input, Expected>(
    name: string,
    items: LangfuseDatasetItem<Input, Expected>[],
  ): Promise<void>;
  runExperiment<Input, Output, Expected>(
    options: LangfuseRunExperimentOptions<Input, Output, Expected>,
  ): Promise<LangfuseRunExperimentResult>;
};

export type LangfusePromptClientOptions = {
  baseUrl?: string | undefined;
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  cacheTtlMs?: number | undefined;
  timeoutMs?: number | undefined;
};

export type LangfusePromptGetOptions = {
  version?: number | undefined;
  label?: string | undefined;
  cacheTtlMs?: number | undefined;
  refresh?: boolean | undefined;
};

export type LangfuseChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type LangfusePrompt = {
  name: string;
  version: number;
  labels: string[];
  prompt: string | LangfuseChatMessage[];
  type: "text" | "chat";
  tags?: string[];
  resolvedAt: Date;
};

export type LangfusePromptClient = {
  getPrompt(name: string, options?: LangfusePromptGetOptions): Promise<LangfusePrompt>;
  getPromptText(name: string, options?: LangfusePromptGetOptions): Promise<string>;
  getPromptChat(name: string, options?: LangfusePromptGetOptions): Promise<LangfuseChatMessage[]>;
  refresh(): void;
};
