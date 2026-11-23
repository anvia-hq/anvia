import {
  type CompletionModelStreamEvent,
  CompletionProviderOutputError,
  type CompletionResponse,
  isJsonValue,
  Usage,
} from "@anvia/core/completion";
import { isNonblankString, isPlainObject, toolCallDelta } from "@anvia/core/internal/provider";
import {
  applyMistralFinishReason,
  assertMistralFunctionToolCall,
  assertSafeToolCallFinish,
  finishReasonFromChoice,
  hasRawToolCallValue,
  invalidMistralToolCall,
  mistralFinishReason,
  optionalMistralToolCallId,
  primaryMistralChoice,
  stringContent,
  toolCallsFrom,
  usageFromMistral,
} from "./completion-response";

type MistralStreamChunkMetadata = Readonly<{
  usage: Usage | undefined;
  hasChoices: boolean;
  primaryChoice: Record<string, unknown> | undefined;
}>;

type MistralStreamToolArguments = Readonly<{
  text?: string | undefined;
  mode?: "replace" | undefined;
}>;

export class MistralCompletionStreamState {
  private providerFinishReason: string | undefined;
  private finalResponse: CompletionResponse | undefined;
  private lastChunk: unknown;
  private sawAnyChoice = false;
  private sawPrimaryChoice = false;
  private sawToolProgress = false;

  *accept(completionEvent: unknown): Iterable<CompletionModelStreamEvent> {
    const chunk = mistralCompletionEventData(completionEvent);
    this.lastChunk = chunk;
    const metadata = mistralStreamChunkMetadata(chunk);
    const chunkFinishReason = finishReasonFromChoice(metadata.primaryChoice);
    const errorUsage = metadata.usage ?? this.finalResponse?.usage;

    this.sawAnyChoice ||= metadata.hasChoices;
    this.sawPrimaryChoice ||= metadata.primaryChoice !== undefined;

    const hasSemanticProgress = hasRawMistralSemanticProgress(metadata.primaryChoice);

    if (this.providerFinishReason !== undefined && hasSemanticProgress) {
      throw invalidMistralToolCall(undefined, errorUsage);
    }

    if (chunkFinishReason !== undefined) {
      if (
        this.providerFinishReason !== undefined &&
        this.providerFinishReason !== chunkFinishReason
      ) {
        throw invalidMistralToolCall(undefined, errorUsage);
      }

      this.providerFinishReason = chunkFinishReason;
    }

    for (const event of fromMistralChatStreamChunk(chunk)) {
      if (event.type === "final") {
        this.finalResponse = event.response;
        continue;
      }

      if (event.type === "tool_call_delta" || event.type === "tool_call") {
        this.sawToolProgress = true;
      }

      yield event;
    }
  }

  finish(): CompletionResponse | undefined {
    if (!this.sawPrimaryChoice) {
      if (this.sawAnyChoice) {
        throw invalidMistralToolCall(undefined, this.finalResponse?.usage);
      }

      throw new CompletionProviderOutputError({
        kind: "incomplete-stream",
        usage: this.finalResponse?.usage,
      });
    }

    if (this.sawToolProgress && this.providerFinishReason === undefined) {
      throw new CompletionProviderOutputError({
        kind: "incomplete-tool-call",
        usage: this.finalResponse?.usage,
      });
    }

    if (this.finalResponse === undefined && this.providerFinishReason !== undefined) {
      this.finalResponse = {
        choice: [],
        usage: Usage.empty(),
        rawResponse: this.lastChunk,
      };
    }

    if (this.finalResponse !== undefined) {
      applyMistralFinishReason(this.finalResponse, this.providerFinishReason);

      if (this.sawToolProgress) {
        assertSafeToolCallFinish(1, this.finalResponse.finishReason, this.finalResponse.usage);
      }
    }

    return this.finalResponse;
  }
}

