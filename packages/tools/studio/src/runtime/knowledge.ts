import type { JsonObject, JsonValue } from "@anvia/core";
import type { Hono } from "hono";
import type {
  StudioAgent,
  StudioAgentKnowledgeConfig,
  StudioKnowledgeEvidence,
  StudioKnowledgeEvidenceDocument,
  StudioKnowledgeSummary,
  StudioTrace,
  StudioTraceStore,
} from "../types";
import { compactJsonObject } from "./json";
import { errorResponse, parseLimit } from "./shared";

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
      agents: props.agents.map(agentKnowledgeConfig),
      evidence: await recentKnowledgeEvidence(props.traceStore, limit),
    };
    return c.json(summary);
  });
}

export function agentHasKnowledge(agent: StudioAgent): boolean {
  return (
    agent.agent.staticContext.length > 0 ||
    agent.agent.dynamicContexts.length > 0 ||
    agent.agent.dynamicTools.length > 0
  );
}

function agentKnowledgeConfig(agent: StudioAgent): StudioAgentKnowledgeConfig {
  const agentName = agent.name ?? agent.agent.name;
  return {
    agentId: agent.id,
    ...(agentName === undefined ? {} : { agentName }),
    sources: [
      { kind: "static_context", count: agent.agent.staticContext.length },
      { kind: "dynamic_context", count: agent.agent.dynamicContexts.length },
      { kind: "dynamic_tools", count: agent.agent.dynamicTools.length },
    ],
    staticContext: agent.agent.staticContext.map((document) => ({
      id: document.id,
      text: document.text,
      ...(document.additionalProps === undefined
        ? {}
        : { additionalProps: jsonObjectFromRecord(document.additionalProps) }),
    })),
  };
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
    return [
      {
        traceId: trace.id,
        sessionId: trace.sessionId,
        observationId: observation.id,
        observationName: observation.name,
        turn: observation.turn,
        startedAt: observation.startedAt,
        ...(query === undefined ? {} : { query }),
        documentCount: documents.length,
        toolCount: tools.length,
        documents,
        tools,
      },
    ];
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
  return [
    {
      ...(id === undefined ? {} : { id }),
      ...(text === undefined ? {} : { text }),
      ...(additionalProps === undefined ? {} : { additionalProps }),
    },
  ];
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
