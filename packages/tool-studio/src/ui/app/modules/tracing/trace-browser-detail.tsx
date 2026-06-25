import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  ChatIcon,
  CpuIcon,
  GitBranchIcon,
  PathIcon,
  Robot01Icon,
  Settings02Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { useState } from "react";
import type { StudioTrace } from "../../../../types";
import { StudioIcon } from "../../components/ui/icon";
import { formatToolValue, formatTraceTime, formatUsage } from "../shared/format";
import { isRecord } from "../shared/object";
import { messageText } from "../shared/transcript";
import type { TraceInspectorKey, TraceObservationItem } from "../shared/types";

export function rawTraceJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined";
  } catch {
    return String(value);
  }
}

export function TraceJsonTree(props: { value: unknown }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-card/85 px-4 py-4 text-sm leading-6 text-foreground">
      <JsonNode depth={0} path="$" value={props.value} />
    </div>
  );
}

const jsonIndentSize = 16;
const jsonDisclosureGutter = 20;

function JsonNode(props: {
  arrayIndex?: number | undefined;
  depth: number;
  path: string;
  propertyKey?: string | undefined;
  trailingComma?: boolean | undefined;
  value: unknown;
}) {
  if (isJsonBranch(props.value)) {
    return (
      <JsonBranch
        arrayIndex={props.arrayIndex}
        depth={props.depth}
        path={props.path}
        propertyKey={props.propertyKey}
        trailingComma={props.trailingComma}
        value={props.value}
      />
    );
  }

  return (
    <div
      className="min-w-max whitespace-pre"
      style={{ paddingLeft: `${jsonContentIndent(props.depth)}px` }}
    >
      <JsonNodeLabel arrayIndex={props.arrayIndex} propertyKey={props.propertyKey} />
      <JsonPrimitive value={props.value} />
      {props.trailingComma ? <span className="text-foreground">,</span> : null}
    </div>
  );
}

