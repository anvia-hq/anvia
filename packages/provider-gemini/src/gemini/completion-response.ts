import {
  type AssistantContentPart,
  type CompletionFinishReason,
  CompletionProviderOutputError,
  type CompletionResponse,
  isJsonValue,
  type JsonObject,
  Usage,
} from "@anvia/core/completion";
import {
  isNonblankString,
  isPlainObject,
  numberFrom,
  stringFrom,
} from "@anvia/core/internal/provider";

type GeminiPart = Record<string, unknown>;

export type IndexedGeminiPart = Readonly<{
  index: number;
  part: GeminiPart;
}>;

export type GeminiFunctionCall = Readonly<{
  toolCallId: string;
  callId?: string | undefined;
  name: string;
  args: JsonObject;
  signature?: string | undefined;
  partIndex: number;
}>;

export function fromGeminiGenerateContentResponse(response: unknown): CompletionResponse {
  const raw = isPlainObject(response) ? response : {};
  const usage = usageFromGemini(raw.usageMetadata);
  const parts = candidateParts(raw, usage);
  const providerFinishReason = providerFinishReasonFromGeminiResponse(raw);
  const finishError = geminiToolFinishError(
    providerFinishReason,
    hasGeminiFunctionCallMarker(raw, parts),
    usage,
  );

  if (finishError !== undefined) throw finishError;

  const choice = assistantContentFromGeminiResponse(raw, usage);

  const result: CompletionResponse = {
    choice,
    usage,
    rawResponse: response,
  };
  applyGeminiFinishReason(result, raw);
  const id = stringFrom(raw.responseId) ?? stringFrom(raw.id);

  if (id !== undefined) {
    result.messageId = id;
  }

  assertSafeGeminiCompletionResponse(result);
  return result;
}

export function applyGeminiFinishReasonValue(
  response: CompletionResponse,
  value: string,
  hasStreamedToolCalls: boolean,
): void {
  response.finishReason = geminiFinishReason(
    value,
    hasStreamedToolCalls || response.choice.some((part) => part.type === "tool-call"),
  );
  response.providerFinishReason = value;
}

export function candidateParts(
  response: Record<string, unknown>,
  usage?: Usage,
): IndexedGeminiPart[] {
  const candidate = primaryGeminiCandidate(response);

  if (candidate === undefined || candidate.content === undefined) {
    return [];
  }

  if (!isPlainObject(candidate.content)) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call", usage });
  }

  if (candidate.content.parts === undefined) return [];

  if (!Array.isArray(candidate.content.parts)) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call", usage });
  }

  if (candidate.content.parts.some((part) => !isPlainObject(part))) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call", usage });
  }

  return candidate.content.parts.map((part, index) => ({
    index,
    part: part as Record<string, unknown>,
  }));
}

export function providerFinishReasonFromGeminiResponse(
  response: Record<string, unknown>,
): string | undefined {
  const candidateFinishReason = stringFrom(primaryGeminiCandidate(response)?.finishReason);

  if (candidateFinishReason !== undefined) return candidateFinishReason;

  const promptFeedback = response.promptFeedback ?? response.prompt_feedback;

  if (promptFeedback === undefined) return undefined;

  if (!isPlainObject(promptFeedback)) {
    throw new CompletionProviderOutputError({ kind: "invalid-response" });
  }

  const blockReason = promptFeedback.blockReason ?? promptFeedback.block_reason;

  if (blockReason === undefined) return undefined;

  if (typeof blockReason !== "string" || blockReason.length === 0) {
    throw new CompletionProviderOutputError({ kind: "invalid-response" });
  }

  return blockReason;
}

export function hasGeminiFunctionCallMarker(
  response: Record<string, unknown>,
  parts: readonly IndexedGeminiPart[],
): boolean {
  if (parts.some(({ part }) => ownDataProperty(part, "functionCall") !== undefined)) {
    return true;
  }

  if (hasGeminiCandidatePayload(response)) return false;

  const camelCaseCalls = ownDataProperty(response, "functionCalls");
  const snakeCaseCalls = ownDataProperty(response, "function_calls");
  return (
    (Array.isArray(camelCaseCalls) && camelCaseCalls.length > 0) ||
    (Array.isArray(snakeCaseCalls) && snakeCaseCalls.length > 0)
  );
}

