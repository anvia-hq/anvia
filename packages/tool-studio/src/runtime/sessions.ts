import type { JsonObject } from "@anvia/core/completion";
import type { Context, Hono } from "hono";
import type { StudioAgent, StudioSessionStore, StudioTraceStore } from "../types";
import { appendSessionLog, sessionCreatedLog } from "./session-logs";
import {
  errorResponse,
  isJsonObject,
  isObject,
  optionalQueryString,
  parseLimit,
  unsupportedCapability,
} from "./shared";

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

    const sessions = await props.sessionStore.listSessions({
      ...(agentId === undefined ? {} : { agentId }),
      limit,
    });
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

    const session = await props.sessionStore.createSession({
      id: globalThis.crypto.randomUUID(),
      agentId: body.agentId,
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    });
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

    const limit = parseSessionLogLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }
    const after = parseSessionLogAfter(c.req.query("after"));
    if (after === false) {
      return errorResponse(c, 400, "bad_request", "after must be a non-negative integer");
    }

    const logs = await props.sessionStore.listSessionLogs({
      sessionId,
      limit,
      ...(after === undefined ? {} : { after }),
    });
    const last = logs.at(-1);
    return c.json({
      logs,
      ...(logs.length === limit && last !== undefined ? { nextCursor: last.sequence } : {}),
    });
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

function parseSessionLogLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return 200;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    return undefined;
  }
  return Math.min(limit, 1000);
}

function parseSessionLogAfter(value: string | undefined): number | undefined | false {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const after = Number(value);
  if (!Number.isInteger(after) || after < 0) {
    return false;
  }
  return after;
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
