import type { StudioConfig, StudioTrace } from "../../../../types";
import { isRecord } from "./object";
import type { ActivePage, ToolApproval, TraceStatusFilter } from "./types";

export function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) {
    return "now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks}w`;
  }
  return `${Math.floor(days / 30)}mo`;
}

export function formatTraceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatTraceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(value: number | undefined): string {
  if (value === undefined) {
    return "";
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

export function formatUsage(usage: StudioTrace["usage"]): string {
  if (usage === undefined) {
    return "-";
  }
  return `${usage.totalTokens} tok`;
}

export function pageTitle(page: ActivePage, agentName: string | undefined): string {
  switch (page) {
    case "agents":
      return "Agents";
    case "sessions":
      return "Sessions";
    case "tracing":
      return "Traces";
    case "tools":
      return "Tools";
    case "mcps":
      return "MCPs";
    case "pipelines":
      return "Pipelines";
    case "evals":
      return "Evals";
    case "knowledge":
      return "Knowledge";
    case "memory":
      return "Memory";
    case "status":
      return "Status";
    case "playground":
      return agentName ?? "AI Assistant";
  }
}

export function agentLabel(agents: StudioConfig["agents"], agentId: string): string {
  const agent = agents.find((item) => item.id === agentId);
  return agent?.name ?? agentId;
}

export function traceAgentLabel(agents: StudioConfig["agents"], trace: StudioTrace): string {
  if (isRecord(trace.metadata) && typeof trace.metadata.agentName === "string") {
    return trace.metadata.agentName;
  }

  const agentId = traceAgentId(trace);
  return agentId === undefined ? "-" : agentLabel(agents, agentId);
}

export function traceAgentId(trace: StudioTrace): string | undefined {
  if (!isRecord(trace.metadata)) {
    return undefined;
  }
  if (typeof trace.metadata.agentId === "string") {
    return trace.metadata.agentId;
  }
  if (isRecord(trace.metadata.metadata) && typeof trace.metadata.metadata.agentId === "string") {
    return trace.metadata.metadata.agentId;
  }
  return undefined;
}

export function emptyFallback(value: string): string {
  return value.length === 0 ? "-" : value;
}

export function toTraceStatusFilter(value: string): TraceStatusFilter {
  return value === "running" || value === "success" || value === "error" ? value : "all";
}

export function approvalLabel(approval: ToolApproval): string {
  switch (approval.status) {
    case "pending":
      return "Waiting for your decision";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "timed_out":
      return "Timed out";
    case "cancelled":
      return "Cancelled";
    default:
      return approval.status;
  }
}

export function formatToolValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function parseToolDisplayValue(
  value: string,
): { kind: "json"; value: unknown } | { kind: "text"; value: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { kind: "text", value };
  }
  try {
    return { kind: "json", value: JSON.parse(trimmed) };
  } catch {
    return { kind: "text", value };
  }
}

export function titleFromText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
