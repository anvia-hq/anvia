import { isRecord } from "../shared/object";

export type TracePayloadField = "input" | "output" | "metadata" | "error";

export type TracePayloadMessage = {
  key: string;
  role: string;
  content: string;
  toolCalls: TracePayloadTool[];
};

export type TracePayloadTool = {
  key: string;
  name: string;
  description?: string;
  value: unknown;
};

export type TracePayloadAnalysis = {
  messages: TracePayloadMessage[];
  tools: TracePayloadTool[];
  additional: unknown;
  hasMessages: boolean;
};

export type TraceStructuredEntry = {
  path: string;
  label: string;
  value: unknown;
};

const messageKeys = [
  "messages",
  "inputMessages",
  "input_messages",
  "outputMessages",
  "output_messages",
  "chatHistory",
  "chat_history",
  "history",
  "prompt",
  "output",
  "choice",
] as const;
const toolKeys = ["tools", "functions", "toolSchemas", "tool_schemas"] as const;

export function analyzeTracePayload(
  value: unknown,
  field: "input" | "output",
): TracePayloadAnalysis {
  const messages: TracePayloadMessage[] = [];
  const tools: TracePayloadTool[] = [];
  const defaultRole = field === "output" ? "assistant" : "user";

  if (Array.isArray(value)) {
    const unrecognized: unknown[] = [];
    value.forEach((item, index) => {
      const message = parseMessage(item, `message:${index}`, defaultRole);
      if (message === undefined) unrecognized.push(item);
      else messages.push(message);
    });
    return {
      messages,
      tools,
      additional: unrecognized.length > 0 ? unrecognized : undefined,
      hasMessages: messages.length > 0,
    };
  }

  if (!isRecord(value)) {
    return { messages, tools, additional: value, hasMessages: false };
  }

  const directMessage = parseMessage(value, "message:direct");
  if (directMessage !== undefined) {
    const messageFields = new Set([
      "role",
      "type",
      "content",
      "text",
      "message",
      "result",
      "output",
      "value",
      "tool_calls",
      "toolCalls",
      "toolName",
      "input",
      "arguments",
    ]);
    const additionalEntries = Object.entries(value).filter(([key]) => !messageFields.has(key));
    return {
      messages: [directMessage],
      tools,
      additional: additionalEntries.length > 0 ? Object.fromEntries(additionalEntries) : undefined,
      hasMessages: true,
    };
  }

  const consumed = new Set<string>();
  if (typeof value.instructions === "string" && value.instructions.trim().length > 0) {
    messages.push({
      key: "instructions",
      role: "system",
      content: value.instructions,
      toolCalls: [],
    });
    consumed.add("instructions");
  }

  for (const key of messageKeys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      const parsed = candidate
        .map((item, index) => parseMessage(item, `${key}:${index}`, defaultRole))
        .filter((message): message is TracePayloadMessage => message !== undefined);
      if (parsed.length > 0) {
        messages.push(...parsed);
        consumed.add(key);
      }
      continue;
    }
    const parsed = parseMessage(candidate, `${key}:direct`, defaultRole);
    if (parsed !== undefined) {
      messages.push(parsed);
      consumed.add(key);
    }
  }

  if (Array.isArray(value.choices)) {
    const parsed = value.choices
      .map((choice, index) => {
        if (!isRecord(choice)) return undefined;
        return parseMessage(
          choice.message ?? choice.delta ?? choice,
          `choices:${index}`,
          "assistant",
        );
      })
      .filter((message): message is TracePayloadMessage => message !== undefined);
    if (parsed.length > 0) {
      messages.push(...parsed);
      consumed.add("choices");
    }
  }

  for (const key of toolKeys) {
    const candidate = value[key];
    if (!Array.isArray(candidate)) continue;
    tools.push(...candidate.map((tool, index) => parseTool(tool, `${key}:${index}`)));
    consumed.add(key);
  }

  const additionalEntries = Object.entries(value).filter(([key]) => !consumed.has(key));
  return {
    messages,
    tools,
    additional: additionalEntries.length > 0 ? Object.fromEntries(additionalEntries) : undefined,
    hasMessages: messages.length > 0,
  };
}

