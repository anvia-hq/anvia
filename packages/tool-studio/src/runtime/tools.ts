import type { Context, Hono } from "hono";
import type {
  StudioAgent,
  StudioAgentToolMetadata,
  StudioToolRunRequest,
  StudioToolRunResponse,
} from "../types";
import { serializeUnknown, toJsonValue } from "./json";
import { errorResponse } from "./http";
import { isJsonObject, isJsonValue } from "./type-guards";
import { agentToolItems, approvalMetadata } from "./tool-metadata";

export function registerToolRoutes(
  app: Hono,
  props: {
    agentMap: Map<string, StudioAgent>;
  },
): void {
  app.get("/agents/:agentId/tools", async (c) => {
    const agentId = c.req.param("agentId");
    const agent = props.agentMap.get(agentId);
    if (agent === undefined) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }

    return c.json({
      agentId,
      tools: await agentToolMetadata(agent),
    });
  });

  app.post("/agents/:agentId/tools/:toolName/runs", async (c) => {
    const agentId = c.req.param("agentId");
    const toolName = c.req.param("toolName");
    const agent = props.agentMap.get(agentId);
    if (agent === undefined) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }
    if (agent.agent.getTool(toolName) === undefined) {
      return errorResponse(c, 404, "not_found", "Tool not found");
    }

    const body = await parseToolRunRequest(c);
    if ("error" in body) {
      return body.error;
    }

    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const events: unknown[] = [];
    try {
      const result = await agent.agent.callTool(toolName, JSON.stringify(body.args), {
        emitStreamEvent(event) {
          events.push(event);
        },
      });
      const ended = Date.now();
      return c.json({
        agentId,
        toolName,
        status: "success",
        result: toJsonValue(result),
        durationMs: ended - started,
        startedAt,
        endedAt: new Date(ended).toISOString(),
        events: events.map(toJsonValue),
      } satisfies StudioToolRunResponse);
    } catch (error) {
      const ended = Date.now();
      return c.json(
        {
          agentId,
          toolName,
          status: "error",
          error: serializeUnknown(error),
          durationMs: ended - started,
          startedAt,
          endedAt: new Date(ended).toISOString(),
          events: events.map(toJsonValue),
        } satisfies StudioToolRunResponse,
        500,
      );
    }
  });
}

async function parseToolRunRequest(
  c: Context,
): Promise<StudioToolRunRequest | { error: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be JSON") };
  }
  if (body === undefined || body === null) {
    return { args: {} } satisfies StudioToolRunRequest;
  }
  if (!isJsonObject(body)) {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be an object") };
  }
  const args = Object.hasOwn(body, "args") ? body.args : {};
  if (!isJsonValue(args)) {
    return { error: errorResponse(c, 400, "bad_request", "args must be JSON-compatible") };
  }
  const request: StudioToolRunRequest = { args };
  if (Object.hasOwn(body, "context")) {
    if (!isJsonObject(body.context)) {
      return { error: errorResponse(c, 400, "bad_request", "context must be an object") };
    }
    request.context = body.context;
  }
  return request;
}

export async function agentToolMetadata(agent: StudioAgent): Promise<StudioAgentToolMetadata[]> {
  const seen = new Set<string>();
  const metadata: StudioAgentToolMetadata[] = [];
  for (const { tool, source } of agentToolItems(agent)) {
    const key = `${source}:${tool.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const definition = await tool.definition("");
    metadata.push({
      agentId: agent.id,
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      source,
      approval: approvalMetadata(tool),
    });
  }

  return metadata.sort((left, right) => {
    if (left.source !== right.source) {
      return left.source === "static" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}
