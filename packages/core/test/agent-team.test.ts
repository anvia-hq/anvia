import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  Agent,
  AgentTeam,
  AgentTeamInteractionError,
  AgentTeamLimitError,
  AgentRunCancelledError,
  AssistantContent,
  createTool,
  Usage,
  defineGuardrailPolicy,
  defineInputGuardrail,
  type AgentTeamEvent,
  type AgentTeamMember,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionModelStreamEvent,
} from "./helpers/imports";

type Reply =
  | CompletionResponse
  | ((request: CompletionRequest) => CompletionResponse | Promise<CompletionResponse>);

class ScriptModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "team-test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: true,
    reasoning: false,
  };
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly replies: Reply[]) {}
  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error("No scripted response");
    return typeof reply === "function" ? reply(request) : reply;
  }
}

function response(...choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: { ...Usage.empty(), inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    rawResponse: {},
  };
}
const say = (text: string) => response(AssistantContent.text(text));
const call = (name: string, args = {}) =>
  response(AssistantContent.toolCall(crypto.randomUUID(), name, args));
const history = (request: CompletionRequest) => JSON.stringify(request.chatHistory);
class StreamingScriptModel extends ScriptModel {
  override readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: true,
    reasoning: false,
  };
  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    const reply = await super.completion(request);
    for (const part of reply.choice) {
      if (part.type === "text") yield { type: "text_delta", delta: part.text };
    }
    yield { type: "final", response: reply };
  }
}
function instanceFrom(request: CompletionRequest): string {
  const match = history(request).match(/instanceId\\?":\\?"([^"\\]+)/);
  if (!match?.[1]) throw new Error("No instance ID in history");
  return match[1];
}

describe("AgentTeam", () => {
  it("accepts full Agents with different schemas and model controls", () => {
    class ControlledModel extends ScriptModel {
      readonly controls = {
        reasoningEffort: {
          type: "select" as const,
          label: "Effort",
          options: ["low", "high"] as const,
        },
      };
      override async completion(request: CompletionRequest) {
        return { ...(await super.completion(request)), rawResponse: { requestId: "typed" } };
      }
    }
    const model = new ScriptModel([]);
    const controlledModel = new ControlledModel([]);
    const text = new Agent({ id: "text", model });
    const structured = new Agent({
      id: "structured",
      model: controlledModel,
      controls: { reasoningEffort: "high" },
      outputSchema: z.object({ answer: z.string() }),
      lifecycle: {
        onStepFinish: (event) => {
          expectTypeOf(event.response.rawResponse.requestId).toEqualTypeOf<string>();
        },
        onFinish: (event) => {
          if (event.status === "completed")
            expectTypeOf(event.output.answer).toEqualTypeOf<string>();
        },
      },
    });
    const numeric = new Agent({ id: "numeric", model, outputSchema: z.number() });
    const members: AgentTeamMember[] = [text, structured, numeric];
    expect(new AgentTeam({ id: "lead", model, members }).members).toEqual(members);
  });

  it("rejects partial Agent records at both the type and runtime boundaries", () => {
    const model = new ScriptModel([]);
    const partial = { id: "worker", name: undefined, description: undefined, model, tools: [] };
    expect(
      () =>
        new AgentTeam({
          id: "lead",
          model,
          // @ts-expect-error Members must be full Agent definitions, not partial records.
          members: [partial],
        }),
    ).toThrow("AgentTeam members must be Agent instances.");
  });

  it("preserves typed coordinator output and exposes both public entrypoints", async () => {
    const model = new ScriptModel([say('{"answer":"done"}')]);
    const team = new AgentTeam({
      id: "lead",
      model,
      members: [],
      outputSchema: z.object({ answer: z.string() }),
    });
    const result = await team.generate({ prompt: "start" });
    if (result.type !== "response") throw new Error("Expected response");
    expectTypeOf(result.output).toEqualTypeOf<{ answer: string }>();
    expect(result.output).toEqual({ answer: "done" });
    expect(result.members).toEqual([]);
    expect(result.usage.totalTokens).toBe(3);
    expect((await import("../src/index")).AgentTeam).toBe(AgentTeam);
  });

  it("rejects duplicate definitions, invalid limits, and coordination tool collisions", () => {
    const model = new ScriptModel([]);
    const member = new Agent({ id: "worker", model });
    expect(() => new AgentTeam({ id: "lead", model, members: [member, member] })).toThrow(
      "Duplicate",
    );
    expect(
      () => new AgentTeam({ id: "lead", model, members: [], limits: { maxConcurrentAgents: 0 } }),
    ).toThrow();
    const conflict = createTool({
      name: "send_message",
      description: "conflict",
      inputSchema: z.object({}),
      execute: () => "x",
    });
    expect(() => new AgentTeam({ id: "lead", model, members: [], tools: [conflict] })).toThrow(
      "conflicts",
    );
  });

  it("automatically waits with one slot and gives the coordinator member outcomes", async () => {
    const workerModel = new ScriptModel([say("research result")]);
    const worker = new Agent({ id: "researcher", model: workerModel });
    const model = new ScriptModel([
      call("spawn_researcher", { prompt: "research" }),
      say("provisional answer"),
      (request) => {
        expect(history(request)).toContain("research result");
        return say("final answer");
      },
    ]);
    const result = await new AgentTeam({
      id: "lead",
      model,
      members: [worker],
      limits: { maxConcurrentAgents: 1 },
    }).generate({ prompt: "start" });
    expect(result).toMatchObject({
      type: "response",
      output: "final answer",
      usage: { totalTokens: 12 },
    });
    expect(result.members).toMatchObject([
      { agentId: "researcher", status: "idle", outcome: { output: "research result" } },
    ]);
    expect(worker.tools).toEqual([]);
  });

  it("creates independent instances from one definition without leaking histories", async () => {
    const workerModel = new ScriptModel([
      (request) => {
        expect(history(request)).toContain("task A");
        expect(history(request)).not.toContain("task B");
        return say("result A");
      },
      (request) => {
        expect(history(request)).toContain("task B");
        expect(history(request)).not.toContain("task A");
        return say("result B");
      },
    ]);
    const worker = new Agent({ id: "specialist", model: workerModel });
    const model = new ScriptModel([
      response(
        AssistantContent.toolCall("a", "spawn_specialist", { prompt: "task A" }),
        AssistantContent.toolCall("b", "spawn_specialist", { prompt: "task B" }),
      ),
      say("provisional"),
      say("combined"),
    ]);
    const result = await new AgentTeam({
      id: "lead",
      model,
      members: [worker],
      limits: { maxConcurrentAgents: 1 },
    }).generate({ prompt: "start" });
    expect(result.members).toHaveLength(2);
    expect(new Set(result.members.map((member) => member.instanceId)).size).toBe(2);
    expect(
      result.members.map((member) => member.outcome?.type === "response" && member.outcome.output),
    ).toEqual(["result A", "result B"]);
    for (const request of workerModel.requests) {
      const names = request.tools?.map((tool) => tool.name);
      expect(names).not.toContain("spawn_specialist");
      expect(names).not.toContain("cancel_agent");
    }
  });

  it("wakes a waiting parent on a question and delivers its reply without deadlock", async () => {
    const workerModel = new ScriptModel([
      response(
        AssistantContent.toolCall("question", "send_message", {
          to: "parent",
          content: "Which region?",
        }),
        AssistantContent.toolCall("wait", "wait_for_agent", { timeoutMs: 1000 }),
      ),
      (request) => {
        expect(history(request)).toContain("Europe");
        return say("Europe report");
      },
    ]);
    let childId = "";
    const model = new ScriptModel([
      call("spawn_researcher", { prompt: "research" }),
      (request) => {
        childId = instanceFrom(request);
        return call("wait_for_agent", { instanceId: childId, timeoutMs: 1000 });
      },
      (request) => {
        expect(history(request)).toContain("Which region?");
        return response(
          AssistantContent.toolCall("reply", "send_message", { to: childId, content: "Europe" }),
          AssistantContent.toolCall("wait2", "wait_for_agent", {
            instanceId: childId,
            timeoutMs: 1000,
          }),
        );
      },
      (request) => {
        expect(history(request)).toContain("Europe report");
        return say("done");
      },
    ]);
    const result = await new AgentTeam({
      id: "lead",
      model,
      members: [new Agent({ id: "researcher", model: workerModel })],
      limits: { maxConcurrentAgents: 1 },
    }).generate({ prompt: "start" });
    expect(result).toMatchObject({ output: "done", members: [{ status: "idle" }] });
  });

  it("resumes an idle member with retained history and a distinct run ID", async () => {
    const workerModel = new ScriptModel([
      say("first finding"),
      (request) => {
        expect(history(request)).toContain("first finding");
        expect(history(request)).toContain("check again");
        return say("second finding");
      },
    ]);
    let childId = "";
    const model = new ScriptModel([
      call("spawn_worker", { prompt: "initial task" }),
      (request) => {
        childId = instanceFrom(request);
        return call("wait_for_agent", { instanceId: childId });
      },
      () =>
        response(
          AssistantContent.toolCall("follow", "send_message", {
            to: childId,
            content: "check again",
          }),
          AssistantContent.toolCall("wait", "wait_for_agent", { instanceId: childId }),
        ),
      say("done"),
    ]);
    const stream = new AgentTeam({
      id: "lead",
      model,
      members: [new Agent({ id: "worker", model: workerModel })],
      limits: { maxConcurrentAgents: 1 },
    }).stream({ prompt: "start" });
    const events: AgentTeamEvent[] = [];
    for await (const event of stream) events.push(event);
    const starts = events.filter(
      (event) => event.type === "agent_started" && event.member.agentId === "worker",
    );
    expect(starts).toHaveLength(2);
    expect(new Set(starts.map((event) => "runId" in event && event.runId)).size).toBe(2);
    expect(await stream.result).toMatchObject({
      output: "done",
      members: [{ outcome: { output: "second finding" } }],
    });
    const delivered = events.filter((event) => event.type === "message_delivered");
    expect(delivered).toHaveLength(3);
  });

  it.each([true, false])("routes approval to the app (approved=%s)", async (approved) => {
    const execute = vi.fn(() => "protected result");
    const guarded = createTool({
      name: "write",
      description: "Protected",
      inputSchema: z.object({}),
      requiresApproval: true,
      execute,
    });
    const workerModel = new ScriptModel([call("write"), say("finished")]);
    const model = new ScriptModel([
      call("spawn_worker", { prompt: "write" }),
      call("wait_for_agent"),
      say("done"),
    ]);
    const resolver = vi.fn(() => ({ type: "tool-approval" as const, approved }));
    const result = await new AgentTeam({
      id: "lead",
      model,
      members: [new Agent({ id: "worker", model: workerModel, tools: [guarded] })],
      limits: { maxConcurrentAgents: 1 },
    }).generate({ prompt: "start", resolveInteraction: resolver });
    expect(result.type).toBe("response");
    expect(resolver).toHaveBeenCalledOnce();
    expect(resolver.mock.calls[0]).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(approved ? 1 : 0);
    expect(result.usage.totalTokens).toBe(15);
  });

  it.each(["missing", "invalid"] as const)(
    "fails closed for a %s approval resolver",
    async (kind) => {
      const execute = vi.fn(() => "must not run");
      const guarded = createTool({
        name: "write",
        description: "Protected",
        inputSchema: z.object({}),
        requiresApproval: true,
        execute,
      });
      const model = new ScriptModel([call("write")]);
      const team = new AgentTeam({ id: "lead", model, members: [], tools: [guarded] });
      await expect(
        team.generate({
          prompt: "start",
          ...(kind === "invalid" ? { resolveInteraction: () => ({ type: "wrong" }) as never } : {}),
        }),
      ).rejects.toBeInstanceOf(AgentTeamInteractionError);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("reports member failures to the coordinator", async () => {
    const workerModel = new ScriptModel([
      () => {
        throw new Error("research failed");
      },
    ]);
    const model = new ScriptModel([
      call("spawn_worker", { prompt: "work" }),
      call("wait_for_agent"),
      (request) => {
        expect(history(request)).toContain("research failed");
        return say("explained failure");
      },
    ]);
    const result = await new AgentTeam({
      id: "lead",
      model,
      members: [new Agent({ id: "worker", model: workerModel })],
      limits: { maxConcurrentAgents: 1 },
    }).generate({ prompt: "start" });
    expect(result).toMatchObject({ output: "explained failure", members: [{ status: "failed" }] });
  });

  it("enforces a shared turn budget", async () => {
    const workerModel = new ScriptModel([say("worker")]);
    const model = new ScriptModel([
      call("spawn_worker", { prompt: "work" }),
      call("wait_for_agent"),
      say("final"),
    ]);
    await expect(
      new AgentTeam({
        id: "lead",
        model,
        members: [new Agent({ id: "worker", model: workerModel })],
        limits: { maxConcurrentAgents: 1, maxTotalTurns: 2 },
      }).generate({ prompt: "start" }),
    ).rejects.toBeInstanceOf(AgentTeamLimitError);
    expect(model.requests.length + workerModel.requests.length).toBe(2);
  });

  it("cancels while the app is still resolving approval", async () => {
    const execute = vi.fn();
    const guarded = createTool({
      name: "write",
      description: "Protected",
      inputSchema: z.object({}),
      requiresApproval: true,
      execute,
    });
    const controller = new AbortController();
    const model = new ScriptModel([call("write")]);
    const team = new AgentTeam({ id: "lead", model, members: [], tools: [guarded] });
    await expect(
      team.generate({
        prompt: "start",
        abortSignal: controller.signal,
        resolveInteraction: () => {
          controller.abort();
          return new Promise(() => {});
        },
      }),
    ).rejects.toBeInstanceOf(AgentRunCancelledError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts user steering during execution and rejects it after completion", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const model = new ScriptModel([
      async () => {
        started();
        await gate;
        return say("initial");
      },
      (request) => {
        expect(history(request)).toContain("new user input");
        return say("updated");
      },
    ]);
    const stream = new AgentTeam({ id: "lead", model, members: [] }).stream({ prompt: "start" });
    const result = stream.result;
    await ready;
    expect(stream.steer({ prompt: "new user input" }).status).toBe("queued");
    release();
    expect(await result).toMatchObject({ output: "updated" });
    expect(() => stream.steer({ prompt: "late" })).toThrow();
  });

  it("streams attributed member events and coordinator text with streaming models", async () => {
    const workerModel = new StreamingScriptModel([say("member finding")]);
    const model = new StreamingScriptModel([
      call("spawn_worker", { prompt: "work" }),
      call("wait_for_agent"),
      say("final"),
    ]);
    const team = new AgentTeam({
      id: "lead",
      model,
      members: [new Agent({ id: "worker", model: workerModel })],
      limits: { maxConcurrentAgents: 1 },
    });
    const stream = team.stream({ prompt: "start" });
    const resultPromise = stream.result;
    const events: AgentTeamEvent[] = [];
    for await (const event of stream.events) events.push(event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent_event",
        coordinator: false,
        event: expect.objectContaining({ type: "text_delta", delta: "member finding" }),
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "response", output: "final" });
    expect((await stream.result).usage.totalTokens).toBe(12);
    expect(await resultPromise).toBe(await stream.result);
    await expect(
      (async () => {
        for await (const _ of stream) {
        }
      })(),
    ).rejects.toThrow("consumer");
    const textStream = new AgentTeam({
      id: "lead",
      model: new StreamingScriptModel([say("hello")]),
      members: [],
    }).stream({ prompt: "start" });
    const chunks: string[] = [];
    for await (const chunk of textStream.textStream) chunks.push(chunk);
    expect(chunks).toEqual(["hello"]);
    expect(await textStream.text).toBe("hello");
  });

  it("lets other members run while an approval resolver is pending", async () => {
    let resolved!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolved = resolve;
    });
    const execute = vi.fn(() => "approved");
    const tool = createTool({
      name: "write",
      description: "Protected",
      inputSchema: z.object({}),
      requiresApproval: true,
      execute,
    });
    const writer = new Agent({
      id: "writer",
      model: new ScriptModel([call("write"), say("written")]),
      tools: [tool],
    });
    const researcher = new Agent({
      id: "researcher",
      model: new ScriptModel([
        () => {
          resolved();
          return say("research");
        },
      ]),
    });
    const model = new ScriptModel([
      response(
        AssistantContent.toolCall("writer", "spawn_writer", { prompt: "write" }),
        AssistantContent.toolCall("researcher", "spawn_researcher", { prompt: "research" }),
      ),
      call("wait_for_agent"),
      say("intermediate"),
      say("done"),
    ]);
    const team = new AgentTeam({
      id: "lead",
      model,
      members: [writer, researcher],
      limits: { maxConcurrentAgents: 1 },
    });
    const result = await team.generate({
      prompt: "start",
      resolveInteraction: async ({ interaction, abortSignal }) => {
        expect(interaction.type).toBe("tool-approval");
        expect(abortSignal.aborted).toBe(false);
        expect(execute).not.toHaveBeenCalled();
        await finished;
        return { type: "tool-approval", approved: true };
      },
    });
    expect(result.members.every((member) => member.status === "idle")).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("preserves root and member input guardrail blocking", async () => {
    const guardrails = defineGuardrailPolicy({
      id: "policy",
      input: [
        defineInputGuardrail({
          id: "block",
          check: (_context, { block }) => block({ reason: "denied" }),
        }),
      ],
    });
    const blockedModel = new ScriptModel([]);
    const root = new AgentTeam({ id: "lead", model: blockedModel, members: [], guardrails });
    expect(await root.generate({ prompt: "start" })).toMatchObject({
      type: "blocked",
      reason: "denied",
    });
    const model = new ScriptModel([
      call("spawn_worker", { prompt: "work" }),
      call("wait_for_agent"),
      say("done"),
    ]);
    const result = await new AgentTeam({
      id: "lead",
      model,
      members: [new Agent({ id: "worker", model: blockedModel, guardrails })],
      limits: { maxConcurrentAgents: 1 },
    }).generate({ prompt: "start" });
    expect(result.members).toMatchObject([
      { status: "failed", outcome: { type: "blocked", reason: "denied" } },
    ]);
    expect(blockedModel.requests).toHaveLength(0);
  });

  it("counts the coordinator in the instance limit and refuses excess spawns", async () => {
    const workerModel = new ScriptModel([]);
    const model = new ScriptModel([
      call("spawn_worker", { prompt: "work" }),
      (request) => {
        expect(history(request)).toContain("maxAgentInstances");
        return say("capacity reached");
      },
    ]);
    const result = await new AgentTeam({
      id: "lead",
      model,
      members: [new Agent({ id: "worker", model: workerModel })],
      limits: { maxAgentInstances: 1 },
    }).generate({ prompt: "start" });
    expect(result.members).toEqual([]);
    expect(workerModel.requests).toHaveLength(0);
  });

  it("rejects inaccessible routing and messages to cancelled instances", async () => {
    let childId = "";
    const model = new ScriptModel([
      call("spawn_worker", { prompt: "work" }),
      (request) => {
        childId = instanceFrom(request);
        return response(
          AssistantContent.toolCall("cancel", "cancel_agent", { instanceId: childId }),
          AssistantContent.toolCall("late", "send_message", { to: childId, content: "late" }),
          AssistantContent.toolCall("self", "send_message", { to: "parent", content: "self" }),
        );
      },
      (request) => {
        expect(history(request)).toContain("cancelled");
        expect(history(request)).toContain("not an accessible parent or child");
        return say("done");
      },
    ]);
    const workerModel = new ScriptModel([]);
    const result = await new AgentTeam({
      id: "lead",
      model,
      members: [new Agent({ id: "worker", model: workerModel })],
      limits: { maxConcurrentAgents: 1 },
    }).generate({ prompt: "start" });
    expect(result.members).toMatchObject([{ status: "cancelled" }]);
    expect(workerModel.requests).toHaveLength(0);
  });

  it("cancels promptly even when a model ignores the abort signal", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const model = new ScriptModel([
      () => {
        started();
        return new Promise(() => {});
      },
    ]);
    const stream = new AgentTeam({ id: "lead", model, members: [] }).stream({ prompt: "start" });
    const result = stream.result;
    await ready;
    stream.cancel();
    await expect(result).rejects.toBeInstanceOf(AgentRunCancelledError);
  }, 1000);

  it("reports an idle member's cancellation once, even when cancelled twice", async () => {
    let childId = "";
    const worker = new Agent({ id: "worker", model: new ScriptModel([say("finding")]) });
    const model = new ScriptModel([
      call("spawn_worker", { prompt: "work" }),
      (request) => {
        childId = instanceFrom(request);
        return call("wait_for_agent", { instanceId: childId });
      },
      () =>
        response(
          AssistantContent.toolCall("cancel1", "cancel_agent", { instanceId: childId }),
          AssistantContent.toolCall("cancel2", "cancel_agent", { instanceId: childId }),
          AssistantContent.toolCall("wait", "wait_for_agent", { timeoutMs: 1000 }),
        ),
      (request) => {
        expect(history(request)).toContain("outcome");
        return say("done");
      },
    ]);
    const stream = new AgentTeam({
      id: "lead",
      model,
      members: [worker],
      limits: { maxConcurrentAgents: 1 },
    }).stream({ prompt: "start" });
    let cancellationReports = 0;
    for await (const event of stream) {
      if (
        event.type === "message_queued" &&
        JSON.parse(event.message.content).status === "cancelled"
      )
        cancellationReports++;
    }
    expect(cancellationReports).toBe(1);
    expect(await stream.result).toMatchObject({
      output: "done",
      members: [{ status: "cancelled" }],
    });
  });

  it("cancels when the event consumer closes and does not publish late provider output", async () => {
    let release!: (reply: CompletionResponse) => void;
    const pending = new Promise<CompletionResponse>((resolve) => {
      release = resolve;
    });
    const model = new ScriptModel([() => pending]);
    const stream = new AgentTeam({ id: "lead", model, members: [] }).stream({ prompt: "start" });
    const iterator = stream[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "agent_started" });
    await iterator.return?.();
    await expect(stream.result).rejects.toBeInstanceOf(AgentRunCancelledError);
    release(say("late answer"));
    expect(await iterator.next()).toMatchObject({ done: true });
  });

  it("accepts steering after the coordinator starts closing and retains history once", async () => {
    const model = new ScriptModel([
      say("first answer"),
      (request) => {
        const userMessages = request.chatHistory.filter((message) => message.role === "user");
        expect(userMessages.map((message) => message.content)).toEqual(["start", "follow up"]);
        return say("second answer");
      },
    ]);
    const stream = new AgentTeam({ id: "lead", model, members: [] }).stream({
      prompt: "start",
      lifecycle: {
        onFinish: (event) => {
          if (event.status === "completed" && event.output === "first answer")
            stream.steer({ prompt: "follow up" });
        },
      },
    });
    expect(await stream.result).toMatchObject({ output: "second answer" });
  });

  it.each([false, true])(
    "delivers a child follow-up once when its final drain has passed (streaming=%s)",
    async (streaming) => {
      const Model = streaming ? StreamingScriptModel : ScriptModel;
      let notifyClosing!: () => void;
      const closing = new Promise<void>((resolve) => {
        notifyClosing = resolve;
      });
      let releaseClosing!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseClosing = resolve;
      });
      const workerModel = new Model([
        say("first finding"),
        (request) => {
          expect(
            request.chatHistory.filter(
              (message) => message.role === "user" && message.content === "initial task",
            ),
          ).toHaveLength(1);
          expect(
            request.chatHistory.filter(
              (message) =>
                message.role === "user" &&
                typeof message.content === "string" &&
                message.content.includes("closing follow-up"),
            ),
          ).toHaveLength(1);
          return say("second finding");
        },
      ]);
      const worker = new Agent({
        id: "worker",
        model: workerModel,
        lifecycle: {
          async onFinish(event) {
            if (event.status === "completed" && event.output === "first finding") {
              // onFinish runs after the final steering drain but before the member task settles.
              notifyClosing();
              await released;
            }
          },
        },
      });
      let childId = "";
      const model = new Model([
        call("spawn_worker", { prompt: "initial task" }),
        async (request) => {
          childId = instanceFrom(request);
          await closing;
          return call("send_message", { to: childId, content: "closing follow-up" });
        },
        (request) => {
          expect(history(request)).toContain("queued");
          releaseClosing();
          return call("wait_for_agent", { instanceId: childId });
        },
        say("provisional"),
        say("done"),
      ]);
      const stream = new AgentTeam({
        id: "lead",
        model,
        members: [worker],
        limits: { maxConcurrentAgents: 2 },
      }).stream({ prompt: "start" });
      const starts: string[] = [];
      let delivered = 0;
      for await (const event of stream) {
        if (event.type === "agent_started" && event.member.agentId === "worker")
          starts.push(event.runId!);
        if (event.type === "message_delivered" && event.message.content === "closing follow-up")
          delivered++;
      }
      expect(delivered).toBe(1);
      expect(starts).toHaveLength(2);
      expect(new Set(starts).size).toBe(2);
      expect(workerModel.requests).toHaveLength(2);
      expect(await stream.result).toMatchObject({
        type: "response",
        members: [{ status: "idle", outcome: { output: "second finding" } }],
      });
    },
  );
});
