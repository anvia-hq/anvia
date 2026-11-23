import type {
  StudioAgentKnowledgeConfig,
  StudioKnowledgeItem,
  StudioKnowledgeSourceKind,
  StudioKnowledgeSourceSummary,
} from "../../../../types";
import type { KnowledgeTab } from "../shared/types";

export const itemLimit = 50;

export type KnowledgeSourceRef = {
  key: string;
  agentId: string;
  agentName: string;
  source: StudioKnowledgeSourceSummary;
};

export type ItemState = {
  key: string;
  loading: boolean;
  items: StudioKnowledgeItem[];
  nextCursor?: string;
  totalCount?: number;
  inspectable: boolean;
  message?: string;
  error?: string;
};

export function flattenSources(agents: StudioAgentKnowledgeConfig[]): KnowledgeSourceRef[] {
  return agents.flatMap((agent) =>
    agent.sources.map((source, index) => ({
      key: `${agent.agentId}:${sourceId(source, index)}`,
      agentId: agent.agentId,
      agentName: agent.agentName ?? agent.agentId,
      source: withSourceId(source, index),
    })),
  );
}

export const knowledgeTabs: Array<{ id: KnowledgeTab; label: string }> = [
  { id: "static-context", label: "Static Context" },
  { id: "dynamic-context", label: "Dynamic Context" },
  { id: "dynamic-tools", label: "Dynamic Tools" },
  { id: "retrieval-log", label: "Retrieval Log" },
];

function withSourceId(
  source: StudioKnowledgeSourceSummary,
  index: number,
): StudioKnowledgeSourceSummary {
  return source.sourceId === undefined
    ? { ...source, sourceId: fallbackSourceId(source, index) }
    : source;
}

export function sourceId(source: StudioKnowledgeSourceSummary, index = 0): string {
  return source.sourceId ?? fallbackSourceId(source, index);
}

function fallbackSourceId(source: StudioKnowledgeSourceSummary, index: number): string {
  switch (source.kind) {
    case "static_context":
      return "static-context";
    case "dynamic_context":
      return `dynamic-context-${source.registrationIndex ?? index}`;
    case "dynamic_tools":
      return `dynamic-tools-${source.registrationIndex ?? index}`;
  }
}

function sumKind(sources: StudioKnowledgeSourceSummary[], kind: StudioKnowledgeSourceKind): number {
  return sources
    .filter((source) => source.kind === kind)
    .reduce((total, source) => total + (source.itemCount ?? source.count), 0);
}

export function sourceLabel(kind: StudioKnowledgeSourceKind): string {
  switch (kind) {
    case "static_context":
      return "Static context";
    case "dynamic_context":
      return "Dynamic context";
    case "dynamic_tools":
      return "Dynamic tools";
  }
}

export function sourceKindForTab(tab: KnowledgeTab): StudioKnowledgeSourceKind | undefined {
  switch (tab) {
    case "static-context":
      return "static_context";
    case "dynamic-context":
      return "dynamic_context";
    case "dynamic-tools":
      return "dynamic_tools";
    case "retrieval-log":
      return undefined;
  }
}

export function tabLabel(tab: KnowledgeTab): string {
  return knowledgeTabs.find((item) => item.id === tab)?.label ?? "Knowledge";
}

export function tabCountLabel(
  tab: KnowledgeTab,
  sources: KnowledgeSourceRef[],
  evidenceCount: number,
): string {
  const sourceKind = sourceKindForTab(tab);

  if (sourceKind === undefined) {
    return `${evidenceCount} entries`;
  }

  const tabSources = sources.filter((source) => source.source.kind === sourceKind);
  const itemCount = sumKind(
    tabSources.map((source) => source.source),
    sourceKind,
  );
  return `${tabSources.length} sources / ${itemCount} items`;
}

export function itemKindLabel(kind: StudioKnowledgeItem["kind"]): string {
  switch (kind) {
    case "static_context":
      return "Static context";
    case "dynamic_context":
      return "Dynamic context";
    case "dynamic_tool":
      return "Dynamic tool";
  }
}
