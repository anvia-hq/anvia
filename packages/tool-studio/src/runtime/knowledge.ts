import type { JsonObject, JsonValue } from "@anvia/core/completion";
import type { Hono } from "hono";
import type {
  StudioAgent,
  StudioAgentKnowledgeConfig,
  StudioKnowledgeEvidence,
  StudioKnowledgeEvidenceDocument,
  StudioKnowledgeItem,
  StudioKnowledgeItemsPage,
  StudioKnowledgeSourceKind,
  StudioKnowledgeSourceSummary,
  StudioKnowledgeSummary,
  StudioStaticKnowledgeDocument,
  StudioTrace,
  StudioTraceStore,
} from "../types";
import { errorResponse } from "./http";
import { compactJsonObject, toJsonValue } from "./json";
import { optionalQueryString, parseLimit } from "./query";

type InspectableIndex = {
  inspect?: (request: { limit: number; cursor?: string | undefined; filter?: unknown }) => Promise<{
    items: Array<{ id: string; document: unknown; metadata?: Record<string, unknown> }>;
    nextCursor?: string | undefined;
    totalCount?: number | undefined;
  }>;
};

export function registerKnowledgeRoutes(
  app: Hono,
  props: {
    agents: StudioAgent[];
    traceStore?: StudioTraceStore;
  },
): void {
  app.get("/knowledge", async (c) => {
    const limit = parseLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "Invalid limit");
    }

    const summary: StudioKnowledgeSummary = {
      agents: await Promise.all(props.agents.map(agentKnowledgeConfig)),
      evidence: await recentKnowledgeEvidence(props.traceStore, limit),
    };
    return c.json(summary);
  });

  app.get("/knowledge/items", async (c) => {
    const limit = parseLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "Invalid limit");
    }

    const agentId = optionalQueryString(c.req.query("agentId"));
    const sourceId = optionalQueryString(c.req.query("sourceId"));
    if (agentId === undefined || sourceId === undefined) {
      return errorResponse(c, 400, "bad_request", "agentId and sourceId are required");
    }

    const agent = props.agents.find((item) => item.id === agentId);
    if (agent === undefined) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }

    const page = await knowledgeItemsPage(agent, sourceId, {
      limit,
      cursor: optionalQueryString(c.req.query("cursor")),
    });
    if (page === undefined) {
      return errorResponse(c, 404, "not_found", "Knowledge source not found");
    }

    return c.json(page);
  });
}

export function agentHasKnowledge(agent: StudioAgent): boolean {
  return (
    agent.agent.staticContext.length > 0 ||
    agent.agent.dynamicContexts.length > 0 ||
    agent.agent.dynamicTools.length > 0
  );
}

async function agentKnowledgeConfig(agent: StudioAgent): Promise<StudioAgentKnowledgeConfig> {
  const agentName = agent.name ?? agent.agent.name;
  const config: StudioAgentKnowledgeConfig = {
    agentId: agent.id,
    sources: await knowledgeSources(agent),
    staticContext: agent.agent.staticContext.map((document) => {
      const item: StudioStaticKnowledgeDocument = { id: document.id, text: document.text };
      if (document.additionalProps !== undefined) {
        item.additionalProps = jsonObjectFromRecord(document.additionalProps);
      }
      return item;
    }),
  };
  if (agentName !== undefined) config.agentName = agentName;
  return config;
}

