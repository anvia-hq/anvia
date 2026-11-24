import type { CompletionRequest, Document, ProviderTool } from "../completion/types";

/** What a piece of the input context is: the parts of a request that spend input tokens. */
export type ContextSegmentId =
  | "instructions"
  | "skills"
  | "messages"
  | "toolResults"
  | "documents"
  | "tools"
  | "mcpTools"
  | "providerTools"
  | "outputSchema";

/** Order segments are reported in, from the prompt outward. */
export const CONTEXT_SEGMENT_IDS: readonly ContextSegmentId[] = Object.freeze([
  "instructions",
  "skills",
  "messages",
  "toolResults",
  "documents",
  "tools",
  "mcpTools",
  "providerTools",
  "outputSchema",
]);

const CONTEXT_SEGMENT_ID_SET: ReadonlySet<string> = new Set(CONTEXT_SEGMENT_IDS);

/** One bucket of a context breakdown. */
export type ContextSegment = Readonly<{
  id: ContextSegmentId;
  /** Estimated input tokens for this bucket. */
  tokens: number;
  /** Serialized characters counted for this bucket, after any media bounding. */
  characters: number;
  /** Contributions counted: messages, tool results, documents, tools, skills, or schemas. */
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
  /**
   * Skill catalog instructions appended to `source.instructions`, attributed to the `skills`
   * segment when present in `source.instructions`.
   */
  skillInstructions?: string | undefined;
  /**
   * Names of skill tools (such as `get_skill_instructions` and `get_skill_reference`).
   * Their tool definitions and tool result messages are attributed to the `skills` segment.
   */
  skillToolNames?: Iterable<string> | undefined;
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

/** Runtime type guard for a {@link ContextBreakdown} payload. */
export function isContextBreakdown(value: unknown): value is ContextBreakdown {
  if (!isPlainRecord(value)) return false;

  for (const key of Object.keys(value)) {
    if (key !== "segments" && key !== "estimatedTokens" && key !== "reportedInputTokens") {
      return false;
    }
  }

  if (
    !Array.isArray(value.segments) ||
    !isNonnegativeFiniteNumber(value.estimatedTokens) ||
    (value.reportedInputTokens !== undefined &&
      !isNonnegativeFiniteNumber(value.reportedInputTokens))
  ) {
    return false;
  }

  const seen = new Set<string>();
  for (const segment of value.segments) {
    if (!isContextSegment(segment) || seen.has(segment.id)) return false;

    seen.add(segment.id);
  }
  return true;
}

function isContextSegment(value: unknown): value is ContextSegment {
  if (!isPlainRecord(value)) return false;

  for (const key of Object.keys(value)) {
    if (key !== "id" && key !== "tokens" && key !== "characters" && key !== "items") {
      return false;
    }
  }

  return (
    typeof value.id === "string" &&
    CONTEXT_SEGMENT_ID_SET.has(value.id) &&
    isNonnegativeFiniteNumber(value.tokens) &&
    isNonnegativeFiniteNumber(value.characters) &&
    Number.isSafeInteger(value.characters) &&
    isNonnegativeFiniteNumber(value.items) &&
    Number.isSafeInteger(value.items)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonnegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Splits a request into the buckets that spend input tokens: instructions, skills (catalog
 * instructions, skill tool definitions, and loaded skill tool results), conversation messages,
 * tool results, retrieved documents, tool definitions (MCP tools separately), provider tools,
 * and the output schema.
 */
export function estimateContextBreakdown(
  source: ContextBreakdownSource,
  options: ContextBreakdownOptions = {},
): ContextBreakdown {
  const counter = options.tokenCounter ?? estimateContextTextTokens;
  const mcpToolNames = new Set(options.mcpToolNames ?? []);
  const skillToolNames = new Set(
    [...(options.skillToolNames ?? [])].filter((name) => !mcpToolNames.has(name)),
  );
  const buckets = new Map<ContextSegmentId, string[]>();
  const add = (id: ContextSegmentId, content: string): void => {
    const parts = buckets.get(id);

    if (parts === undefined) buckets.set(id, [content]);
    else parts.push(content);
  };

  if (source.instructions !== undefined && source.instructions.length > 0) {
    const split = splitInstructions(source.instructions, options.skillInstructions);

    if (split.base !== undefined) add("instructions", split.base);

    if (split.skills !== undefined) add("skills", split.skills);
  }

  for (const message of source.chatHistory) {
    if (message.role !== "tool") {
      add("messages", serializedContent({ role: message.role, content: message.content }));
      continue;
    }

    if (skillToolNames.size === 0 || !Array.isArray(message.content)) {
      add("toolResults", serializedContent({ role: message.role, content: message.content }));
      continue;
    }

    const skillParts: unknown[] = [];
    const otherParts: unknown[] = [];
    for (const part of message.content) {
      if (isSkillToolResultPart(part, skillToolNames)) skillParts.push(part);
      else otherParts.push(part);
    }

    if (skillParts.length === 0) {
      add("toolResults", serializedContent({ role: message.role, content: message.content }));
    } else if (otherParts.length === 0) {
      add("skills", serializedContent({ role: message.role, content: message.content }));
    } else {
      add("skills", serializedContent({ role: message.role, content: skillParts }));
      add("toolResults", serializedContent({ role: message.role, content: otherParts }));
    }
  }

  for (const document of source.documents) {
    add("documents", documentContent(document));
  }

  for (const tool of source.tools) {
    let segment: ContextSegmentId = "tools";

    if (mcpToolNames.has(tool.name)) segment = "mcpTools";
    else if (skillToolNames.has(tool.name)) segment = "skills";

    add(segment, serializedContent(tool));
  }

  for (const tool of source.providerTools ?? []) {
    add("providerTools", providerToolContent(tool));
  }

  if (source.outputSchema !== undefined) {
    add("outputSchema", serializedContent(source.outputSchema));
  }

  const segments: ContextSegment[] = [];
  for (const id of CONTEXT_SEGMENT_IDS) {
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

function splitInstructions(
  instructions: string,
  skillInstructions: string | undefined,
): { base?: string; skills?: string } {
  if (skillInstructions === undefined || skillInstructions.length === 0) {
    return { base: instructions };
  }

  const index = instructions.lastIndexOf(skillInstructions);

  if (index === -1) {
    return { base: instructions };
  }

  const before = instructions.slice(0, index).replace(/\n+$/, "");
  const after = instructions.slice(index + skillInstructions.length).replace(/^\n+/, "");
  const remainder =
    before.length > 0 && after.length > 0 ? `${before}\n\n${after}` : `${before}${after}`;
  return remainder.trim().length === 0
    ? { skills: skillInstructions }
    : { base: remainder, skills: skillInstructions };
}

function isSkillToolResultPart(part: unknown, skillToolNames: ReadonlySet<string>): boolean {
  return (
    isPlainRecord(part) &&
    part.type === "tool-result" &&
    typeof part.toolName === "string" &&
    skillToolNames.has(part.toolName)
  );
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
