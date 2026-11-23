import { z } from "zod";
import type { DecisionOptions } from "../decision/types";
import type { AgentTraceOptions } from "../observability";
import type { PipelineTraceInfo } from "./types";

export function withPipelineParentTrace(
  trace: AgentTraceOptions | undefined,
  parent: PipelineTraceInfo | undefined,
  agentPrimaryTrace: string | undefined,
): AgentTraceOptions | undefined {
  if (parent?.traceId === undefined) return trace;

  if (parent.observer !== agentPrimaryTrace) return trace;

  if (trace?.traceId !== undefined && trace.traceId !== parent.traceId) return trace;

  const resolved = { ...trace, traceId: parent.traceId };

  if (trace?.parentObservationId === undefined && parent.observationId !== undefined) {
    resolved.parentObservationId = parent.observationId;
  }

  return resolved;
}

export function isZodSchema(value: unknown): value is z.ZodType {
  return value instanceof z.ZodType;
}

export function normalizePipelineId(id: string): string {
  if (typeof id !== "string") {
    throw new TypeError("Pipeline id must be a string.");
  }

  const normalized = id.trim();

  if (normalized.length === 0) {
    throw new TypeError("Pipeline id must be a non-empty string.");
  }

  return normalized;
}

export function normalizeRunId(runId: string): string {
  if (typeof runId !== "string") {
    throw new TypeError("Pipeline runId must be a string.");
  }

  const normalized = runId.trim();

  if (normalized.length === 0) {
    throw new TypeError("Pipeline runId must be a non-empty string.");
  }

  return normalized;
}

export function normalizeBranches<Branch>(
  branches: Readonly<Record<string, Branch>>,
  kind: "parallel" | "route",
): Array<readonly [string, Branch]> {
  const entries: Array<readonly [string, Branch]> = [];
  const ids = new Set<string>();
  for (const key of Object.keys(branches)) {
    const pipeline = branches[key] as Branch;
    const id = key.trim();

    if (id.length === 0) {
      throw new TypeError(`Pipeline ${kind} branch id must be a non-empty string.`);
    }

    if (ids.has(id)) {
      throw new TypeError(`Pipeline ${kind} branch id "${id}" is already registered.`);
    }

    ids.add(id);

    if (id !== key) {
      throw new TypeError(`Pipeline ${kind} branch ids must not contain surrounding whitespace.`);
    }

    entries.push([id, pipeline]);
  }
  return entries;
}

export function assertRouteBranchesMatchOptions(
  routeId: string,
  branchEntries: ReadonlyArray<readonly [string, unknown]>,
  options: DecisionOptions,
): void {
  const branchKeys = new Set(branchEntries.map(([key]) => key));
  for (const label of Object.keys(options)) {
    if (!branchKeys.has(label)) {
      throw new TypeError(`Pipeline route "${routeId}" is missing a branch for option "${label}".`);
    }
  }
  for (const key of branchKeys) {
    if (!Object.hasOwn(options, key)) {
      throw new TypeError(
        `Pipeline route "${routeId}" branch "${key}" is not an option of its question.`,
      );
    }
  }
}