async function knowledgeSources(agent: StudioAgent): Promise<StudioKnowledgeSourceSummary[]> {
  const sources: StudioKnowledgeSourceSummary[] = [
    {
      sourceId: staticSourceId(),
      kind: "static_context",
      label: "Static context",
      count: agent.agent.staticContext.length,
      inspectable: true,
      itemCount: agent.agent.staticContext.length,
    },
  ];

  const dynamicContextSources = await Promise.all(
    agent.agent.dynamicContexts.map(async (registration, index) => {
      const inspect = inspectFn(registration.index);
      const count = await inspectableCount(inspect, registration.options.filter);
      const source: StudioKnowledgeSourceSummary = {
        sourceId: dynamicContextSourceId(index),
        kind: "dynamic_context",
        label: `Dynamic context ${index + 1}`,
        count: 1,
        registrationIndex: index,
        topK: registration.options.topK,
        inspectable: inspect !== undefined,
      };
      if (registration.options.threshold !== undefined) {
        source.threshold = registration.options.threshold;
      }
      if (count !== undefined) source.itemCount = count;
      return source;
    }),
  );

  const dynamicToolSources = await Promise.all(
    agent.agent.dynamicTools.map(async (registration, index) => {
      const inspect = inspectFn(registration.index);
      const count = await inspectableCount(inspect, registration.options.filter);
      const source: StudioKnowledgeSourceSummary = {
        sourceId: dynamicToolsSourceId(index),
        kind: "dynamic_tools",
        label: `Dynamic tools ${index + 1}`,
        count: 1,
        registrationIndex: index,
        topK: registration.options.topK,
        inspectable: inspect !== undefined,
      };
      if (registration.options.threshold !== undefined) {
        source.threshold = registration.options.threshold;
      }
      if (count !== undefined) source.itemCount = count;
      return source;
    }),
  );

  return [...sources, ...dynamicContextSources, ...dynamicToolSources];
}

async function inspectableCount(
  inspect: InspectableIndex["inspect"] | undefined,
  filter?: unknown,
): Promise<number | undefined> {
  if (inspect === undefined) {
    return undefined;
  }
  const page = await inspect({ limit: 1, filter });
  return page.totalCount;
}

async function knowledgeItemsPage(
  agent: StudioAgent,
  sourceId: string,
  request: { limit: number; cursor?: string | undefined },
): Promise<StudioKnowledgeItemsPage | undefined> {
  if (sourceId === staticSourceId()) {
    return staticKnowledgeItemsPage(agent, request);
  }

  const dynamicContextIndex = dynamicSourceIndex(sourceId, "dynamic_context");
  if (dynamicContextIndex !== undefined) {
    const registration = agent.agent.dynamicContexts[dynamicContextIndex];
    if (registration === undefined) {
      return undefined;
    }
    const inspect = inspectFn(registration.index);
    if (inspect === undefined) {
      return nonInspectablePage(agent.id, sourceId, "dynamic_context");
    }
    const page = await inspect({
      limit: request.limit,
      cursor: request.cursor,
      filter: registration.options.filter,
    });
    const result: StudioKnowledgeItemsPage = {
      agentId: agent.id,
      sourceId,
      kind: "dynamic_context",
      inspectable: true,
      items: page.items.map((item) => dynamicContextItem(item)),
    };
    if (page.nextCursor !== undefined) result.nextCursor = page.nextCursor;
    if (page.totalCount !== undefined) result.totalCount = page.totalCount;
    return result;
  }

  const dynamicToolsIndex = dynamicSourceIndex(sourceId, "dynamic_tools");
  if (dynamicToolsIndex !== undefined) {
    const registration = agent.agent.dynamicTools[dynamicToolsIndex];
    if (registration === undefined) {
      return undefined;
    }
    const inspect = inspectFn(registration.index);
    if (inspect === undefined) {
      return nonInspectablePage(agent.id, sourceId, "dynamic_tools");
    }
    const page = await inspect({
      limit: request.limit,
      cursor: request.cursor,
      filter: registration.options.filter,
    });
    const result: StudioKnowledgeItemsPage = {
      agentId: agent.id,
      sourceId,
      kind: "dynamic_tools",
      inspectable: true,
      items: page.items.map((item) => dynamicToolItem(item)),
    };
    if (page.nextCursor !== undefined) result.nextCursor = page.nextCursor;
    if (page.totalCount !== undefined) result.totalCount = page.totalCount;
    return result;
  }

  return undefined;
}

