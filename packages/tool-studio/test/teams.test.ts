import { Agent, AgentTeam } from "@anvia/core/agent";
import {
  Usage,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
} from "@anvia/core/completion";
import { AssistantContent } from "../../core/test/helpers/imports";
import { createQuestionTool, createTool } from "@anvia/core/tool";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Studio, type StudioTeamRunEvent } from "../src/index";

const say = (text: string): CompletionResponse => ({
  choice: [AssistantContent.text(text)],
  usage: Usage.empty(),
  rawResponse: {},
});
const call = (name: string, args = {}): CompletionResponse => ({
  ...say(""),
  choice: [AssistantContent.toolCall(crypto.randomUUID(), name, args)],
});
function model(
  reply: (request: CompletionRequest) => CompletionResponse | Promise<CompletionResponse>,
): CompletionModel {
  return {
    provider: "test",
    modelId: "team",
    capabilities: {
      streaming: false,
      tools: true,
      toolChoice: true,
      imageInput: false,
      documentInput: false,
      outputSchema: true,
      reasoning: false,
    },
    completion: async (request) => reply(request),
  };
}
function post(studio: Studio, path: string, body: unknown = {}) {
  return studio.fetch(
    new Request(`http://studio${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
async function* events(response: Response): AsyncGenerator<StudioTeamRunEvent> {
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line) yield JSON.parse(line) as StudioTeamRunEvent;
      }
    }
  } finally {
    await reader.cancel();
  }
}
async function untilInteraction(iterator: AsyncGenerator<StudioTeamRunEvent>) {
  for await (const event of { [Symbol.asyncIterator]: () => ({ next: () => iterator.next() }) }) {
    if (event.type === "interaction") return event;
    if (event.type === "error") throw new Error(JSON.stringify(event.error));
  }
  throw new Error("No interaction");
}
function approvalTeam(id = "team", siblings = false) {
  const execute = vi.fn(() => "written");
  const write = createTool({
    name: "write",
    description: "Write",
    inputSchema: z.object({}),
    requiresApproval: true,
    execute,
  });
  const worker = new Agent({
    id: "worker",
    tools: [write],
    model: model((request) =>
      JSON.stringify(request.chatHistory).includes('"role":"tool"')
        ? say("worker done")
        : call("write"),
    ),
  });
  const team = new AgentTeam({
    id,
    members: [worker],
    model: model((request) => {
      if (JSON.stringify(request.chatHistory).includes("spawn_worker")) return say("done");
      const response = call("spawn_worker", { prompt: "work" });
      if (siblings) response.choice.push(...call("spawn_worker", { prompt: "more work" }).choice);
      return response;
    }),
    limits: { maxConcurrentAgents: 1 },
  });
  return { team, execute };
}

describe("Studio teams", () => {
  it("registers heterogeneous targets, exposes definitions, and rejects duplicate team IDs", async () => {
    const m = model(() => say('{"answer":"done"}'));
    const team = new AgentTeam({
      id: "team",
      model: m,
      outputSchema: z.object({ answer: z.string() }),
      members: [],
    });
    const studio = new Studio([new Agent({ id: "agent", model: m }), team], { ui: false });
    expect(studio.config().teams).toMatchObject([
      { id: "team", members: [], limits: { maxDepth: 3 } },
    ]);
    expect(await (await studio.fetch(new Request("http://studio/teams"))).json()).toMatchObject({
      teams: [{ id: "team" }],
    });
    expect((await studio.fetch(new Request("http://studio/teams/missing"))).status).toBe(404);
    expect(() => new Studio([team, team], { ui: false })).toThrow("Duplicate Studio team ID");
    const emitted = [];
    for await (const event of events(await post(studio, "/teams/team/runs", { prompt: "start" })))
      emitted.push(event);
    expect(emitted.at(-1)).toMatchObject({ type: "response", output: { answer: "done" } });
    await studio.shutdown();
  });

  it("rejects malformed requests before starting the model", async () => {
    const completion = vi.fn(() => say("done"));
    const studio = new Studio(
      [new AgentTeam({ id: "team", model: model(completion), members: [] })],
      { ui: false },
    );
    for (const body of [
      {},
      { prompt: "" },
      { prompt: "x", messages: [] },
      { prompt: "x", unknown: true },
      { messages: [{ role: "assistant", content: "x" }] },
    ]) {
      expect((await post(studio, "/teams/team/runs", body)).status).toBe(400);
    }
    expect(completion).not.toHaveBeenCalled();
    expect(
      (
        await post(studio, "/teams/team/runs", {
          messages: Array.from({ length: 257 }, () => ({ role: "user", content: "x" })),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await post(studio, "/teams/team/runs", {
          messages: [{ role: "user", content: "x".repeat(1_048_576) }],
        })
      ).status,
    ).toBe(413);
    expect(completion).not.toHaveBeenCalled();
    expect((await post(studio, "/teams/missing/runs", { prompt: "x" })).status).toBe(404);
    await studio.shutdown();
    expect((await post(studio, "/teams/team/runs", { prompt: "x" })).status).toBe(503);
  });

  it("routes approval to its active run, validates replies, and permits steering while waiting", async () => {
    const { team, execute } = approvalTeam();
    const other = approvalTeam("other").team;
    const studio = new Studio([team, other], { ui: false });
    const response = await post(studio, "/teams/team/runs", { prompt: "start" });
    const runId = response.headers.get("x-anvia-team-run-id")!;
    const iterator = events(response);
    const interaction = await untilInteraction(iterator);
    const route = `/teams/team/runs/${runId}/interactions/${interaction.interaction.id}`;
    expect(execute).not.toHaveBeenCalled();
    expect(
      (
        await post(studio, route.replace("/team/", "/other/"), {
          type: "tool-approval",
          approved: true,
        })
      ).status,
    ).toBe(404);
    expect((await post(studio, route, { type: "tool-question", answers: [] })).status).toBe(400);
    expect(
      (await post(studio, `/teams/team/runs/${runId}/steer`, { prompt: "Follow-up from user" }))
        .status,
    ).toBe(200);
    expect((await post(studio, route, { type: "tool-approval", approved: true })).status).toBe(200);
    expect([404, 409]).toContain(
      (await post(studio, route, { type: "tool-approval", approved: true })).status,
    );
    const emitted = [];
    for await (const event of iterator) emitted.push(event);
    expect(emitted.at(-1)).toMatchObject({ type: "response", members: [{ status: "idle" }] });
    expect(JSON.stringify(emitted)).not.toContain('"continuation"');
    expect(execute).toHaveBeenCalledOnce();
    expect((await post(studio, `/teams/team/runs/${runId}/steer`, { prompt: "late" })).status).toBe(
      404,
    );
    await studio.shutdown();
  });

  it.each(["cancel", "disconnect", "shutdown"])(
    "cleans up pending approvals on %s",
    async (action) => {
      const { team, execute } = approvalTeam();
      const studio = new Studio([team], { ui: false });
      const response = await post(studio, "/teams/team/runs", { prompt: "start" });
      const runId = response.headers.get("x-anvia-team-run-id")!;
      const iterator = events(response);
      const interaction = await untilInteraction(iterator);
      if (action === "cancel") {
        expect((await post(studio, `/teams/team/runs/${runId}/cancel`)).status).toBe(200);
        const emitted = [];
        for await (const event of iterator) emitted.push(event);
        expect(emitted.at(-1)).toMatchObject({ type: "error" });
      } else if (action === "disconnect") await iterator.return(undefined);
      else await studio.shutdown({ timeoutMs: 1000 });
      await studio.shutdown({ timeoutMs: 1000 });
      expect(
        (
          await post(
            studio,
            `/teams/team/runs/${runId}/interactions/${interaction.interaction.id}`,
            { type: "tool-approval", approved: true },
          )
        ).status,
      ).toBe(404);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("resumes a team after a valid user question answer", async () => {
    const ask = createQuestionTool({ name: "ask", description: "Ask the user" });
    const team = new AgentTeam({
      id: "team",
      members: [],
      tools: [ask],
      model: model((request) =>
        JSON.stringify(request.chatHistory).includes('"role":"tool"')
          ? say("answered")
          : call("ask", { questions: [{ id: "scope", text: "What scope?" }] }),
      ),
    });
    const studio = new Studio([team], { ui: false });
    const response = await post(studio, "/teams/team/runs", { prompt: "start" });
    const iterator = events(response);
    const event = await untilInteraction(iterator);
    expect(event.interaction.type).toBe("tool-question");
    expect(
      (
        await post(
          studio,
          `/teams/team/runs/${response.headers.get("x-anvia-team-run-id")}/interactions/${event.interaction.id}`,
          { type: "tool-question", answers: [{ questionId: "scope", value: "Runtime" }] },
        )
      ).status,
    ).toBe(200);
    const emitted = [];
    for await (const next of iterator) emitted.push(next);
    expect(emitted.at(-1)).toMatchObject({ type: "response", output: "answered" });
    await studio.shutdown();
  });

  it("keeps simultaneous approvals independent", async () => {
    const { team, execute } = approvalTeam();
    const studio = new Studio([team], { ui: false });
    const responses = await Promise.all([
      post(studio, "/teams/team/runs", { prompt: "one" }),
      post(studio, "/teams/team/runs", { prompt: "two" }),
    ]);
    const iterators = responses.map(events);
    const interactions = await Promise.all(iterators.map(untilInteraction));
    for (const [index, response] of responses.entries()) {
      const route = `/teams/team/runs/${response.headers.get("x-anvia-team-run-id")}/interactions/${interactions[index]!.interaction.id}`;
      expect(
        (await post(studio, route, { type: "tool-approval", approved: index === 0 })).status,
      ).toBe(200);
    }
    for (const iterator of iterators) {
      const emitted = [];
      for await (const event of iterator) emitted.push(event);
      expect(emitted.at(-1)).toMatchObject({ type: "response" });
    }
    expect(execute).toHaveBeenCalledOnce();
    await studio.shutdown();
  });

  it("resolves simultaneous sibling approvals separately within one run", async () => {
    const { team, execute } = approvalTeam("team", true);
    const studio = new Studio([team], { ui: false });
    const response = await post(studio, "/teams/team/runs", { prompt: "start" });
    const iterator = events(response);
    const first = await untilInteraction(iterator);
    const second = await untilInteraction(iterator);
    expect(first.instanceId).not.toBe(second.instanceId);
    for (const [index, event] of [first, second].entries()) {
      const route = `/teams/team/runs/${response.headers.get("x-anvia-team-run-id")}/interactions/${event.interaction.id}`;
      expect(
        (await post(studio, route, { type: "tool-approval", approved: index === 0 })).status,
      ).toBe(200);
    }
    const emitted = [];
    for await (const event of iterator) emitted.push(event);
    expect(emitted.at(-1)).toMatchObject({
      type: "response",
      members: [{ status: "idle" }, { status: "idle" }],
    });
    expect(execute).toHaveBeenCalledOnce();
    await studio.shutdown();
  });

  it("cancels a pending stream read even when the model ignores abort", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const team = new AgentTeam({
      id: "team",
      members: [],
      model: model(() => {
        started();
        return new Promise(() => {});
      }),
    });
    const studio = new Studio([team], { ui: false });
    const response = await post(studio, "/teams/team/runs", { prompt: "start" });
    const reader = response.body!.getReader();
    await reader.read();
    await ready;
    const pending = reader.read();
    await reader.cancel();
    await pending;
    await studio.shutdown({ timeoutMs: 1000 });
    expect(
      (await post(studio, `/teams/team/runs/${response.headers.get("x-anvia-team-run-id")}/cancel`))
        .status,
    ).toBe(404);
  });
});