export function flattenTracePayload(value: unknown): TraceStructuredEntry[] {
  const entries: TraceStructuredEntry[] = [];
  const visit = (current: unknown, path: string) => {
    if (Array.isArray(current)) {
      if (current.length === 0) entries.push({ path, label: path || "Value", value: current });
      current.forEach((item, index) => visit(item, path ? `${path}.${index}` : String(index)));
      return;
    }
    if (isRecord(current)) {
      const nested = Object.entries(current);
      if (nested.length === 0) entries.push({ path, label: path || "Value", value: current });
      nested.forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key));
      return;
    }
    entries.push({
      path,
      label: path ? tracePayloadLabel(path.split(".").at(-1) ?? path) : "Value",
      value: current,
    });
  };
  visit(value, "");
  return entries;
}

export function compactTracePayloadValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return tracePayloadJson(value);
}

export function tracePayloadJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined";
  } catch {
    return String(value);
  }
}

export function tracePayloadLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseMessage(
  value: unknown,
  key: string,
  defaultRole?: string,
): TracePayloadMessage | undefined {
  if (!isRecord(value)) return undefined;
  const role = messageRole(value) ?? (hasContentShape(value) ? defaultRole : undefined);
  if (role === undefined) return undefined;

  const content = messageContent(
    value.content ?? value.text ?? value.message ?? value.result ?? value.output ?? value.value,
  );
  const toolCalls = [
    ...toolCallsFrom(value.tool_calls, `${key}:tool-call`),
    ...toolCallsFrom(value.toolCalls, `${key}:tool-call`),
    ...toolCallsFromContent(value.content, `${key}:content-tool-call`),
    ...(isToolPayload(value) ? [parseTool(value, `${key}:tool`)] : []),
  ];
  return { key, role, content, toolCalls };
}

function hasContentShape(value: Record<string, unknown>): boolean {
  return (
    "content" in value ||
    "text" in value ||
    "message" in value ||
    "result" in value ||
    "output" in value ||
    "value" in value ||
    "tool_calls" in value ||
    "toolCalls" in value ||
    isToolPayload(value)
  );
}

function messageRole(value: Record<string, unknown>): string | undefined {
  if (typeof value.role === "string") return value.role.toLowerCase();
  if (value.type === "reasoning") return "reasoning";
  if (isToolPayload(value)) return "tool";
  return undefined;
}

function messageContent(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!isRecord(item)) return messageContent(item);
        if (isToolPayload(item)) return "";
        if (typeof item.text === "string") return item.text;
        if (typeof item.content === "string") return item.content;
        if (item.type === "image" || item.type === "image_url") return "[Image]";
        if (item.type === "file") return "[File]";
        if (item.type === "audio") return "[Audio]";
        return compactTracePayloadValue(item);
      })
      .filter(Boolean)
      .join("\n");
  }
  if (isRecord(value)) {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return compactTracePayloadValue(value);
}

function toolCallsFrom(value: unknown, key: string): TracePayloadTool[] {
  if (!Array.isArray(value)) return [];
  return value.map((tool, index) => parseTool(tool, `${key}:${index}`));
}

function toolCallsFromContent(value: unknown, key: string): TracePayloadTool[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => isRecord(item) && isToolPayload(item))
    .map((tool, index) => parseTool(tool, `${key}:${index}`));
}

function parseTool(value: unknown, key: string): TracePayloadTool {
  if (!isRecord(value)) return { key, name: "Tool", value };
  const fn = isRecord(value.function) ? value.function : undefined;
  const name =
    stringValue(value.toolName) ??
    stringValue(value.name) ??
    stringValue(fn?.name) ??
    (typeof value.type === "string" ? tracePayloadLabel(value.type) : "Tool");
  const description = stringValue(value.description) ?? stringValue(fn?.description);
  const payload =
    fn?.arguments ??
    value.arguments ??
    value.input ??
    value.result ??
    value.output ??
    value.value ??
    value.content ??
    value;
  const tool: TracePayloadTool = { key, name, value: parseJsonString(payload) };
  if (description !== undefined) tool.description = description;
  return tool;
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isToolPayload(value: Record<string, unknown>): boolean {
  return [
    "tool_call",
    "server_tool_call",
    "tool_result",
    "server_tool_result",
    "tool-call",
    "server-tool-call",
    "tool-result",
    "server-tool-result",
  ].includes(String(value.type));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