function inspectFn(index: unknown): InspectableIndex["inspect"] | undefined {
  if (!isRecord(index) || typeof index.inspect !== "function") {
    return undefined;
  }
  const inspect = index.inspect;
  return (request) =>
    inspect.call(index, request) as ReturnType<NonNullable<InspectableIndex["inspect"]>>;
}

function staticKnowledgeItemsPage(
  agent: StudioAgent,
  request: { limit: number; cursor?: string | undefined },
): StudioKnowledgeItemsPage {
  const start = Math.max(0, Math.trunc(Number(request.cursor ?? "0")));
  const page = agent.agent.staticContext.slice(start, start + request.limit);
  const nextOffset = start + page.length;
  const result: StudioKnowledgeItemsPage = {
    agentId: agent.id,
    sourceId: staticSourceId(),
    kind: "static_context",
    inspectable: true,
    items: page.map((document) => {
      const item: StudioKnowledgeItem = {
        id: document.id,
        kind: "static_context",
        text: document.text,
      };
      if (document.additionalProps !== undefined) {
        item.metadata = jsonObjectFromRecord(document.additionalProps);
      }
      return item;
    }),
    totalCount: agent.agent.staticContext.length,
  };
  if (nextOffset < agent.agent.staticContext.length) result.nextCursor = String(nextOffset);
  return result;
}

function nonInspectablePage(
  agentId: string,
  sourceId: string,
  kind: StudioKnowledgeSourceKind,
): StudioKnowledgeItemsPage {
  return {
    agentId,
    sourceId,
    kind,
    inspectable: false,
    items: [],
    message: "This source can be searched at runtime, but it does not expose browseable chunks.",
  };
}

function dynamicContextItem(item: {
  id: string;
  document: unknown;
  metadata?: Record<string, unknown> | undefined;
}): StudioKnowledgeItem {
  const text =
    isRecord(item.document) && typeof item.document.text === "string"
      ? item.document.text
      : typeof item.document === "string"
        ? item.document
        : undefined;
  const result: StudioKnowledgeItem = {
    id: item.id,
    kind: "dynamic_context",
  };
  if (text === undefined) result.document = toJsonValue(item.document);
  else result.text = text;
  if (item.metadata !== undefined) result.metadata = jsonObjectFromRecord(item.metadata);
  return result;
}

function dynamicToolItem(item: {
  id: string;
  document: unknown;
  metadata?: Record<string, unknown> | undefined;
}): StudioKnowledgeItem {
  const document = isRecord(item.document) ? item.document : {};
  const definition = isRecord(document.definition) ? document.definition : {};
  const toolName =
    typeof document.toolName === "string"
      ? document.toolName
      : typeof definition.name === "string"
        ? definition.name
        : item.id;
  const description = typeof definition.description === "string" ? definition.description : "";
  const result: StudioKnowledgeItem = {
    id: item.id,
    kind: "dynamic_tool",
    toolName,
    description,
    parameterKeys: parameterKeys(definition.parameters),
    document: toJsonValue(item.document),
  };
  if (item.metadata !== undefined) result.metadata = jsonObjectFromRecord(item.metadata);
  return result;
}

function parameterKeys(parameters: unknown): string[] {
  if (!isRecord(parameters) || !isRecord(parameters.properties)) {
    return [];
  }
  return Object.keys(parameters.properties);
}

function staticSourceId(): string {
  return "static-context";
}

function dynamicContextSourceId(index: number): string {
  return `dynamic-context-${index}`;
}

function dynamicToolsSourceId(index: number): string {
  return `dynamic-tools-${index}`;
}

