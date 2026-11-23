import {
  type AssistantContentPart,
  type CompletionFinishReason,
  CompletionProviderOutputError,
  type CompletionResponse,
  type CompletionSource,
  type JsonValue,
  type ProviderToolCall,
  type ReasoningDetail,
  type ReasoningPart,
  type ToolCallPart,
  type Usage,
} from "@anvia/core/completion";
import {
  compactJsonObject,
  isNonblankString,
  isPlainObject,
  numberFrom,
  parseToolArguments,
  stringFrom,
} from "@anvia/core/internal/provider";
import { normalizeOpenAIUsage } from "./usage";

const PROVIDER_TOOL_OUTPUT_TYPES = new Set([
  "web_search_call",
  "x_search_call",
  "code_interpreter_call",
  "file_search_call",
  "mcp_call",
]);

export function fromOpenAIResponse(response: unknown): CompletionResponse {
  if (!isPlainObject(response)) throw invalidToolCallError();

  const raw = response;
  const usage = usageFromOpenAIResponse(raw.usage);
  const errorUsage = isPlainObject(raw.usage) ? usage : undefined;

  if (raw.output !== undefined && !Array.isArray(raw.output)) {
    throw invalidOpenAIResponse(errorUsage);
  }

  const output = raw.output ?? [];

  if (output.some((item) => !isPlainObject(item))) {
    throw invalidOpenAIResponse(errorUsage);
  }

  const choice: AssistantContentPart[] = [];
  const providerToolCalls: ProviderToolCall[] = [];
  const hasFunctionCalls = output.some(
    (item) => isPlainObject(item) && item.type === "function_call",
  );
  assertOpenAIResponseStatus(raw.status, hasFunctionCalls, errorUsage);
  const result: CompletionResponse = {
    choice,
    usage,
    rawResponse: response,
  };
  applyOpenAIResponseFinishReason(result, raw, hasFunctionCalls);
  assertSafeOpenAIResponseToolFinishReason(result, hasFunctionCalls, errorUsage);

  for (const item of output) {
    if (!isPlainObject(item)) {
      continue;
    }

    if (item.type === "message") {
      choice.push(...messageOutputToAssistantContent(item));
    }

    if (item.type === "function_call") {
      const { id, callId } = openAIFunctionCallIdentity(item, errorUsage);
      assertCompletedFunctionCallStatus(item.status, id, errorUsage);
      const name = requiredToolCallString(item.name, id, errorUsage);
      const toolCall: ToolCallPart = {
        type: "tool-call",
        toolCallId: id,
        toolName: name,
        input: parseTerminalToolArguments(id, item.arguments, errorUsage),
        callId,
      };
      choice.push(toolCall);
    }

    if (item.type === "reasoning") {
      choice.push(reasoningItemToAssistantContent(item));
    }

    const providerToolCall = providerToolCallFromOutputItem(item);

    if (providerToolCall !== undefined) {
      providerToolCalls.push(providerToolCall);
    }
  }

  const sources = sourcesFromOpenAIResponse(raw, output);

  if (typeof raw.id === "string") {
    result.messageId = raw.id;
  }

  if (sources.length > 0) {
    result.sources = sources;
  }

  if (providerToolCalls.length > 0) {
    result.providerToolCalls = providerToolCalls;
  }

  return result;
}

export function assertSafeOpenAIResponseToolFinishReason(
  response: CompletionResponse,
  hasToolCalls: boolean,
  usage: Usage | undefined,
): void {
  if (!hasToolCalls) return;

  if (response.finishReason === undefined) {
    throw new CompletionProviderOutputError({ kind: "incomplete-tool-call", usage });
  }

  if (response.finishReason === "length") {
    throw new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason: response.finishReason,
      usage,
    });
  }

  if (response.finishReason === "content-filter") {
    throw new CompletionProviderOutputError({
      kind: "filtered-tool-call",
      finishReason: response.finishReason,
      usage,
    });
  }

  if (response.finishReason === "other") {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      finishReason: response.finishReason,
      usage,
    });
  }
}

export function requiredToolCallString(
  value: unknown,
  toolCallId?: unknown,
  usage?: Usage,
): string {
  if (!isNonblankString(value)) throw invalidToolCallError(toolCallId, usage);

  return value;
}

export function openAIFunctionCallIdentity(
  item: Record<string, unknown>,
  usage?: Usage,
): Readonly<{ id: string; callId: string }> {
  const callId = requiredToolCallString(item.call_id, item.id, usage);
  const id = item.id === undefined ? callId : requiredToolCallString(item.id, callId, usage);
  return { id, callId };
}