function JsonBranch(props: {
  arrayIndex?: number | undefined;
  depth: number;
  path: string;
  propertyKey?: string | undefined;
  trailingComma?: boolean | undefined;
  value: Record<string, unknown> | unknown[];
}) {
  const [open, setOpen] = useState(props.depth === 0);
  const arrayValue = Array.isArray(props.value) ? props.value : undefined;
  const entries =
    arrayValue === undefined
      ? Object.entries(props.value as Record<string, unknown>)
      : arrayValue.map((item, index): [string, unknown] => [String(index), item]);
  const opening = arrayValue === undefined ? "{" : "[";
  const closing = arrayValue === undefined ? "}" : "]";
  const collapsed = arrayValue === undefined ? "{…}" : "[…]";

  if (entries.length === 0) {
    return (
      <div
        className="min-w-max whitespace-pre"
        style={{ paddingLeft: `${jsonContentIndent(props.depth)}px` }}
      >
        <JsonNodeLabel arrayIndex={props.arrayIndex} propertyKey={props.propertyKey} />
        <span className="text-foreground">
          {opening}
          {closing}
          {props.trailingComma ? "," : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="grid min-w-max">
      <button
        aria-expanded={open}
        className="grid min-w-max grid-cols-[16px_auto] items-center gap-1 rounded-lg py-0.5 pr-2 text-left transition duration-200 hover:bg-accent/45 hover:text-accent-foreground"
        onClick={() => setOpen((current) => !current)}
        style={{ paddingLeft: `${props.depth * jsonIndentSize}px` }}
        type="button"
      >
        <span className="grid h-4 w-4 place-items-center text-muted-foreground [&_svg]:h-3 [&_svg]:w-3">
          {open ? (
            <StudioIcon icon={ArrowDown01Icon} aria-hidden="true" />
          ) : (
            <StudioIcon icon={ArrowRight01Icon} aria-hidden="true" />
          )}
        </span>
        <span className="whitespace-pre">
          <JsonNodeLabel arrayIndex={props.arrayIndex} propertyKey={props.propertyKey} />
          {open ? (
            <span className="text-foreground">{opening}</span>
          ) : (
            <span className="text-muted-foreground">{collapsed}</span>
          )}
          {!open && props.trailingComma ? <span className="text-foreground">,</span> : null}
        </span>
      </button>
      {open ? (
        <>
          {entries.map(([key, value], index) => (
            <JsonNode
              arrayIndex={arrayValue === undefined ? undefined : Number(key)}
              depth={props.depth + 1}
              key={`${props.path}.${key}`}
              path={`${props.path}.${key}`}
              propertyKey={arrayValue === undefined ? key : undefined}
              trailingComma={index < entries.length - 1}
              value={value}
            />
          ))}
          <div
            className="min-w-max whitespace-pre text-foreground"
            style={{ paddingLeft: `${jsonContentIndent(props.depth)}px` }}
          >
            {closing}
            {props.trailingComma ? "," : ""}
          </div>
        </>
      ) : null}
    </div>
  );
}

function jsonContentIndent(depth: number): number {
  return depth * jsonIndentSize + jsonDisclosureGutter;
}

function JsonNodeLabel(props: {
  arrayIndex?: number | undefined;
  propertyKey?: string | undefined;
}) {
  if (props.propertyKey !== undefined) {
    return (
      <>
        <span className="text-muted-foreground">{JSON.stringify(props.propertyKey)}</span>
        <span className="text-foreground">: </span>
      </>
    );
  }
  if (props.arrayIndex !== undefined) {
    return (
      <>
        <span className="text-muted-foreground">[{props.arrayIndex}]</span>
        <span className="text-foreground"> </span>
      </>
    );
  }
  return null;
}

function JsonPrimitive(props: { value: unknown }) {
  if (typeof props.value === "string") {
    return <span className="text-foreground">{JSON.stringify(props.value)}</span>;
  }
  if (typeof props.value === "number") {
    return <span className="text-foreground">{String(props.value)}</span>;
  }
  if (typeof props.value === "boolean") {
    return <span className="text-chart-4">{String(props.value)}</span>;
  }
  if (props.value === null) {
    return <span className="text-muted-foreground">null</span>;
  }
  if (props.value === undefined) {
    return <span className="text-muted-foreground">undefined</span>;
  }
  return <span className="text-foreground">{rawTraceJson(props.value)}</span>;
}

function isJsonBranch(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isRecord(value);
}

export function jsonSyntaxTokens(
  json: string,
): Array<{ text: string; type: JsonTokenType; start: number }> {
  const tokenPattern =
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g;
  const tokens: Array<{ text: string; type: JsonTokenType; start: number }> = [];
  let cursor = 0;
  for (const match of json.matchAll(tokenPattern)) {
    const text = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ text: json.slice(cursor, index), type: "plain", start: cursor });
    }
    tokens.push({
      text,
      type: jsonTokenType(text, json.slice(index + text.length)),
      start: index,
    });
    cursor = index + text.length;
  }
  if (cursor < json.length) {
    tokens.push({ text: json.slice(cursor), type: "plain", start: cursor });
  }
  return tokens;
}

type JsonTokenType = "plain" | "key" | "string" | "number" | "boolean" | "null";

function jsonTokenType(text: string, followingText: string): JsonTokenType {
  if (text.startsWith('"')) {
    return followingText.trimStart().startsWith(":") ? "key" : "string";
  }
  if (text === "true" || text === "false") {
    return "boolean";
  }
  if (text === "null") {
    return "null";
  }
  return "number";
}

export function isNeutralTraceRow(row: { label: string }): boolean {
  return row.label === "Message Id";
}

export function TraceRowIcon(props: { label: string }) {
  const className = "h-3.5 w-3.5 shrink-0";
  switch (props.label) {
    case "System prompt":
      return <StudioIcon icon={Settings02Icon} aria-hidden="true" className={className} />;
    case "Prompt":
      return <StudioIcon icon={ChatIcon} aria-hidden="true" className={className} />;
    case "Output":
    case "Assistant output":
      return <StudioIcon icon={ArrowTurnBackwardIcon} aria-hidden="true" className={className} />;
    default:
      return null;
  }
}

export function plainTraceValue(
  title: string,
  value: unknown,
): Array<{ label: string; text: string }> {
  if (title === "Output") {
    const outputRows = plainTraceOutput(value);
    if (outputRows.length > 0) {
      return outputRows;
    }
  }
  const messageRows = plainTraceInput(value, title);
  if (messageRows.length > 0) {
    return messageRows;
  }
  if (!isRecord(value)) {
    return [{ label: title, text: plainTraceText(value) }];
  }

  const rows: Array<{ label: string; text: string }> = [];
  for (const [key, item] of Object.entries(value)) {
    const nestedMessages = plainTraceInput(item, key);
    if (nestedMessages.length > 0) {
      rows.push(...nestedMessages);
      continue;
    }
    rows.push({ label: traceLabelText(key), text: plainTraceText(item) });
  }
  return rows.length > 0 ? rows : [{ label: title, text: "Empty object" }];
}