function dynamicSourceIndex(
  sourceId: string,
  kind: "dynamic_context" | "dynamic_tools",
): number | undefined {
  const prefix = kind === "dynamic_context" ? "dynamic-context-" : "dynamic-tools-";
  if (!sourceId.startsWith(prefix)) {
    return undefined;
  }
  const index = Number(sourceId.slice(prefix.length));
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

async function recentKnowledgeEvidence(
  traceStore: StudioTraceStore | undefined,
  limit: number,
): Promise<StudioKnowledgeEvidence[]> {
  if (traceStore?.listTraces === undefined) {
    return [];
  }

  const store = traceStore;
  const listTraces = store.listTraces;
  if (listTraces === undefined) {
    return [];
  }
  const summaries = await listTraces.call(store, { limit });
  const traces = await Promise.all(
    summaries.map((summary) => Promise.resolve(store.getTrace(summary.id)).catch(() => undefined)),
  );
  return traces.flatMap((trace: StudioTrace | undefined) =>
    trace === undefined ? [] : evidenceFromTrace(trace),
  );
}

function evidenceFromTrace(trace: StudioTrace): StudioKnowledgeEvidence[] {
  return trace.observations.flatMap((observation) => {
    if (observation.kind !== "generation" || !isRecord(observation.input)) {
      return [];
    }

    const documents = Array.isArray(observation.input.documents)
      ? observation.input.documents.flatMap((document) => evidenceDocument(document))
      : [];
    const tools = Array.isArray(observation.input.tools)
      ? observation.input.tools.flatMap((tool) => evidenceToolName(tool))
      : [];
    if (documents.length === 0 && tools.length === 0) {
      return [];
    }

    const query = queryFromGenerationInput(observation.input);
    const evidence: StudioKnowledgeEvidence = {
      traceId: trace.id,
      sessionId: trace.sessionId,
      observationId: observation.id,
      observationName: observation.name,
      turn: observation.turn,
      startedAt: observation.startedAt,
      documentCount: documents.length,
      toolCount: tools.length,
      documents,
      tools,
    };
    if (query !== undefined) evidence.query = query;
    return [evidence];
  });
}

function queryFromGenerationInput(value: Record<string, unknown>): string | undefined {
  const promptText = messageText(value.prompt);
  if (promptText.length > 0) {
    return promptText;
  }

  if (Array.isArray(value.chatHistory)) {
    for (let index = value.chatHistory.length - 1; index >= 0; index -= 1) {
      const text = messageText(value.chatHistory[index]);
      if (text.length > 0) {
        return text;
      }
    }
  }

  if (Array.isArray(value.history)) {
    for (let index = value.history.length - 1; index >= 0; index -= 1) {
      const text = messageText(value.history[index]);
      if (text.length > 0) {
        return text;
      }
    }
  }

  return undefined;
}

function messageText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!isRecord(value)) {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text.trim();
  }
  if (typeof value.content === "string") {
    return value.content.trim();
  }
  if (Array.isArray(value.content)) {
    return value.content.map(contentText).filter(Boolean).join("\n").trim();
  }
  return "";
}

function contentText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!isRecord(value)) {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text.trim();
  }
  return "";
}

function evidenceDocument(value: unknown): StudioKnowledgeEvidenceDocument[] {
  if (!isRecord(value)) {
    return [];
  }
  const id = typeof value.id === "string" ? value.id : undefined;
  const text = typeof value.text === "string" ? value.text : undefined;
  const additionalProps = isRecord(value.additionalProps)
    ? jsonObjectFromRecord(value.additionalProps)
    : undefined;
  if (id === undefined && text === undefined && additionalProps === undefined) {
    return [];
  }
  const document: StudioKnowledgeEvidenceDocument = {};
  if (id !== undefined) document.id = id;
  if (text !== undefined) document.text = text;
  if (additionalProps !== undefined) document.additionalProps = additionalProps;
  return [document];
}

function evidenceToolName(value: unknown): string[] {
  if (!isRecord(value) || typeof value.name !== "string") {
    return [];
  }
  return [value.name];
}

function jsonObjectFromRecord(value: Record<string, unknown>): JsonObject {
  return compactJsonObject(value);
}

function isRecord(value: unknown): value is Record<string, JsonValue | unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
