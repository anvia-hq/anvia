import type { JsonValue } from "../completion/index";
import type { McpToolCallContent, McpToolCallResult } from "./types";

export function createCallToolParams(
  name: string,
  args: unknown,
): { name: string; arguments?: Record<string, unknown> } {
  if (args === null || args === undefined) {
    return { name };
  }

  if (!isPlainRecord(args)) {
    throw new Error("MCP tool arguments must be a JSON object");
  }

  return { name, arguments: args };
}

export function mapMcpToolResult(result: McpToolCallResult): string {
  if ("toolResult" in result) {
    return serializeMcpValue(result.toolResult);
  }

  if (result.isError === true) {
    throw new Error(mcpErrorMessage(result.content));
  }

  return result.content.map(mapMcpContent).join("");
}

function mcpErrorMessage(content: McpToolCallContent[]): string {
  const text = content
    .map((item) => (item.type === "text" ? item.text : undefined))
    .filter((item): item is string => item !== undefined)
    .join("\n");

  return text === "" ? "MCP tool returned an error" : text;
}

function mapMcpContent(content: McpToolCallContent): string {
  if (content.type === "text") {
    return content.text;
  }

  if (content.type === "image") {
    return `data:${content.mimeType};base64,${content.data}`;
  }

  if (content.type === "resource") {
    const mimeType =
      content.resource.mimeType === undefined ? "" : `data:${content.resource.mimeType};`;
    if ("text" in content.resource) {
      return `${mimeType}${content.resource.uri}:${content.resource.text}`;
    }

    return `${mimeType}${content.resource.uri}:${content.resource.blob}`;
  }

  throw new Error(`Unsupported MCP tool result content: ${serializeMcpValue(content)}`);
}

function serializeMcpValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

function isPlainRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
