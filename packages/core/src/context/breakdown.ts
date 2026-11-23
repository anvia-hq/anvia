import type { CompletionRequest, Document, ProviderTool } from "../completion/types";

/** What a piece of the input context is: the parts of a request that spend input tokens. */
export type ContextSegmentId =
  | "instructions"
  | "messages"
  | "toolResults"
  | "documents"
  | "tools"
  | "mcpTools"
  | "providerTools"
  | "outputSchema";

/** Order segments are reported in, from the prompt outward. */
const SEGMENT_ORDER: readonly ContextSegmentId[] = [
  "instructions",
  "messages",
  "toolResults",
  "documents",
  "tools",
  "mcpTools",
  "providerTools",
  "outputSchema",
];

/** One bucket of a context breakdown. */
export type ContextSegment = Readonly<{
  id: ContextSegmentId;
  /** Estimated input tokens for this bucket. */
  tokens: number;
  /** Serialized characters counted for this bucket, after any media bounding. */
  characters: number;
  /** Contributions counted: messages, tool results, documents, tools, or schemas. */
  items: number;
}>;

/**
 * How a request's input tokens are spent.
 *
 * Segments are local estimates; `reportedInputTokens` records the provider's own input token
 * count when it is known, and `estimatedTokens` then equals it.
 */
export type ContextBreakdown = Readonly<{
  segments: readonly ContextSegment[];
  estimatedTokens: number;
  reportedInputTokens?: number;
}>;

/** The request fields that consume input tokens. */
export type ContextBreakdownSource = Pick<
  CompletionRequest,
  "instructions" | "chatHistory" | "documents" | "tools" | "providerTools" | "outputSchema"
>;

export type ContextBreakdownOptions = {
  /** Names of tool definitions served by MCP servers, reported as their own segment. */
  mcpToolNames?: Iterable<string> | undefined;
  /** Counts tokens for serialized content; defaults to a provider-neutral estimate. */
  tokenCounter?: ((value: string) => number) | undefined;
};

/**
 * Characters an inline base64 image or file payload counts for, however large its data.
 * Providers bill media by pixels or duration, not by payload bytes.
 */
const MEDIA_PAYLOAD_ESTIMATE_CHARACTERS = 8_000;

/** Replaces inline base64 media with a bounded placeholder so it is not counted as text. */
function boundInlineMedia(this: unknown, key: string, value: unknown): unknown {
  const parent = this as { type?: unknown } | null;
  return key === "data" && typeof value === "string" && parent?.type === "data"
    ? "x".repeat(Math.min(value.length, MEDIA_PAYLOAD_ESTIMATE_CHARACTERS))
    : value;
}

/** Serializes a request value the way it is measured, bounding inline media payloads. */
function serializedContent(value: unknown): string {
  return JSON.stringify(value, boundInlineMedia) ?? "";
}

/**
 * Lightweight provider-neutral token estimate: about four characters per token, with inline
 * media bounded before counting. Supply `tokenCounter` for model-specific counts.
 */
export function estimateContextTextTokens(value: string): number {
  return value.length === 0 ? 0 : Math.ceil(value.length / 4);
}

/**
 * Splits a request into the buckets that spend input tokens: instructions, conversation
 * messages, tool results, retrieved documents, tool definitions (MCP tools separately),
 * provider tools, and the output schema.
 */
export function estimateContextBreakdown(
  source: ContextBreakdownSource,
  options: ContextBreakdownOptions = {},
): ContextBreakdown {
  const counter = options.tokenCounter ?? estimateContextTextTokens;
  const mcpToolNames = new Set(options.mcpToolNames ?? []);
  const buckets = new Map<ContextSegmentId, string[]>();
  const add = (id: ContextSegmentId, content: string): void => {
    const parts = buckets.get(id);

    if (parts === undefined) buckets.set(id, [content]);
    else parts.push(content);
  };

  if (source.instructions !== undefined && source.instructions.length > 0) {
    add("instructions", source.instructions);
  }

  for (const message of source.chatHistory) {
    add(
      message.role === "tool" ? "toolResults" : "messages",
      serializedContent({ role: message.role, content: message.content }),
    );
  }

  for (const document of source.documents) {
    add("documents", documentContent(document));
  }

  for (const tool of source.tools) {
    add(mcpToolNames.has(tool.name) ? "mcpTools" : "tools", serializedContent(tool));
  }

  for (const tool of source.providerTools ?? []) {
    add("providerTools", providerToolContent(tool));
  }

  if (source.outputSchema !== undefined) {
    add("outputSchema", serializedContent(source.outputSchema));
  }

  const segments: ContextSegment[] = [];
  for (const id of SEGMENT_ORDER) {
    const parts = buckets.get(id);

    if (parts === undefined || parts.length === 0) continue;

    const content = parts.join("");
    segments.push({
      id,
      tokens: counter(content),
      characters: content.length,
      items: parts.length,
    });
  }
  return { segments, estimatedTokens: segments.reduce((total, part) => total + part.tokens, 0) };
}

function documentContent(document: Document): string {
  return serializedContent({
    id: document.id,
    text: document.text,
    additionalProps: document.additionalProps,
  });
}

function providerToolContent(tool: ProviderTool): string {
  return serializedContent({
    provider: tool.provider,
    name: tool.name,
    configuration: tool.configuration,
  });
}

/**
 * Rescales a breakdown so its segments add up to the provider's reported input tokens. The split
 * stays local (proportional), the total becomes provider truth.
 */
export function scaleContextBreakdown(
  breakdown: ContextBreakdown,
  reportedInputTokens: number,
): ContextBreakdown {
  if (
    !Number.isFinite(reportedInputTokens) ||
    reportedInputTokens <= 0 ||
    breakdown.estimatedTokens <= 0
  ) {
    return breakdown;
  }

  const exactTotal = Math.trunc(reportedInputTokens);
  const ratio = exactTotal / breakdown.estimatedTokens;
  const scaled = breakdown.segments.map((segment) => segment.tokens * ratio);
  const tokens = scaled.map((value) => Math.floor(value));
  let remaining = exactTotal - tokens.reduce((total, value) => total + value, 0);
  const byLargestRemainder = scaled
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const entry of byLargestRemainder) {
    if (remaining <= 0) break;

    const current = tokens[entry.index];

    if (current === undefined) continue;

    tokens[entry.index] = current + 1;
    remaining -= 1;
  }
  return {
    segments: breakdown.segments.map((segment, index) => ({
      ...segment,
      tokens: tokens[index] ?? segment.tokens,
    })),
    estimatedTokens: exactTotal,
    reportedInputTokens: exactTotal,
  };
}
