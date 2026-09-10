import type { AgentTeam } from "@anvia/core/agent";
import { parseAgentInteractionResponse } from "@anvia/core/agent/interactions";
import { parseMessages } from "@anvia/core/completion";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { StudioTeamConfig, StudioTeamRunRequest } from "../team-types";
import { errorResponse, parseJsonBody } from "./http";
import { serializeError } from "./errors";
import { toJsonValue } from "./json";
import { streamStudioJsonl } from "./streams";
import { StudioTeamRun } from "./team-run";
import type { StudioRunLifecycle } from "./run-lifecycle";

export function teamConfig(team: AgentTeam<unknown>): StudioTeamConfig {
  return {
    id: team.id,
    members: team.members.map((member) => {
      const view: { id: string; name?: string; description?: string } = { id: member.id };
      if (member.name !== undefined) view.name = member.name;
      if (member.description !== undefined) view.description = member.description;
      return view;
    }),
    limits: team.limits,
  };
}

const inputSchema = z
  .object({
    prompt: z.string().min(1).max(32_768).optional(),
    messages: z.array(z.unknown()).min(1).optional(),
  })
  .strict()
  .refine(
    (input) => (input.prompt === undefined) !== (input.messages === undefined),
    "Provide exactly one of prompt or messages.",
  );

function parseInput(body: unknown): StudioTeamRunRequest {
  if (
    typeof body === "object" &&
    body !== null &&
    "messages" in body &&
    Array.isArray(body.messages) &&
    body.messages.length > 256
  )
    throw new RangeError("Team input accepts at most 256 messages.");
  const input = inputSchema.parse(body);
  if (input.prompt !== undefined) return { prompt: input.prompt };
  const messages = parseMessages(input.messages!);
  if (messages.at(-1)?.role !== "user")
    throw new TypeError("Team input must end with a user message.");
  return { messages };
}

function readBody<T>(c: Context, parse: (body: unknown) => T) {
  return parseJsonBody(c, (body) => {
    try {
      return parse(body);
    } catch (error) {
      return {
        error: errorResponse(
          c,
          error instanceof RangeError ? 413 : 400,
          error instanceof RangeError ? "payload_too_large" : "bad_request",
          error instanceof Error ? error.message : "Invalid input.",
        ),
      };
    }
  });
}

export function registerTeamRoutes(
  app: Hono,
  teams: readonly AgentTeam<unknown>[],
  lifecycle: StudioRunLifecycle,
): void {
  const catalog = new Map<string, AgentTeam<unknown>>();
  for (const team of teams) {
    if (catalog.has(team.id)) throw new TypeError(`Duplicate Studio team ID "${team.id}".`);
    catalog.set(team.id, team);
  }
  const runs = new Map<string, StudioTeamRun>();
  app.use(
    "/teams/*",
    bodyLimit({
      maxSize: 1_048_576,
      onError: (c) =>
        errorResponse(c, 413, "payload_too_large", "Team request body exceeds 1 MiB."),
    }),
  );
  app.get("/teams", (c) => c.json({ teams: teams.map(teamConfig) }));
  app.get("/teams/:teamId", (c) => {
    const team = catalog.get(c.req.param("teamId"));
    return team === undefined
      ? errorResponse(c, 404, "not_found", "Team not found.")
      : c.json(teamConfig(team));
  });
  app.post("/teams/:teamId/runs", async (c) => {
    const team = catalog.get(c.req.param("teamId"));
    if (team === undefined) return errorResponse(c, 404, "not_found", "Team not found.");
    const input = await readBody(c, parseInput);
    if ("error" in input) return input.error;
    const lease = lifecycle.start(c.req.raw.signal);
    if (lease === undefined)
      return errorResponse(c, 503, "service_unavailable", "Studio is shutting down.");
    let run: StudioTeamRun;
    try {
      run = new StudioTeamRun(team.id, team, input, lease, () => runs.delete(run.id));
    } catch (error) {
      lease.finish();
      return errorResponse(
        c,
        400,
        "bad_request",
        error instanceof Error ? error.message : "Invalid run.",
      );
    }
    runs.set(run.id, run);
    // Preserve core's attributed event union. Normalize nested errors before JSON encoding.
    const events = run.events();
    const iterator = events[Symbol.asyncIterator]();
    const response = streamStudioJsonl({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          const next = await iterator.next();
          if (next.done) return next;
          const event = next.value;
          if ("member" in event && event.member.error !== undefined)
            return {
              done: false,
              value: toJsonValue({
                ...event,
                member: { ...event.member, error: serializeError(event.member.error) },
              }),
            };
          if (event.type === "agent_event" && event.event.type === "error")
            return {
              done: false,
              value: toJsonValue({
                ...event,
                event: { ...event.event, error: serializeError(event.event.error) },
              }),
            };
          if (event.type === "response" || event.type === "blocked")
            return {
              done: false,
              value: toJsonValue({
                ...event,
                members: event.members.map((member) => {
                  const view = { ...member };
                  if (member.error !== undefined) view.error = serializeError(member.error);
                  return view;
                }),
              }),
            };
          return { done: false, value: toJsonValue(event) };
        },
        return: async () => {
          await iterator.return?.();
          return { done: true, value: undefined };
        },
      }),
    });
    response.headers.set("x-anvia-team-run-id", run.id);
    return response;
  });
  const findRun = (c: Context) => {
    const run = runs.get(c.req.param("runId")!);
    return run?.teamId === c.req.param("teamId") ? run : undefined;
  };
  app.post("/teams/:teamId/runs/:runId/steer", async (c) => {
    const run = findRun(c);
    if (run === undefined) return errorResponse(c, 404, "not_found", "Active team run not found.");
    const input = await readBody(c, parseInput);
    if ("error" in input) return input.error;
    try {
      return c.json(run.steer(input));
    } catch (error) {
      return errorResponse(
        c,
        400,
        "bad_request",
        error instanceof Error ? error.message : "Cannot steer this run.",
      );
    }
  });
  app.post("/teams/:teamId/runs/:runId/cancel", (c) => {
    const run = findRun(c);
    if (run === undefined) return errorResponse(c, 404, "not_found", "Active team run not found.");
    run.cancel();
    return c.json({ status: "cancelled" });
  });
  app.post("/teams/:teamId/runs/:runId/interactions/:interactionId", async (c) => {
    const run = findRun(c);
    if (run === undefined) return errorResponse(c, 404, "not_found", "Active team run not found.");
    const response = await readBody(c, parseAgentInteractionResponse);
    if ("error" in response) return response.error;
    try {
      const status = run.respond(c.req.param("interactionId"), response);
      if (status === "missing")
        return errorResponse(c, 404, "not_found", "Pending interaction not found.");
      if (status === "claimed")
        return errorResponse(c, 409, "conflict", "Interaction already answered.");
      return c.json({ status });
    } catch (error) {
      return errorResponse(
        c,
        400,
        "bad_request",
        error instanceof Error ? error.message : "Invalid interaction response.",
      );
    }
  });
}
