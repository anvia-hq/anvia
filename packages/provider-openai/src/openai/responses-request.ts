import {
  type CompletionRequest,
  type FilePart,
  getAssistantGenerationMetadata,
  type ImagePart,
  isJsonValue,
  type JsonObject,
  type Message as MessageType,
  type ModelCallOptions,
  type ProviderTool,
  type ReasoningDetail,
  type ReasoningPart,
  type ToolChoice,
  type ToolDefinition,
  type ToolResultContentPart,
  type ToolResultPart,
  type UserContentPart,
} from "@anvia/core/completion";
import {
  compactJsonObject,
  isPlainObject,
  orderedRequestMessages,
  schemaName,
  stringFrom,
  toolChoiceSummary,
} from "@anvia/core/internal/provider";
import type { OpenAICompletionModelId } from "./models";

export type ResponsesCreateParams = Record<string, unknown>;
export type ResponsesInputItem = Record<string, unknown>;

export function openAIRequestOptions(options: ModelCallOptions | undefined): {
  signal?: AbortSignal | undefined;
  maxRetries: 0;
} {
  return { signal: options?.abortSignal, maxRetries: 0 };
}

export function toOpenAIResponsesParams(
  modelId: OpenAICompletionModelId,
  request: CompletionRequest,
): ResponsesCreateParams {
  if (
    request.providerOptions !== undefined &&
    (!isPlainObject(request.providerOptions) || !isJsonValue(request.providerOptions))
  ) {
    throw new TypeError("OpenAI Responses providerOptions must be a JSON object.");
  }

  const providerOptions = request.providerOptions ?? {};
  const reasoning = isPlainObject(providerOptions.reasoning)
    ? { ...providerOptions.reasoning }
    : undefined;
  const reasoningEffort = request.controls?.reasoningEffort;
  const params: ResponsesCreateParams = {
    ...providerOptions,
    model: modelId,
    input: orderedRequestMessages(request).flatMap(messageToResponsesInput),
  };

  if (reasoningEffort !== undefined) {
    params.reasoning = { ...reasoning, effort: reasoningEffort };
  }

  delete params.tools;

  if (request.instructions !== undefined) {
    params.instructions = request.instructions;
  }

  if (request.temperature !== undefined) {
    params.temperature = request.temperature;
  }

  if (request.maxTokens !== undefined) {
    params.max_output_tokens = request.maxTokens;
  }

  if (request.toolChoice !== undefined) {
    params.tool_choice = toolChoiceToOpenAI(request.toolChoice);
  }

  if (request.outputSchema !== undefined) {
    params.text = {
      format: {
        type: "json_schema",
        name: schemaName(request.outputSchema),
        strict: true,
        schema: request.outputSchema,
      },
    };
  }

  const tools = [
    ...request.tools.map(toolDefinitionToOpenAI),
    ...(request.providerTools ?? []).map(providerToolToOpenAI),
  ];

  if (tools.length > 0) {
    params.tools = tools;
  } else {
    delete params.tools;
  }

  return params;
}

export function responsesRequestSummary(
  params: ResponsesCreateParams,
  request: CompletionRequest,
  options: { stream?: boolean | undefined },
): JsonObject {
  const summarizedTools = Array.isArray(params.tools) ? params.tools : [];
  return compactJsonObject({
    provider: "openai",
    api: "responses",
    stream: options.stream === true,
    model: stringFrom(params.model),
    parameterKeys: Object.keys(params).sort(),
    inputCount: Array.isArray(params.input) ? params.input.length : undefined,
    toolCount: summarizedTools.length,
    toolNames: summarizedTools.flatMap((tool) => {
      if (!isPlainObject(tool)) {
        return [];
      }

      const name = stringFrom(tool.name) ?? stringFrom(tool.type);
      return name === undefined ? [] : [name];
    }),
    hasInstructions: typeof params.instructions === "string" && params.instructions.length > 0,
    hasOutputSchema: request.outputSchema !== undefined,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    toolChoice: toolChoiceSummary(request.toolChoice),
    providerOptionKeys: isPlainObject(request.providerOptions)
      ? Object.keys(request.providerOptions).sort()
      : undefined,
  });
}

function messageToResponsesInput(message: MessageType): ResponsesInputItem[] {
  if (message.role === "system") {
    return [
      {
        role: "system",
        content: message.content,
      },
    ];
  }

  if (message.role === "user") {
    if (typeof message.content === "string") {
      return [{ role: "user", content: message.content }];
    }

    const inputContent: ResponsesInputItem[] = [];

    for (const content of message.content) {
      inputContent.push(...userContentToOpenAIResponsesParts(content));
    }

    if (inputContent.length === 1 && inputContent[0]?.type === "input_text") {
      return [{ role: "user", content: inputContent[0].text }];
    } else if (inputContent.length > 0) {
      return [{ role: "user", content: inputContent }];
    }

    return [];
  }

  if (message.role === "tool") {
    return message.content.map((content) => {
      if (content.type !== "tool-result") {
        throw new TypeError(
          "Anvia interaction responses must be resolved by Agent before provider calls.",
        );
      }

      return toolContentToOpenAIResponsesItem(content);
    });
  }

  const items: ResponsesInputItem[] = [];

  if (typeof message.content === "string") {
    return [{ role: "assistant", content: message.content }];
  }

  const origin = getAssistantGenerationMetadata(message)?.provider;
  const text = message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n");

  if (text.length > 0) {
    items.push({ role: "assistant", content: text });
  }

  for (const content of message.content) {
    if (content.type === "reasoning" && content.id !== undefined) {
      items.push(reasoningToOpenAIInput(content));
    }

    if (content.type === "tool-call") {
      const item: ResponsesInputItem = {
        type: "function_call",
        call_id: content.callId ?? content.toolCallId,
        name: content.toolName,
        arguments: JSON.stringify(content.input),
      };

      if (keepsFunctionCallItemId(origin, content.toolCallId)) {
        item.id = content.toolCallId;
      }

      items.push(item);
    }

    if (content.type === "image" || content.type === "file") {
      throw new Error(
        "OpenAI Responses does not support image or file content in assistant history",
      );
    }
  }

  return items;
}