export function textFromGeminiResponse(
  response: Record<string, unknown>,
  parts = candidateParts(response),
): string {
  if (parts.length > 0) {
    return parts
      .flatMap(({ part }) =>
        part.thought !== true && typeof part.text === "string" ? [part.text] : [],
      )
      .join("");
  }

  if (hasGeminiCandidatePayload(response)) {
    return "";
  }

  const directText = ownDataProperty(response, "text");
  return typeof directText === "string" ? directText : "";
}

export function functionCallsFromGeminiResponse(
  response: Record<string, unknown>,
  parts: IndexedGeminiPart[],
  usage: Usage,
): GeminiFunctionCall[] {
  if (parts.length > 0) {
    const calls = parts.flatMap(({ index, part }) => {
      if (part.functionCall === undefined) {
        return [];
      }

      if (!isPlainObject(part.functionCall)) {
        throw invalidGeminiToolCall(deterministicGeminiToolCallId(index), usage);
      }

      return [functionCallFromGeminiPart(part.functionCall, part, index, usage)];
    });
    assertDistinctGeminiFunctionCalls(calls, usage);
    return calls;
  }

  if (hasGeminiCandidatePayload(response)) {
    return [];
  }

  const camelCaseCalls = ownDataProperty(response, "functionCalls");
  const snakeCaseCalls = ownDataProperty(response, "function_calls");
  let directCalls: unknown[] = [];

  if (Array.isArray(camelCaseCalls)) {
    directCalls = camelCaseCalls;
  } else if (Array.isArray(snakeCaseCalls)) {
    directCalls = snakeCaseCalls;
  }

  const calls = directCalls.map((call, index) => {
    if (!isPlainObject(call)) {
      throw invalidGeminiToolCall(deterministicGeminiToolCallId(index), usage);
    }

    return functionCallFromGeminiPart(call, call, index, usage);
  });
  assertDistinctGeminiFunctionCalls(calls, usage);
  return calls;
}

export function toolCallFromGeminiFunctionCall(
  call: GeminiFunctionCall,
): Extract<AssistantContentPart, { type: "tool-call" }> {
  let toolCall: Extract<AssistantContentPart, { type: "tool-call" }> = {
    type: "tool-call",
    toolCallId: call.toolCallId,
    toolName: call.name,
    input: call.args,
  };

  if (call.callId !== undefined) toolCall = { ...toolCall, callId: call.callId };

  if (call.signature !== undefined) toolCall = { ...toolCall, signature: call.signature };

  return toolCall;
}

export function assertSafeGeminiToolFinishReason(value: string, usage: Usage): void {
  const error = geminiToolFinishError(value, true, usage);

  if (error !== undefined) throw error;
}

export function geminiToolFinishError(
  value: string | undefined,
  hasToolCalls: boolean,
  usage: Usage,
): CompletionProviderOutputError | undefined {
  if (value === "MALFORMED_FUNCTION_CALL") {
    return new CompletionProviderOutputError({ kind: "malformed-tool-arguments", usage });
  }

  if (value === "UNEXPECTED_TOOL_CALL" || value === "TOO_MANY_TOOL_CALLS") {
    return new CompletionProviderOutputError({ kind: "invalid-tool-call", usage });
  }

  if (!hasToolCalls) return undefined;

  if (value === undefined) {
    return new CompletionProviderOutputError({ kind: "incomplete-tool-call", usage });
  }

  const finishReason = geminiFinishReason(value, true);

  if (finishReason === "tool-calls") return undefined;

  if (finishReason === "length") {
    return new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason,
      usage,
    });
  }

  if (finishReason === "content-filter") {
    return new CompletionProviderOutputError({
      kind: "filtered-tool-call",
      finishReason,
      usage,
    });
  }

  return new CompletionProviderOutputError({ kind: "invalid-tool-call", finishReason, usage });
}

export function assertSafeGeminiCompletionResponse(response: CompletionResponse): void {
  const toolCalls = response.choice.filter(
    (part): part is Extract<AssistantContentPart, { type: "tool-call" }> =>
      part.type === "tool-call",
  );

  if (toolCalls.length > 0) {
    if (response.finishReason === undefined) {
      throw new CompletionProviderOutputError({
        kind: "incomplete-tool-call",
        usage: response.usage,
      });
    }

    assertNormalizedGeminiToolFinishReason(response.finishReason, response.usage);
  } else if (toolCalls.length === 0 && response.finishReason === "tool-calls") {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-call",
      finishReason: response.finishReason,
      usage: response.usage,
    });
  }

  const toolCallIds = new Set<string>();
  const callIds = new Set<string>();
  for (const toolCall of toolCalls) {
    if (toolCallIds.has(toolCall.toolCallId)) {
      throw invalidGeminiToolCall(toolCall.toolCallId, response.usage);
    }

    toolCallIds.add(toolCall.toolCallId);

    if (toolCall.callId !== undefined) {
      if (callIds.has(toolCall.callId)) {
        throw invalidGeminiToolCall(toolCall.toolCallId, response.usage);
      }

      callIds.add(toolCall.callId);
    }
  }
}

