import type { Hono } from "hono";
import type { StudioTraceStore } from "../types";
import { errorResponse, optionalQueryString, parseLimit, parseTraceStatus } from "./shared";

export function registerTraceRoutes(app: Hono, traceStore: StudioTraceStore): void {
  app.get("/traces", async (c) => {
    if (traceStore.listTraces === undefined) {
      return errorResponse(
        c,
        501,
        "unsupported_capability",
        'Capability "traces.list" is not implemented by this runner',
        { capability: "traces", operation: "list" },
      );
    }

    const limit = parseLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }

    const status = parseTraceStatus(c.req.query("status"));
    if (status === false) {
      return errorResponse(c, 400, "bad_request", "status must be running, success, or error");
    }

    const agentId = optionalQueryString(c.req.query("agentId"));
    const sessionId = optionalQueryString(c.req.query("sessionId"));
    const traces = await traceStore.listTraces({
      limit,
      ...(agentId === undefined ? {} : { agentId }),
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(status === undefined ? {} : { status }),
    });
    return c.json({ traces });
  });

  app.get("/traces/:traceId", async (c) => {
    const trace = await traceStore.getTrace(c.req.param("traceId"));
    if (trace === undefined) {
      return errorResponse(c, 404, "not_found", "Trace not found");
    }
    return c.json(trace);
  });
}
