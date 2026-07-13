import type { JsonObject } from "@anvia/core/completion";
import type { Context, Hono } from "hono";
import type { StudioAgent, StudioSessionStore, StudioTraceStore } from "../types";
import { errorResponse, unsupportedCapability } from "./http";
import { optionalQueryString, parseAfter, parseLimit } from "./query";
import { appendSessionLog, sessionCreatedLog } from "./session-logs";
import { isJsonObject, isObject } from "./type-guards";

export function registerSessionRoutes(
  app: Hono,
  props: {
    agentMap: Map<string, StudioAgent>;
    sessionStore: StudioSessionStore;
    traceStore?: StudioTraceStore;
  },
): void {
  app.get("/sessions", async (c) => {
    const agentId = optionalQueryString(c.req.query("agentId"));
    if (agentId !== undefined && !props.agentMap.has(agentId)) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }

    const limit = parseLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }

    const listInput: Parameters<typeof props.sessionStore.listSessions>[0] = { limit };
    if (agentId !== undefined) listInput.agentId = agentId;
    const sessions = await props.sessionStore.listSessions(listInput);
    return c.json({ sessions });
  });

  app.post("/sessions", async (c) => {
    const body = await parseCreateSessionRequest(c);
    if ("error" in body) {
      return body.error;
    }
    if (!props.agentMap.has(body.agentId)) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }

    const createInput: Parameters<typeof props.sessionStore.createSession>[0] = {
      id: globalThis.crypto.randomUUID(),
      agentId: body.agentId,
    };
    if (body.title !== undefined) createInput.title = body.title;
    if (body.metadata !== undefined) createInput.metadata = body.metadata;
    const session = await props.sessionStore.createSession(createInput);
    await appendSessionLog(props.sessionStore, sessionCreatedLog(session));
    return c.json(session, 201);
  });

  app.get("/sessions/:sessionId", async (c) => {
    const session = await props.sessionStore.getSession(c.req.param("sessionId"));
    if (session === undefined) {
      return errorResponse(c, 404, "not_found", "Session not found");
    }
    return c.json(session);
  });

  app.get("/sessions/:sessionId/logs", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await props.sessionStore.getSession(sessionId);
    if (session === undefined) {
      return errorResponse(c, 404, "not_found", "Session not found");
    }
    if (props.sessionStore.listSessionLogs === undefined) {
      return errorResponse(
        c,
        501,
        "unsupported_capability",
        'Capability "sessions.logs" is not implemented by this runner',
        { capability: "sessions", operation: "logs" },
      );
    }

    const limit = parseLimit(c.req.query("limit"), 200, 1000);
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }
    const after = parseAfter(c.req.query("after"));
    if (after === false) {
      return errorResponse(c, 400, "bad_request", "after must be a non-negative integer");
    }

    const listInput: Parameters<NonNullable<typeof props.sessionStore.listSessionLogs>>[0] = {
      sessionId,
      limit,
    };
    if (after !== undefined) listInput.after = after;
    const logs = await props.sessionStore.listSessionLogs(listInput);
    const last = logs.at(-1);
    const response: { logs: typeof logs; nextCursor?: number } = { logs };
    if (logs.length === limit && last !== undefined) response.nextCursor = last.sequence;
    return c.json(response);
  });

  app.delete("/sessions/:sessionId", async (c) => {
    if (props.sessionStore.deleteSession === undefined) {
      return errorResponse(
        c,
        501,
        "unsupported_capability",
        'Capability "sessions.delete" is not implemented by this runner',
        { capability: "sessions", operation: "delete" },
      );
    }

    const deleted = await props.sessionStore.deleteSession(c.req.param("sessionId"));
    if (!deleted) {
      return errorResponse(c, 404, "not_found", "Session not found");
    }
    return c.body(null, 204);
  });

  app.get("/sessions/:sessionId/traces", async (c) => {
    if (props.traceStore === undefined) {
      return unsupportedCapability(c, "traces");
    }
    const sessionId = c.req.param("sessionId");
    const session = await props.sessionStore.getSession(sessionId);
    if (session === undefined) {
      return errorResponse(c, 404, "not_found", "Session not found");
    }

    const limit = parseLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }

    const traces = await props.traceStore.listSessionTraces({ sessionId, limit });
    return c.json({ traces });
  });
}

async function parseCreateSessionRequest(c: Context): Promise<
  | {
      agentId: string;
      title?: string;
      metadata?: JsonObject;
    }
  | { error: Response }
> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be JSON") };
  }

  if (!isObject(body)) {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be an object") };
  }

  if (typeof body.agentId !== "string" || body.agentId.trim().length === 0) {
    return { error: errorResponse(c, 400, "bad_request", "agentId must be a string") };
  }

  const request: { agentId: string; title?: string; metadata?: JsonObject } = {
    agentId: body.agentId.trim(),
  };
  if ("title" in body) {
    if (typeof body.title !== "string") {
      return { error: errorResponse(c, 400, "bad_request", "title must be a string") };
    }
    const title = body.title.trim();
    if (title.length > 0) {
      request.title = title;
    }
  }
  if ("metadata" in body) {
    if (!isJsonObject(body.metadata)) {
      return { error: errorResponse(c, 400, "bad_request", "metadata must be an object") };
    }
    request.metadata = body.metadata;
  }
  return request;
}