export function assertCompletedFunctionCallStatus(
  value: unknown,
  toolCallId: string,
  usage?: Usage,
): void {
  if (value === undefined || value === "completed") return;

  if (value === "in_progress" || value === "incomplete") {
    throw new CompletionProviderOutputError({
      kind: "incomplete-tool-call",
      toolCallId,
      usage,
    });
  }

  throw invalidToolCallError(toolCallId, usage);
}

export function requiredTerminalArguments(
  toolCallId: string,
  value: unknown,
  usage?: Usage,
): string {
  if (typeof value !== "string") {
    throw new CompletionProviderOutputError({
      kind: value === undefined ? "incomplete-tool-call" : "invalid-tool-arguments",
      toolCallId,
      usage,
    });
  }

  return value;
}

export function parseTerminalToolArguments(
  toolCallId: string,
  value: unknown,
  usage?: Usage,
): JsonValue {
  return parseToolArguments(toolCallId, requiredTerminalArguments(toolCallId, value, usage), usage);
}

export function invalidToolCallError(
  toolCallId?: unknown,
  usage?: Usage,
): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-call",
    toolCallId: isNonblankString(toolCallId) ? toolCallId : undefined,
    usage,
  });
}

export function invalidToolArgumentsError(
  toolCallId: string,
  usage?: Usage,
): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-arguments",
    toolCallId,
    usage,
  });
}

export function usageFromOpenAIResponse(usage: unknown): Usage {
  const usageSource = isPlainObject(usage) ? usage : {};
  const inputTokens = numberFrom(usageSource.input_tokens);
  const outputTokens = numberFrom(usageSource.output_tokens);
  const inputDetails = isPlainObject(usageSource.input_tokens_details)
    ? usageSource.input_tokens_details
    : {};
  const outputDetails = isPlainObject(usageSource.output_tokens_details)
    ? usageSource.output_tokens_details
    : {};
  return normalizeOpenAIUsage({
    inputTokens,
    outputTokens,
    cachedInputTokens: numberFrom(inputDetails.cached_tokens),
    reasoningOutputTokens: numberFrom(outputDetails.reasoning_tokens),
  });
}

export function providerToolCallFromOutputItem(
  item: Record<string, unknown>,
): ProviderToolCall | undefined {
  if (typeof item.type !== "string" || !PROVIDER_TOOL_OUTPUT_TYPES.has(item.type)) {
    return undefined;
  }

  const toolCall: ProviderToolCall = {
    id: requiredToolCallString(item.id),
    name: item.type.replace(/_call$/, ""),
  };
  const status = stringFrom(item.status);

  if (status !== undefined) {
    toolCall.status = status;
  }

  const detailEntries = Object.entries(item).filter(
    ([key, value]) => key !== "id" && key !== "type" && key !== "status" && value !== undefined,
  );

  if (detailEntries.length > 0) {
    toolCall.details = compactJsonObject(Object.fromEntries(detailEntries));
  }

  return toolCall;
}

export function sourceFromAnnotation(
  annotation: Record<string, unknown>,
): CompletionSource | undefined {
  const url = stringFrom(annotation.url);

  if (url === undefined) {
    return undefined;
  }

  const source: CompletionSource = { type: "url", url };
  const title = stringFrom(annotation.title);

  if (title !== undefined) source.title = title;

  const id = stringFrom(annotation.id);

  if (id !== undefined) source.id = id;

  const startIndex = numberFromOptional(annotation.start_index ?? annotation.startIndex);

  if (startIndex !== undefined) source.startIndex = startIndex;

  const endIndex = numberFromOptional(annotation.end_index ?? annotation.endIndex);

  if (endIndex !== undefined) source.endIndex = endIndex;

  return source;
}

function applyOpenAIResponseFinishReason(
  response: CompletionResponse,
  raw: Record<string, unknown>,
  hasToolCalls = response.choice.some((part) => part.type === "tool-call"),
): void {
  const status = stringFrom(raw.status);
  const incompleteDetails = isPlainObject(raw.incomplete_details) ? raw.incomplete_details : {};
  const incompleteReason = stringFrom(incompleteDetails.reason);
  let finishReason: CompletionFinishReason;

  if (status === "incomplete") {
    if (incompleteReason === "max_output_tokens") {
      finishReason = "length";
    } else if (incompleteReason === "content_filter") {
      finishReason = "content-filter";
    } else {
      finishReason = "other";
    }
  } else if (status === "completed") {
    finishReason = hasToolCalls ? "tool-calls" : "stop";
  } else if (status === undefined && !hasToolCalls) {
    return;
  } else {
    finishReason = "other";
  }

  response.finishReason = finishReason;
  const providerFinishReason = incompleteReason ?? status;

  if (providerFinishReason !== undefined) {
    response.providerFinishReason = providerFinishReason;
  }
}