function plainTraceOutput(value: unknown): Array<{ label: string; text: string }> {
  if (!isRecord(value)) {
    return [];
  }
  const rows: Array<{ label: string; text: string }> = [];
  const choiceRows = plainTraceInput(value.choice, "choice");
  rows.push(...choiceRows);
  if (typeof value.messageId === "string" && value.messageId.length > 0) {
    rows.push({ label: "Message Id", text: value.messageId });
  }
  return rows;
}

function plainTraceInput(
  value: unknown,
  parentKey?: string,
): Array<{ label: string; text: string }> {
  if (typeof value === "string" && parentKey === undefined) {
    return [{ label: "Value", text: value }];
  }
  if (Array.isArray(value)) {
    if (parentKey === "chatHistory") {
      return chatHistoryRows(value);
    }
    if (parentKey === "history") {
      return conversationHistoryRows(value);
    }
    return value
      .map((item, index) => ({
        label: traceArrayItemLabel(item, index, parentKey),
        text: messageText(item) || formatToolValue(item),
      }))
      .filter((item) => item.text.length > 0);
  }
  if (!isRecord(value)) {
    return [];
  }

  const chatHistory = Array.isArray(value.chatHistory) ? value.chatHistory : undefined;
  if (chatHistory !== undefined) {
    const rows = systemPromptRows(value);
    rows.push(...plainTraceInput(chatHistory, "chatHistory"));
    return rows;
  }

  if (Array.isArray(value.prompt)) {
    return plainTraceInput(value.prompt, "prompt");
  }

  const rows: Array<{ label: string; text: string }> = [];
  rows.push(...systemPromptRows(value));

  const history = Array.isArray(value.history) ? value.history : [];
  if (history.length > 0) {
    rows.push(...plainTraceInput(history, "history"));
  }

  const promptText = messageText(value.prompt);
  if (promptText.length > 0) {
    rows.push({ label: history.length > 0 ? "Current prompt" : "Prompt", text: promptText });
  }

  return rows;
}

function chatHistoryRows(value: unknown[]): Array<{ label: string; text: string }> {
  const messages = value
    .map((item, index) => ({
      label: traceArrayItemLabel(item, index, "chatHistory"),
      text: messageText(item) || formatToolValue(item),
    }))
    .filter((item) => item.text.length > 0);
  const current = messages.at(-1);
  const history = messages.slice(0, -1);
  const rows: Array<{ label: string; text: string }> = [];
  if (history.length > 0) {
    rows.push({
      label: `Conversation history (${history.length})`,
      text: history.map((item, index) => `${index + 1}. ${item.label}\n${item.text}`).join("\n\n"),
    });
  }
  if (current !== undefined) {
    rows.push({
      label: history.length > 0 ? "Current prompt" : "Prompt",
      text: current.text,
    });
  }
  return rows;
}

function conversationHistoryRows(value: unknown[]): Array<{ label: string; text: string }> {
  const messages = value
    .map((item, index) => ({
      label: traceArrayItemLabel(item, index, "history"),
      text: messageText(item) || formatToolValue(item),
    }))
    .filter((item) => item.text.length > 0);
  if (messages.length === 0) {
    return [];
  }
  return [
    {
      label: `Conversation history (${messages.length})`,
      text: messages.map((item, index) => `${index + 1}. ${item.label}\n${item.text}`).join("\n\n"),
    },
  ];
}

function traceArrayItemLabel(item: unknown, index: number, parentKey: string | undefined): string {
  if (isRecord(item)) {
    const type = typeof item.type === "string" ? item.type : undefined;
    if (parentKey === "choice") {
      if (type === "text") {
        return "Assistant output";
      }
      if (type === "reasoning") {
        return "Reasoning";
      }
    }
    if (type === "reasoning") {
      return "Reasoning";
    }
    if (typeof item.role === "string") {
      return traceLabelText(item.role);
    }
    if (type !== undefined) {
      return traceLabelText(type);
    }
  }

  const prefix = parentKey === undefined ? "Item" : `${traceLabelText(parentKey)} item`;
  return `${prefix} ${index + 1}`;
}