export function invalidGeminiToolCall(
  toolCallId: string,
  usage: Usage,
): CompletionProviderOutputError {
  return new CompletionProviderOutputError({ kind: "invalid-tool-call", toolCallId, usage });
}

export function invalidGeminiToolCallArguments(
  toolCallId: string,
  usage: Usage,
): CompletionProviderOutputError {
  return new CompletionProviderOutputError({
    kind: "invalid-tool-arguments",
    toolCallId,
    usage,
  });
}

export function usageFromGemini(usage: unknown): Usage {
  const raw = isPlainObject(usage) ? usage : {};
  const promptInputTokens = numberFrom(raw.promptTokenCount);
  const toolInputTokens = numberFrom(raw.toolUsePromptTokenCount);
  const inputTokens = promptInputTokens + toolInputTokens;
  const candidateOutputTokens = numberFrom(raw.candidatesTokenCount);
  const reasoningOutputTokens = numberFrom(raw.thoughtsTokenCount);
  const outputTokens = candidateOutputTokens + reasoningOutputTokens;
  const cachedInputTokens = Math.min(promptInputTokens, numberFrom(raw.cachedContentTokenCount));
  const totalTokens = inputTokens + outputTokens;
  return {
    ...Usage.empty(),
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    details: {
      input: promptInputTokens - cachedInputTokens,
      input_cached_tokens: cachedInputTokens,
      input_tool_use_tokens: toolInputTokens,
      output: candidateOutputTokens,
      output_reasoning_tokens: reasoningOutputTokens,
      total: totalTokens,
    },
  };
}

function applyGeminiFinishReason(
  response: CompletionResponse,
  raw: Record<string, unknown>,
  hasStreamedToolCalls = false,
): void {
  const value = providerFinishReasonFromGeminiResponse(raw);

  if (value === undefined) return;

  applyGeminiFinishReasonValue(response, value, hasStreamedToolCalls);
}

function geminiFinishReason(value: string, hasToolCalls: boolean): CompletionFinishReason {
  if (value === "MAX_TOKENS") return "length";

  if (
    value === "SAFETY" ||
    value === "RECITATION" ||
    value === "BLOCKLIST" ||
    value === "PROHIBITED_CONTENT" ||
    value === "SPII" ||
    value === "IMAGE_SAFETY" ||
    value === "IMAGE_PROHIBITED_CONTENT"
  ) {
    return "content-filter";
  }

  if (value === "STOP") {
    return hasToolCalls ? "tool-calls" : "stop";
  }

  return "other";
}

function assistantContentFromGeminiResponse(
  response: Record<string, unknown>,
  usage: Usage,
): AssistantContentPart[] {
  const parts = candidateParts(response, usage);
  const calls = functionCallsFromGeminiResponse(response, parts, usage);

  if (parts.length === 0) {
    const choice: AssistantContentPart[] = [];
    const text = textFromGeminiResponse(response, parts);

    if (text.length > 0) choice.push({ type: "text", text });

    choice.push(...calls.map(toolCallFromGeminiFunctionCall));
    return choice;
  }

  const callsByPartIndex = new Map(calls.map((call) => [call.partIndex, call]));
  const choice: AssistantContentPart[] = [];
  for (const { index, part } of parts) {
    if (typeof part.text === "string" && part.text.length > 0) {
      if (part.thought === true) {
        choice.push({
          type: "reasoning",
          text: part.text,
          details: [{ type: "summary", text: part.text }],
        });
      } else {
        const signature = thoughtSignatureFrom(part);
        let text: Extract<AssistantContentPart, { type: "text" }> = {
          type: "text",
          text: part.text,
        };

        if (signature !== undefined) text = { ...text, signature };

        choice.push(text);
      }
    }

    const call = callsByPartIndex.get(index);

    if (call !== undefined) {
      choice.push(toolCallFromGeminiFunctionCall(call));
    }
  }
  return choice;
}

