import { isJsonValue, type JsonObject, type ToolResultContentPart } from "@anvia/core/completion";

type McpResultContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | {
      type: "resource";
      resource:
        | { uri: string; text: string; mimeType?: string | undefined }
        | { uri: string; blob: string; mimeType?: string | undefined };
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string | undefined;
    };

export type McpToolCallResult =
  | {
      content: McpResultContent[];
      structuredContent?: Record<string, unknown> | undefined;
      isError?: boolean | undefined;
    }
  | {
      toolResult: unknown;
    };

export function createCallToolParams(
  name: string,
  args: unknown,
): { name: string; arguments?: Record<string, unknown> } {
  if (args === undefined) {
    return { name };
  }

  return { name, arguments: parseMcpToolArguments(args) };
}

export function parseMcpToolArguments(args: unknown): JsonObject {
  if (!isMcpJsonObject(args)) {
    throw new TypeError("MCP tool arguments must be a strict JSON object");
  }
  return args;
}

function isMcpJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) && isJsonValue(value);
}

export function mapMcpToolResult(result: McpToolCallResult): readonly ToolResultContentPart[] {
  if ("toolResult" in result) {
    return [{ type: "text", text: serializeMcpValue(result.toolResult) }];
  }

  if (result.isError === true) {
    throw new Error(mcpErrorMessage(result.content));
  }

  const content = result.content.map(mapMcpContent);
  if (content.length === 0 && result.structuredContent !== undefined) {
    content.push({ type: "text", text: serializeMcpValue(result.structuredContent) });
  }
  return content;
}

function mcpErrorMessage(content: McpResultContent[]): string {
  const text = content
    .map((item) => (item.type === "text" ? item.text : undefined))
    .filter((item): item is string => item !== undefined)
    .join("\n");

  return text === "" ? "MCP tool returned an error" : text;
}

function mapMcpContent(content: McpResultContent): ToolResultContentPart {
  if (content.type === "text") {
    return { type: "text", text: content.text };
  }

  if (content.type === "image") {
    return {
      type: "file",
      data: { type: "data", data: content.data },
      mediaType: content.mimeType,
    };
  }

  if (content.type === "resource") {
    return { type: "text", text: serializeResource(content.resource) };
  }

  if (content.type === "audio") {
    throw new Error(`Unsupported MCP tool result content type: audio (${content.mimeType})`);
  }

  throw new Error(`Unsupported MCP tool result content type: resource_link (${content.uri})`);
}

function serializeResource(
  resource:
    | { uri: string; text: string; mimeType?: string | undefined }
    | { uri: string; blob: string; mimeType?: string | undefined },
): string {
  const mediaType =
    resource.mimeType ?? ("text" in resource ? "text/plain" : "application/octet-stream");
  const encoding = "text" in resource ? "text" : "base64";
  const data = "text" in resource ? resource.text : resource.blob;
  return `MCP resource (${resource.uri}; ${mediaType}; ${encoding})\n${data}`;
}

function serializeMcpValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!isJsonValue(value)) {
    throw new TypeError("MCP tool results must be strict JSON values.");
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TypeError("MCP tool results must be strict JSON values.", { cause: error });
  }
  if (serialized === undefined) {
    throw new TypeError("MCP tool results must be strict JSON values.");
  }
  return serialized;
}