/**
 * Chat Completions and Responses both report the provider as "openai" (Azure reports
 * "azure-openai" for both), and Chat Completions call ids (call_...) are not valid Responses
 * item ids. So for OpenAI and Azure turns the id is kept only when it looks like a Responses
 * item id (fc...). An unknown origin keeps the id.
 */
function keepsFunctionCallItemId(origin: string | undefined, toolCallId: string): boolean {
  if (origin === undefined) return true;

  return (origin.startsWith("openai") || origin.startsWith("azure")) && toolCallId.startsWith("fc");
}

function toolContentToOpenAIResponsesItem(content: ToolResultPart): ResponsesInputItem {
  return {
    type: "function_call_output",
    call_id: content.callId ?? content.toolCallId,
    output: toolResultToOpenAIResponsesOutput(content),
  };
}

function toolResultContentToOpenAIResponsesOutput(
  content: readonly ToolResultContentPart[],
): string | ResponsesInputItem[] {
  if (content.every((item) => item.type === "text")) {
    return content.map((item) => item.text).join("\n");
  }

  return content.map((item) => {
    if (item.type === "text") {
      return { type: "input_text", text: item.text };
    }

    return fileToOpenAIResponsesPart(item);
  });
}

function toolResultToOpenAIResponsesOutput(content: ToolResultPart): string | ResponsesInputItem[] {
  const output = content.output;

  if (output.type === "text" || output.type === "error-text") {
    return output.value;
  }

  if (output.type === "json" || output.type === "error-json") {
    return JSON.stringify(output.value);
  }

  if (output.type === "execution-denied") {
    return output.reason ?? "Tool execution was denied.";
  }

  return toolResultContentToOpenAIResponsesOutput(output.value);
}

function reasoningToOpenAIInput(reasoning: ReasoningPart): ResponsesInputItem {
  const item: ResponsesInputItem = {
    type: "reasoning",
    id: reasoning.id,
    summary:
      reasoning.details
        ?.filter((content): content is Extract<ReasoningDetail, { type: "summary" }> => {
          return content.type === "summary";
        })
        .map((content) => ({ type: "summary_text", text: content.text })) ?? [],
  };
  const textContent = reasoning.details?.flatMap((content) =>
    content.type === "text" ? [{ type: "reasoning_text", text: content.text }] : [],
  );

  if (textContent !== undefined && textContent.length > 0) {
    item.content = textContent;
  }

  const encrypted = reasoning.details?.find((content) => content.type === "encrypted");

  if (encrypted?.type === "encrypted") {
    item.encrypted_content = encrypted.data;
  }

  return item;
}

function userContentToOpenAIResponsesParts(content: UserContentPart): ResponsesInputItem[] {
  if (content.type === "text") {
    return [{ type: "input_text", text: content.text }];
  }

  if (content.type === "image") {
    const part: ResponsesInputItem = { type: "input_image", image_url: imageUrl(content) };

    if (content.detail !== undefined) {
      part.detail = content.detail;
    }

    return [part];
  }

  if (content.type === "file") {
    return [fileToOpenAIResponsesPart(content)];
  }

  return [];
}

function imageUrl(image: ImagePart): string {
  if (image.image.type === "url") {
    return image.image.url;
  }

  if (image.mediaType === undefined) {
    throw new Error("OpenAI Responses image data requires mediaType");
  }

  return `data:${image.mediaType};base64,${image.image.data}`;
}

function fileToOpenAIResponsesPart(file: FilePart): ResponsesInputItem {
  if (file.data.type === "text") {
    return { type: "input_text", text: file.data.text };
  }

  if (file.mediaType.startsWith("image/")) {
    return {
      type: "input_image",
      image_url:
        file.data.type === "url"
          ? file.data.url
          : `data:${file.mediaType};base64,${file.data.data}`,
      detail: "auto",
    };
  }

  if (file.mediaType !== "application/pdf") {
    throw new Error("OpenAI Responses only supports image and PDF file attachments");
  }

  if (file.data.type === "url") {
    return { type: "input_file", file_url: file.data.url };
  }

  return {
    type: "input_file",
    file_data: `data:${file.mediaType};base64,${file.data.data}`,
    filename: file.filename ?? "document.pdf",
  };
}

function toolDefinitionToOpenAI(tool: ToolDefinition): ResponsesInputItem {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function providerToolToOpenAI(tool: ProviderTool): ResponsesInputItem {
  return {
    ...tool.configuration,
    type: tool.name,
  };
}

function toolChoiceToOpenAI(toolChoice: ToolChoice): unknown {
  if (toolChoice === "auto" || toolChoice === "required" || toolChoice === "none") {
    return toolChoice;
  }

  return {
    type: "function",
    name: toolChoice.name,
  };
}