function traceLabelText(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function systemPromptRows(value: Record<string, unknown>): Array<{ label: string; text: string }> {
  const instructions = value.instructions;
  if (typeof instructions !== "string" || instructions.trim().length === 0) {
    return [];
  }
  return [{ label: "System prompt", text: instructions }];
}

function plainTraceText(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function traceTurns(trace: StudioTrace): Array<{
  turn: number;
  observations: TraceObservationItem[];
  durationMs?: number;
}> {
  const grouped = new Map<number, TraceObservationItem[]>();
  for (const observation of trace.observations) {
    const turn = Number.isFinite(observation.turn) ? observation.turn : grouped.size + 1;
    grouped.set(turn, [...(grouped.get(turn) ?? []), observation]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([turn, observations]) => ({
      turn,
      observations,
      durationMs: observations.reduce(
        (total, observation) => total + (observation.durationMs ?? 0),
        0,
      ),
    }));
}

export type TraceObservationNode = {
  observation: TraceObservationItem;
  children: TraceObservationNode[];
};

export function traceObservationTree(observations: TraceObservationItem[]): TraceObservationNode[] {
  const nodes = new Map<string, TraceObservationNode>();
  for (const observation of observations) {
    nodes.set(observation.id, { observation, children: [] });
  }

  const roots: TraceObservationNode[] = [];
  for (const observation of observations) {
    const node = nodes.get(observation.id);
    if (node === undefined) {
      continue;
    }
    const parentId = observation.parentObservationId;
    const parent = parentId === undefined ? undefined : nodes.get(parentId);
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }
  return roots;
}

export function selectedTraceDetail(
  trace: StudioTrace,
  turns: Array<{ turn: number; observations: TraceObservationItem[]; durationMs?: number }>,
  activeKey: TraceInspectorKey,
): {
  title: string;
  tone: "trace" | "agent" | "turn" | StudioTrace["observations"][number]["kind"];
  startedAt: string;
  durationMs: number | undefined;
  firstDeltaMs: number | undefined;
  usage: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  metadata: unknown;
} {
  if (activeKey === "agent") {
    return {
      title: "agent.run",
      tone: "agent",
      startedAt: formatTraceTime(trace.startedAt),
      durationMs: trace.durationMs,
      firstDeltaMs: firstDeltaMsFromObservations(trace.observations),
      usage: formatUsage(trace.usage),
      input: trace.input,
      output: trace.output,
      error: trace.error,
      metadata: traceDetailMetadata(trace),
    };
  }
  if (activeKey.startsWith("turn:")) {
    const turnNumber = Number(activeKey.slice("turn:".length));
    const turn = turns.find((item) => item.turn === turnNumber);
    return {
      title: `turn.${Number.isFinite(turnNumber) ? turnNumber : 1}`,
      tone: "turn",
      startedAt: formatTraceTime(turn?.observations[0]?.startedAt ?? trace.startedAt),
      durationMs: turn?.durationMs,
      firstDeltaMs: firstDeltaMsFromObservations(turn?.observations ?? []),
      usage: turnUsageText(turn?.observations ?? []),
      input: turn?.observations[0]?.input,
      output: turn?.observations.at(-1)?.output,
      metadata: turnDetailMetadata(turnNumber, turn?.observations ?? []),
    };
  }
  if (activeKey.startsWith("observation:")) {
    const observationId = activeKey.slice("observation:".length);
    const observation = trace.observations.find((item) => item.id === observationId);
    if (observation !== undefined) {
      return {
        title: traceObservationLabel(observation),
        tone: observation.kind,
        startedAt: formatTraceTime(observation.startedAt),
        durationMs: observation.durationMs,
        firstDeltaMs: firstDeltaMsFromMetadata(observation.metadata),
        usage: observationUsageText(observation),
        input: observation.input,
        output: observation.output,
        error: observation.error,
        metadata: observationDetailMetadata(observation),
      };
    }
  }
  return {
    title: trace.name ?? "Agent",
    tone: "trace",
    startedAt: formatTraceTime(trace.startedAt),
    durationMs: trace.durationMs,
    firstDeltaMs: firstDeltaMsFromObservations(trace.observations),
    usage: formatUsage(trace.usage),
    input: trace.input,
    output: trace.output,
    error: trace.error,
    metadata: traceDetailMetadata(trace),
  };
}

export function traceDetailMetadata(trace: StudioTrace): Record<string, unknown> {
  const metadata = isRecord(trace.metadata) ? trace.metadata : {};
  const traceGroup = compactTraceMetadata({
    status: trace.status,
    traceId: trace.trace?.traceId ?? trace.id,
    observationId: trace.trace?.observationId,
    sessionId: trace.sessionId,
    observationCount: trace.observationCount,
    messageCount: traceMessageCount(metadata.messages),
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    durationMs: trace.durationMs,
  });
  return compactTraceMetadata({
    ...metadata,
    status: trace.status,
    traceId: trace.trace?.traceId ?? trace.id,
    observationId: trace.trace?.observationId,
    sessionId: trace.sessionId,
    observationCount: trace.observationCount,
    messageCount: traceMessageCount(metadata.messages),
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    durationMs: trace.durationMs,
    trace: isRecord(metadata.trace) ? metadata.trace : traceGroup,
  });
}

function turnDetailMetadata(
  turn: number,
  observations: TraceObservationItem[],
): Record<string, unknown> {
  return compactTraceMetadata({
    turn,
    observationCount: observations.length,
    generationCount: observations.filter((observation) => observation.kind === "generation").length,
    toolCount: observations.filter((observation) => observation.kind === "tool").length,
    agentCount: observations.filter((observation) => observation.kind === "agent").length,
    firstDeltaMs: firstDeltaMsFromObservations(observations),
    status: observationStatusSummary(observations),
    startedAt: observations[0]?.startedAt,
    endedAt: observations.at(-1)?.endedAt,
  });
}

export function observationDetailMetadata(
  observation: TraceObservationItem,
): Record<string, unknown> {
  const metadata = isRecord(observation.metadata) ? observation.metadata : {};
  const base = compactTraceMetadata({
    ...metadata,
    status: observation.status,
    kind: observation.kind,
    turn: observation.turn,
    parentObservationId: observation.parentObservationId ?? null,
    startedAt: observation.startedAt,
    endedAt: observation.endedAt ?? null,
    durationMs: observation.durationMs,
  });
  return compactTraceMetadata({
    ...base,
    trace: isRecord(base.trace)
      ? base.trace
      : compactTraceMetadata({
          status: observation.status,
          kind: observation.kind,
          turn: observation.turn,
          parentObservationId: observation.parentObservationId ?? null,
          startedAt: observation.startedAt,
          endedAt: observation.endedAt ?? null,
          durationMs: observation.durationMs,
        }),
    modelInfo: isRecord(base.modelInfo) ? base.modelInfo : modelInfoMetadata(base),
    modelCall: isRecord(base.modelCall) ? base.modelCall : modelCallMetadata(base),
    response: isRecord(base.response) ? base.response : responseMetadata(base),
    tools: isRecord(base.tools) ? base.tools : toolsMetadata(base),
    timing: isRecord(base.timing) ? base.timing : timingMetadata(base),
  });
}

function modelInfoMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const group = compactTraceMetadata({
    provider: metadata.provider,
    model: metadata.model,
    requestedModel: metadata.requestedModel,
    defaultModel: metadata.defaultModel,
  });
  return Object.keys(group).length === 0 ? undefined : group;
}

function modelCallMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const request = compactTraceMetadata({
    messageCount: metadata.historyCount,
    documentCount: metadata.documentCount,
    toolCount: metadata.toolCount,
    toolNames: metadata.toolNames,
    temperature: metadata.temperature,
    maxTokens: metadata.maxTokens,
    toolChoice: metadata.toolChoice,
    hasOutputSchema: metadata.hasOutputSchema,
    additionalParamKeys: metadata.additionalParamKeys,
  });
  const group = compactTraceMetadata({
    request: Object.keys(request).length === 0 ? undefined : request,
    providerRequest: metadata.providerRequest,
  });
  return Object.keys(group).length === 0 ? undefined : group;
}

function responseMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const group = compactTraceMetadata({
    messageId: metadata.messageId,
    usage: metadata.usage,
    providerResponse: metadata.providerResponse,
  });
  return Object.keys(group).length === 0 ? undefined : group;
}

function toolsMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const group = compactTraceMetadata({
    count: metadata.toolCount,
    names: metadata.toolNames,
    toolChoice: metadata.toolChoice,
    internalCallId: metadata.internalCallId,
    toolCallId: metadata.toolCallId,
    skipped: metadata.skipped,
    description: metadata.toolDescription,
    parameterKeys: metadata.parameterKeys,
    requiredParameterKeys: metadata.requiredParameterKeys,
    approvalRequired: metadata.approvalRequired,
    mcpServerName: metadata.mcpServerName,
    argumentBytes: metadata.argumentBytes,
    resultBytes: metadata.resultBytes,
  });
  return Object.keys(group).length === 0 ? undefined : group;
}

function timingMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const group = compactTraceMetadata({
    firstDeltaMs: metadata.firstDeltaMs,
    durationMs: metadata.durationMs,
    startedAt: metadata.startedAt,
    endedAt: metadata.endedAt,
  });
  return Object.keys(group).length === 0 ? undefined : group;
}

export function observationStatusSummary(observations: TraceObservationItem[]): string {
  if (observations.length === 0) {
    return "empty";
  }
  if (observations.some((observation) => observation.status === "error")) {
    return "error";
  }
  if (observations.some((observation) => observation.status === "running")) {
    return "running";
  }
  return "success";
}