function assertOpenAIResponseStatus(
  value: unknown,
  hasFunctionCalls: boolean,
  usage?: Usage,
): void {
  if (value === undefined || value === "completed" || value === "incomplete") return;

  if (hasFunctionCalls) return;

  throw invalidOpenAIResponse(usage);
}

function invalidOpenAIResponse(usage?: Usage): CompletionProviderOutputError {
  return new CompletionProviderOutputError({ kind: "invalid-response", usage });
}

function reasoningItemToAssistantContent(item: Record<string, unknown>): ReasoningPart {
  const content = reasoningContentFromOpenAIItem(item);
  const id = stringFrom(item.id);
  const text = content
    .flatMap((detail) => (detail.type === "text" || detail.type === "summary" ? [detail.text] : []))
    .join("");
  let reasoning: ReasoningPart = {
    type: "reasoning",
    text,
  };

  if (id !== undefined) reasoning = { ...reasoning, id };

  if (content.length > 0) reasoning = { ...reasoning, details: content };

  return reasoning;
}

function reasoningContentFromOpenAIItem(item: Record<string, unknown>): ReasoningDetail[] {
  const content: ReasoningDetail[] = [];

  if (Array.isArray(item.content)) {
    for (const part of item.content) {
      if (!isPlainObject(part)) {
        continue;
      }

      if (part.type === "reasoning_text" && typeof part.text === "string") {
        content.push({ type: "text", text: part.text });
      }
    }
  }

  if (Array.isArray(item.summary)) {
    for (const summary of item.summary) {
      if (!isPlainObject(summary)) {
        continue;
      }

      if (typeof summary.text === "string") {
        content.push({ type: "summary", text: summary.text });
      }
    }
  }

  if (typeof item.encrypted_content === "string") {
    content.push({ type: "encrypted", data: item.encrypted_content });
  }

  return content;
}

function messageOutputToAssistantContent(item: Record<string, unknown>): AssistantContentPart[] {
  const content = Array.isArray(item.content) ? item.content : [];
  return content.flatMap((part): AssistantContentPart[] => {
    if (!isPlainObject(part)) {
      return [];
    }

    if (part.type === "output_text" && typeof part.text === "string") {
      return [{ type: "text", text: part.text }];
    }

    if (part.type === "text" && typeof part.text === "string") {
      return [{ type: "text", text: part.text }];
    }

    if (part.type === "refusal" && typeof part.refusal === "string") {
      return [{ type: "text", text: part.refusal }];
    }

    return [];
  });
}

function sourcesFromOpenAIResponse(
  response: Record<string, unknown>,
  output: unknown[],
): CompletionSource[] {
  const sources: CompletionSource[] = [];

  if (Array.isArray(response.citations)) {
    for (const citation of response.citations) {
      if (typeof citation === "string") {
        sources.push({ type: "url", url: citation });
      } else if (isPlainObject(citation)) {
        const source = sourceFromAnnotation(citation);

        if (source !== undefined) {
          sources.push(source);
        }
      }
    }
  }

  for (const item of output) {
    if (!isPlainObject(item) || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (!isPlainObject(content) || !Array.isArray(content.annotations)) {
        continue;
      }

      for (const annotation of content.annotations) {
        if (!isPlainObject(annotation)) {
          continue;
        }

        const source = sourceFromAnnotation(annotation);

        if (source !== undefined) {
          sources.push(source);
        }
      }
    }
  }
  return dedupeSources(sources);
}

function numberFromOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dedupeSources(sources: CompletionSource[]): CompletionSource[] {
  const urlsWithStructuredSources = new Set(
    sources.flatMap((source) =>
      source.title !== undefined ||
      source.id !== undefined ||
      source.startIndex !== undefined ||
      source.endIndex !== undefined
        ? [source.url]
        : [],
    ),
  );
  const seen = new Set<string>();
  return sources.filter((source) => {
    const isBare =
      source.title === undefined &&
      source.id === undefined &&
      source.startIndex === undefined &&
      source.endIndex === undefined;

    if (isBare && urlsWithStructuredSources.has(source.url)) {
      return false;
    }

    const key = `${source.url}\u0000${source.startIndex ?? ""}\u0000${source.endIndex ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