function functionCallFromGeminiPart(
  call: Record<string, unknown>,
  part: Record<string, unknown>,
  partIndex: number,
  usage: Usage,
): GeminiFunctionCall {
  const fallbackId = deterministicGeminiToolCallId(partIndex);
  const rawCallId = call.id;
  const callId = isNonblankString(rawCallId) ? rawCallId : undefined;
  const toolCallId = callId ?? fallbackId;

  if (rawCallId !== undefined && callId === undefined) {
    throw invalidGeminiToolCall(toolCallId, usage);
  }

  if (
    call.partialArgs !== undefined ||
    call.partial_args !== undefined ||
    call.willContinue !== undefined ||
    call.will_continue !== undefined
  ) {
    throw new CompletionProviderOutputError({
      kind: "incomplete-tool-call",
      toolCallId,
      usage,
    });
  }

  const name = call.name;

  if (!isNonblankString(name)) {
    throw invalidGeminiToolCall(toolCallId, usage);
  }

  const args = call.args;

  if (!isPlainObject(args) || !isJsonValue(args)) {
    throw invalidGeminiToolCallArguments(toolCallId, usage);
  }

  const normalized: GeminiFunctionCall = {
    toolCallId,
    name,
    args,
    partIndex,
  };
  const signature = thoughtSignatureFrom(part) ?? thoughtSignatureFrom(call);

  if (callId !== undefined) {
    return signature === undefined
      ? { ...normalized, callId }
      : { ...normalized, callId, signature };
  }

  return signature === undefined ? normalized : { ...normalized, signature };
}

function primaryGeminiCandidate(
  response: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (response.candidates === undefined) return undefined;

  if (!Array.isArray(response.candidates)) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }

  const candidates = response.candidates;

  if (
    candidates.some(
      (candidate) =>
        !isPlainObject(candidate) ||
        (candidate.index !== undefined &&
          (!Number.isSafeInteger(candidate.index) || (candidate.index as number) < 0)),
    )
  ) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }

  const primaryCandidates = candidates.filter(
    (candidate): candidate is Record<string, unknown> =>
      isPlainObject(candidate) && candidate.index === 0,
  );

  if (primaryCandidates.length === 1) {
    return primaryCandidates[0];
  }

  if (primaryCandidates.length > 1) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }

  if (candidates.length === 0) return undefined;

  if (candidates.length !== 1) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }

  const candidate = candidates[0] as Record<string, unknown>;

  if (candidate.index !== undefined && candidate.index !== 0) {
    throw new CompletionProviderOutputError({ kind: "invalid-tool-call" });
  }

  return candidate;
}

function hasGeminiCandidatePayload(response: Record<string, unknown>): boolean {
  return Array.isArray(response.candidates) && response.candidates.length > 0;
}

function deterministicGeminiToolCallId(partIndex: number): string {
  return `gemini-tool-${partIndex.toString()}`;
}

function assertDistinctGeminiFunctionCalls(
  calls: readonly GeminiFunctionCall[],
  usage: Usage,
): void {
  const toolCallIds = new Set<string>();
  const callIds = new Set<string>();
  for (const call of calls) {
    if (toolCallIds.has(call.toolCallId)) {
      throw invalidGeminiToolCall(call.toolCallId, usage);
    }

    toolCallIds.add(call.toolCallId);

    if (call.callId !== undefined) {
      if (callIds.has(call.callId)) {
        throw invalidGeminiToolCall(call.toolCallId, usage);
      }

      callIds.add(call.callId);
    }
  }
}

function assertNormalizedGeminiToolFinishReason(
  finishReason: CompletionFinishReason,
  usage: Usage,
): void {
  if (finishReason === "stop" || finishReason === "tool-calls") return;

  if (finishReason === "length") {
    throw new CompletionProviderOutputError({
      kind: "truncated-tool-call",
      finishReason,
      usage,
    });
  }

  if (finishReason === "content-filter") {
    throw new CompletionProviderOutputError({
      kind: "filtered-tool-call",
      finishReason,
      usage,
    });
  }

  throw new CompletionProviderOutputError({ kind: "invalid-tool-call", finishReason, usage });
}

function ownDataProperty(value: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function thoughtSignatureFrom(value: Record<string, unknown>): string | undefined {
  return stringFrom(value.thoughtSignature) ?? stringFrom(value.thought_signature);
}