function traceMessageCount(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

export function compactTraceMetadata(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export function traceObservationLabel(observation: TraceObservationItem): string {
  if (observation.kind === "agent") {
    return observation.name;
  }
  return observation.kind === "tool" ? `tool.${observation.name}` : observation.name;
}

export function firstDeltaMsFromObservations(
  observations: TraceObservationItem[],
): number | undefined {
  for (const observation of observations) {
    const firstDeltaMs = firstDeltaMsFromMetadata(observation.metadata);
    if (firstDeltaMs !== undefined) {
      return firstDeltaMs;
    }
  }
  return undefined;
}

function firstDeltaMsFromMetadata(metadata: unknown): number | undefined {
  if (!isRecord(metadata) || typeof metadata.firstDeltaMs !== "number") {
    return undefined;
  }
  return metadata.firstDeltaMs;
}

export function statusDotClass(status: StudioTrace["status"]): string {
  switch (status) {
    case "success":
      return "bg-foreground";
    case "error":
      return "bg-destructive";
    case "running":
      return "bg-muted-foreground";
  }
}

export function TraceToneIcon(props: {
  tone: "trace" | "agent" | "turn" | StudioTrace["observations"][number]["kind"];
}) {
  switch (props.tone) {
    case "trace":
      return <StudioIcon icon={PathIcon} aria-hidden="true" />;
    case "agent":
      return <StudioIcon icon={Robot01Icon} aria-hidden="true" />;
    case "turn":
      return <StudioIcon icon={GitBranchIcon} aria-hidden="true" />;
    case "generation":
      return <StudioIcon icon={CpuIcon} aria-hidden="true" />;
    case "tool":
      return <StudioIcon icon={Wrench01Icon} aria-hidden="true" />;
  }
}

export function traceToneIconClass(
  tone: "trace" | "agent" | "turn" | StudioTrace["observations"][number]["kind"],
): string {
  switch (tone) {
    case "trace":
      return "bg-foreground text-background";
    case "agent":
      return "bg-muted-foreground text-background";
    case "turn":
      return "bg-chart-4 text-background";
    case "generation":
      return "bg-foreground text-background";
    case "tool":
      return "bg-destructive text-background";
  }
}

export function observationUsageText(observation: TraceObservationItem): string {
  if (!isRecord(observation.output) || !isRecord(observation.output.usage)) {
    return "";
  }
  return formatUsageValue(observation.output.usage);
}

export function turnUsageText(observations: TraceObservationItem[]): string {
  const totals = observations
    .map(observationUsageText)
    .filter((usage) => usage.length > 0)
    .join(" + ");
  return totals;
}

function formatUsageValue(value: Record<string, unknown>): string {
  const input = typeof value.inputTokens === "number" ? value.inputTokens : 0;
  const output = typeof value.outputTokens === "number" ? value.outputTokens : 0;
  const total = typeof value.totalTokens === "number" ? value.totalTokens : input + output;
  if (total === 0) {
    return "";
  }
  return `${input} -> ${output} (Σ ${total})`;
}