export function fromMistralChatStreamChunk(chunk: unknown): CompletionModelStreamEvent[] {
  if (!isPlainObject(chunk)) {
    throw invalidMistralToolCall(undefined);
  }

  const events: CompletionModelStreamEvent[] = [];
  const usage = isPlainObject(chunk.usage) ? usageFromMistral(chunk.usage) : undefined;

  if (chunk.choices === undefined) {
    throw invalidMistralToolCall(undefined, usage);
  }

  const choice = primaryMistralChoice(chunk.choices, usage, { allowMissingPrimary: true });
  const providerFinishReason = finishReasonFromChoice(choice);
  const finishReason =
    providerFinishReason === undefined ? undefined : mistralFinishReason(providerFinishReason);

  if (hasRawMistralToolCalls(choice) && finishReason !== undefined) {
    assertSafeToolCallFinish(1, finishReason, usage);
  }

  if (choice?.delta !== undefined && !isPlainObject(choice.delta)) {
    throw invalidMistralToolCall(undefined, usage);
  }

  if (choice !== undefined && isPlainObject(choice.delta)) {
    const delta = choice.delta;
    const content = stringContent(delta.content);

    if (content !== undefined && content.length > 0) {
      events.push({ type: "text_delta", delta: content });
    }

    for (const toolCall of toolCallsFrom(delta, usage)) {
      if (!isPlainObject(toolCall.function)) {
        throw invalidMistralToolCall(undefined, usage);
      }

      assertMistralFunctionToolCall(toolCall, usage);
      const fn = toolCall.function;
      const index = mistralToolCallIndex(toolCall.index, usage);
      const callId = optionalMistralToolCallId(toolCall.id, usage);
      const name = optionalMistralToolCallName(fn.name, usage);
      const argumentsValue = mistralStreamToolArguments(fn.arguments, callId, usage);
      events.push(
        toolCallDelta(`tool_${index}`, {
          callId,
          name,
          argumentsDelta: argumentsValue.text,
          argumentsMode: argumentsValue.mode,
        }),
      );
    }
  }

  if (typeof chunk.id === "string") {
    events.push({ type: "message_id", id: chunk.id });
  }

  if (isPlainObject(chunk.usage)) {
    const response: CompletionResponse = {
      choice: [],
      usage: usageFromMistral(chunk.usage),
      rawResponse: chunk,
    };

    if (typeof chunk.id === "string") {
      response.messageId = chunk.id;
    }

    applyMistralFinishReason(response, providerFinishReason);
    events.push({ type: "final", response });
  }

  return events;
}

function mistralCompletionEventData(event: unknown): Record<string, unknown> {
  if (!isPlainObject(event) || !isPlainObject(event.data)) {
    throw invalidMistralToolCall(undefined);
  }

  return event.data;
}

function mistralStreamChunkMetadata(value: unknown): MistralStreamChunkMetadata {
  if (!isPlainObject(value)) {
    throw invalidMistralToolCall(undefined);
  }

  const usage = isPlainObject(value.usage) ? usageFromMistral(value.usage) : undefined;

  if (value.choices === undefined) {
    throw invalidMistralToolCall(undefined, usage);
  }

  const primaryChoice = primaryMistralChoice(value.choices, usage, {
    allowMissingPrimary: true,
  });
  return {
    usage,
    hasChoices: Array.isArray(value.choices) && value.choices.length > 0,
    primaryChoice,
  };
}

function hasRawMistralSemanticProgress(choice: Record<string, unknown> | undefined): boolean {
  if (choice?.delta === undefined) return false;

  if (!isPlainObject(choice.delta)) return true;

  const content = stringContent(choice.delta.content);
  return (content !== undefined && content.length > 0) || hasRawMistralToolCalls(choice);
}

function hasRawMistralToolCalls(choice: Record<string, unknown> | undefined): boolean {
  if (!isPlainObject(choice?.delta)) return false;

  const raw = choice.delta.toolCalls ?? choice.delta.tool_calls;
  return hasRawToolCallValue(raw);
}

function mistralToolCallIndex(value: unknown, usage?: Usage): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidMistralToolCall(undefined, usage);
  }

  return value as number;
}

function optionalMistralToolCallName(value: unknown, usage?: Usage): string | undefined {
  if (value === undefined || value === "") return undefined;

  if (!isNonblankString(value)) throw invalidMistralToolCall(undefined, usage);

  return value;
}

function mistralStreamToolArguments(
  value: unknown,
  toolCallId: string | undefined,
  usage?: Usage,
): MistralStreamToolArguments {
  if (value === undefined) return {};

  if (typeof value === "string") return { text: value };

  if (!isPlainObject(value) || !isJsonValue(value)) {
    throw new CompletionProviderOutputError({
      kind: "invalid-tool-arguments",
      toolCallId,
      usage,
    });
  }

  return { text: JSON.stringify(value), mode: "replace" };
}
