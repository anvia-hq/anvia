import type { GraphExploreOptions, GraphSchemaLike } from "@anvia/graph";
import { resolveGraphExploreOptions } from "@anvia/graph/explore";
import type { Context, Hono } from "hono";
import type { StudioGraphExploreRequest, StudioGraphRegistration } from "../types";
import { graphConfig } from "./config";
import { errorResponse, parseJsonBody } from "./http";
import { isObject } from "./type-guards";

export function registerGraphRoutes(
  app: Hono,
  registrations: readonly StudioGraphRegistration[],
): void {
  const graphs = graphRegistry(registrations);
  app.get("/graphs", (c) => c.json({ graphs: [...graphs.values()].map(graphConfig) }));
  app.post("/graphs/:graphId/explore", async (c) => {
    const registration = graphs.get(c.req.param("graphId"));
    if (registration === undefined) {
      return errorResponse(c, 404, "not_found", "Graph not found");
    }
    const body = await parseJsonBody(c, (value) => parseExploreRequest(c, value));
    if ("error" in body) return body.error;
    const input = exploreOptionsWithSignal(body, c.req.raw.signal);
    let options: ReturnType<typeof resolveGraphExploreOptions>;
    try {
      options = resolveGraphExploreOptions(registration.graph.schema, input);
    } catch (error) {
      return errorResponse(
        c,
        400,
        "bad_request",
        error instanceof Error ? error.message : "Invalid graph exploration request",
      );
    }
    return c.json(await registration.graph.explore(options));
  });
}

function graphRegistry(
  registrations: readonly StudioGraphRegistration[],
): Map<string, StudioGraphRegistration> {
  const graphs = new Map<string, StudioGraphRegistration>();
  for (const registration of registrations) {
    if (typeof registration.id !== "string" || registration.id.length === 0) {
      throw new TypeError("Studio graph id must be a non-empty string.");
    }
    if (graphs.has(registration.id)) {
      throw new TypeError(`Duplicate Studio graph id: ${registration.id}.`);
    }
    graphs.set(registration.id, registration);
  }
  return graphs;
}

function parseExploreRequest(
  c: Context,
  value: unknown,
): StudioGraphExploreRequest | { error: Response } {
  if (!isObject(value) || (value.mode !== "overview" && value.mode !== "expand")) {
    return { error: errorResponse(c, 400, "bad_request", "mode must be overview or expand") };
  }
  const common = parseCommonOptions(c, value);
  if ("error" in common) return common;
  if (value.mode === "overview") return { ...common, mode: "overview" };
  const nodeIds = stringList(value.nodeIds);
  if (nodeIds === undefined) {
    return { error: errorResponse(c, 400, "bad_request", "nodeIds must be a string array") };
  }
  const request: Extract<StudioGraphExploreRequest, { mode: "expand" }> = {
    ...common,
    mode: "expand",
    nodeIds,
  };
  if (
    value.direction === "outgoing" ||
    value.direction === "incoming" ||
    value.direction === "both"
  ) {
    request.direction = value.direction;
  } else if (value.direction !== undefined) {
    return {
      error: errorResponse(c, 400, "bad_request", "direction must be outgoing, incoming, or both"),
    };
  }
  if (typeof value.maxDepth === "number") request.maxDepth = value.maxDepth;
  else if (value.maxDepth !== undefined) {
    return { error: errorResponse(c, 400, "bad_request", "maxDepth must be a number") };
  }
  return request;
}

function parseCommonOptions(
  c: Context,
  value: Record<string, unknown>,
):
  | Omit<StudioGraphExploreRequest, "mode" | "nodeIds" | "direction" | "maxDepth">
  | {
      error: Response;
    } {
  const request: {
    nodeTypes?: string[];
    relationships?: string[];
    maxNodes?: number;
    maxRelationships?: number;
  } = {};
  for (const [key, label] of [
    ["nodeTypes", "nodeTypes"],
    ["relationships", "relationships"],
  ] as const) {
    const selected = value[key];
    if (selected === undefined) continue;
    const values = stringList(selected);
    if (values === undefined) {
      return { error: errorResponse(c, 400, "bad_request", `${label} must be a string array`) };
    }
    request[key] = values;
  }
  for (const [key, label] of [
    ["maxNodes", "maxNodes"],
    ["maxRelationships", "maxRelationships"],
  ] as const) {
    const selected = value[key];
    if (selected === undefined) continue;
    if (typeof selected !== "number") {
      return { error: errorResponse(c, 400, "bad_request", `${label} must be a number`) };
    }
    request[key] = selected;
  }
  return request;
}

function exploreOptionsWithSignal(
  request: StudioGraphExploreRequest,
  abortSignal: AbortSignal,
): GraphExploreOptions<GraphSchemaLike> {
  return { ...request, abortSignal };
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value;
}
