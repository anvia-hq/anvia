import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  Agent,
  AgentTeam,
  AssistantContent,
  Usage,
  createTool,
  defineGuardrailPolicy,
  defineOutputGuardrail,
  type AgentTeamEvent,
  type AgentTeamOptions,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
} from "./helpers/imports";

const say = (text: string): CompletionResponse => ({
  choice: [AssistantContent.text(text)],
  usage: { ...Usage.empty(), totalTokens: 1 },
  rawResponse: {},
});
const call = (name: string, args = {}): CompletionResponse => ({
  ...say(""),
  choice: [AssistantContent.toolCall(crypto.randomUUID(), name, args)],
});
const history = (request: CompletionRequest) => JSON.stringify(request.chatHistory);
const model = (
  reply: (request: CompletionRequest) => CompletionResponse | Promise<CompletionResponse>,
): CompletionModel => ({
  provider: "test",
  modelId: "hierarchy",
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
});
function script(
  ...replies: (CompletionResponse | ((request: CompletionRequest) => CompletionResponse))[]
) {
  return model((request) => {
    const reply = replies.shift();
    if (reply === undefined) throw new Error("No scripted response");
    return typeof reply === "function" ? reply(request) : reply;
  });
}
function tools(request: CompletionRequest) {
  return request.tools?.map((tool) => tool.name) ?? [];
}
function instanceFrom(request: CompletionRequest): string {
  const match = history(request).match(/instanceId\\?":\\?"([^"\\]+)/);
  if (!match?.[1]) throw new Error("No instance ID");
  return match[1];
}
async function collect(team: AgentTeam) {
  const stream = team.stream({ prompt: "start" });
  const events: AgentTeamEvent[] = [];
  for await (const event of stream) events.push(event);
  return { result: await stream.result, events };
}

describe("AgentTeam hierarchy", () => {
  it("validates canonical definitions, duplicate rules, communication, and depth", () => {
    const m = model(() => say("done"));
    const worker = new Agent({ id: "worker", model: m });
    const impostor = new Agent({ id: "worker", model: m });
    const base = { id: "lead", model: m, members: [worker] };
    for (const spawning of [
      [{ from: impostor, to: [worker] }],
      [{ from: worker, to: [impostor] }],
      [{ from: worker, to: [worker, worker] }],
      [
        { from: worker, to: [] },
        { from: worker, to: [] },
      ],
    ])
      expect(() => new AgentTeam({ ...base, spawning })).toThrow();
    for (const invalid of [
      null,
      {},
      [{ from: worker, to: null }],
      [{ from: worker, to: Array(1) }],
      [null],
    ]) {
      expect(
        () =>
          new AgentTeam({
            ...base,
            spawning: invalid as NonNullable<AgentTeamOptions["spawning"]>,
          }),
      ).toThrow();
    }
    for (const invalid of [null, [], false, { siblings: "yes" }]) {
      expect(
        () =>
          new AgentTeam({
            ...base,
            communication: invalid as NonNullable<AgentTeamOptions["communication"]>,
          }),
      ).toThrow();
    }
    for (const maxDepth of [0, -1, 1.5, Infinity]) {
      expect(() => new AgentTeam({ ...base, limits: { maxDepth } })).toThrow();
    }
    expect(new AgentTeam(base).limits.maxDepth).toBe(3);
  });

  it("waits for each parent's children with one slot and routes outcomes to the immediate parent", async () => {
    const leaf = new Agent({
      id: "leaf",
      model: model((request) => {
        expect(tools(request)).not.toContain("spawn_leaf");
        return say("private leaf finding");
      }),
    });
    const worker = new Agent({
      id: "worker",
      model: script(
        (request) => {
          expect(tools(request)).toContain("spawn_leaf");
          expect(tools(request)).not.toContain("spawn_worker");
          return call("spawn_leaf", { prompt: "investigate" });
        },
        say("provisional"),
        (request) => {
          expect(history(request)).toContain("private leaf finding");
          return say("worker summary");
        },
      ),
    });
    const { result, events } = await collect(
      new AgentTeam({
        id: "lead",
        model: script(
          call("spawn_worker", { prompt: "research" }),
          say("provisional"),
          (request) => {
            expect(history(request)).toContain("worker summary");
            expect(history(request)).not.toContain("private leaf finding");
            return say("done");
          },
        ),
        members: [worker, leaf],
        spawning: [{ from: worker, to: [leaf] }],
        limits: { maxConcurrentAgents: 1 },
      }),
    );
    const [parent, child] = result.members;
    expect(parent).toMatchObject({ agentId: "worker", depth: 1, status: "idle" });
    expect(child).toMatchObject({
      agentId: "leaf",
      depth: 2,
      parentInstanceId: parent!.instanceId,
      status: "idle",
    });
    expect(result.usage.totalTokens).toBe(7);
    expect(
      events.flatMap((event) =>
        event.type === "message_queued"
          ? [[event.message.fromInstanceId, event.message.toInstanceId]]
          : [],
      ),
    ).toEqual([
      [child!.instanceId, parent!.instanceId],
      [parent!.instanceId, parent!.parentInstanceId],
    ]);
  });

  it.each(["maxDepth", "maxAgentInstances"] as const)(
    "bounds self-recursion by the shared %s limit",
    async (limit) => {
      const worker = new Agent({
        id: "worker",
        model: model((request) => {
          if (!history(request).includes("spawn_worker"))
            return call("spawn_worker", { prompt: "recurse" });
          return say(history(request).includes(limit) ? `reached ${limit}` : "done");
        }),
      });
      const { result } = await collect(
        new AgentTeam({
          id: "lead",
          model: script(
            call("spawn_worker", { prompt: "recurse" }),
            say("provisional"),
            say("done"),
          ),
          members: [worker],
          spawning: [{ from: worker, to: [worker] }],
          limits: {
            maxConcurrentAgents: 1,
            maxDepth: 3,
            maxAgentInstances: limit === "maxAgentInstances" ? 3 : 12,
          },
        }),
      );
      expect(result.members.map((member) => member.depth)).toEqual(
        limit === "maxDepth" ? [1, 2, 3] : [1, 2],
      );
      expect(result.members.at(-1)?.outcome).toMatchObject({ output: `reached ${limit}` });
      expect(result.members.every((member) => member.status === "idle")).toBe(true);
    },
  );

  it.each([false, true])(
    "restricts sibling discovery, messaging, and waiting (enabled=%s)",
    async (siblings) => {
      let siblingId = "";
      const recipient = new Agent({ id: "recipient", model: model(() => say("recipient done")) });
      const sender = new Agent({
        id: "sender",
        model: script(
          call("list_agents"),
          (request) => {
            expect(history(request).includes(siblingId)).toBe(siblings);
            expect(history(request)).toContain("depth");
            return call("send_message", { to: siblingId, content: "peer finding" });
          },
          (request) => {
            expect(history(request).includes("not an accessible")).toBe(!siblings);
            return call("wait_for_agent", { instanceId: siblingId, timeoutMs: 0 });
          },
          (request) => {
            expect(history(request).includes("not an accessible")).toBe(!siblings);
            return say("sender done");
          },
        ),
      });
      const { result, events } = await collect(
        new AgentTeam({
          id: "lead",
          members: [sender, recipient],
          communication: { siblings },
          model: script(
            call("spawn_recipient", { prompt: "receive" }),
            (request) => {
              siblingId = instanceFrom(request);
              return call("spawn_sender", { prompt: "send" });
            },
            say("provisional"),
            say("intermediate"),
            say("done"),
          ),
          limits: { maxConcurrentAgents: 1 },
        }),
      );
      expect(result.members.every((member) => member.status === "idle")).toBe(true);
      const messages = events.filter(
        (event) => event.type === "message_delivered" && event.message.content === "peer finding",
      );
      expect(messages).toHaveLength(siblings ? 1 : 0);
    },
  );

  it.each(["cancel", "fail", "block"])(
    "stops idle descendants when their parent is terminated (%s)",
    async (termination) => {
      const leaf = new Agent({ id: "leaf", model: model(() => say("leaf done")) });
      const worker = new Agent({
        id: "worker",
        ...(termination === "block"
          ? {
              guardrails: defineGuardrailPolicy({
                id: "block-policy",
                output: [
                  defineOutputGuardrail({
                    id: "block",
                    check: (_context, { block }) => block({ reason: "denied" }),
                  }),
                ],
              }),
            }
          : {}),
        model: script(call("spawn_leaf", { prompt: "work" }), say("early"), () => {
          if (termination === "fail") throw new Error("parent failed");
          return say("parent done");
        }),
      });
      let parentId = "";
      const { result, events } = await collect(
        new AgentTeam({
          id: "lead",
          members: [worker, leaf],
          spawning: [{ from: worker, to: [leaf] }],
          limits: { maxConcurrentAgents: 1 },
          model: script(
            call("spawn_worker", { prompt: "work" }),
            (request) => {
              parentId = instanceFrom(request);
              return call("wait_for_agent", { instanceId: parentId });
            },
            () =>
              termination === "cancel"
                ? call("cancel_agent", { instanceId: parentId })
                : say("done"),
            say("done"),
          ),
        }),
      );
      expect(result.members).toMatchObject([
        { status: termination === "cancel" ? "cancelled" : "failed" },
        { status: "cancelled" },
      ]);
      expect(
        events.filter(
          (event) => event.type === "agent_cancelled" && event.member.agentId === "leaf",
        ),
      ).toHaveLength(1);
      // Descendant cancellation must not enqueue a new assignment into its terminated parent.
      const cancelledAt = events.findIndex((event) => event.type === "agent_cancelled");
      expect(
        events
          .slice(cancelledAt)
          .some(
            (event) => event.type === "message_queued" && event.message.toInstanceId === parentId,
          ),
      ).toBe(false);
    },
  );

  it("reports an idle subtree's cancellation once to its surviving parent", async () => {
    const leaf = new Agent({ id: "leaf", model: model(() => say("leaf done")) });
    const middle = new Agent({
      id: "middle",
      model: script(call("spawn_leaf", { prompt: "work" }), say("early"), say("middle done")),
    });
    const worker = new Agent({
      id: "worker",
      model: script(call("spawn_middle", { prompt: "work" }), say("early"), say("worker done")),
    });
    let workerId = "";
    const { result, events } = await collect(
      new AgentTeam({
        id: "lead",
        members: [worker, middle, leaf],
        spawning: [
          { from: worker, to: [middle] },
          { from: middle, to: [leaf] },
        ],
        limits: { maxConcurrentAgents: 1 },
        model: script(
          call("spawn_worker", { prompt: "work" }),
          (request) => {
            workerId = instanceFrom(request);
            return call("wait_for_agent", { instanceId: workerId });
          },
          () => call("cancel_agent", { instanceId: workerId }),
          (request) => {
            expect(history(request)).toContain("cancelled");
            return call("cancel_agent", { instanceId: workerId });
          },
          say("done"),
        ),
      }),
    );
    expect(result.members).toMatchObject([
      { agentId: "worker", status: "cancelled" },
      { agentId: "middle", status: "cancelled" },
      { agentId: "leaf", status: "cancelled" },
    ]);
    const firstCancellation = events.findIndex((event) => event.type === "agent_cancelled");
    expect(firstCancellation).toBeGreaterThan(-1);
    expect(
      events
        .slice(0, firstCancellation)
        .flatMap((event) => (event.type === "agent_idle" ? [event.member.agentId] : [])),
    ).toEqual(["leaf", "middle", "worker"]);
    const cancelledOutcomes = events.flatMap((event) =>
      event.type === "message_queued" && JSON.parse(event.message.content).status === "cancelled"
        ? [event.message]
        : [],
    );
    expect(cancelledOutcomes).toMatchObject([
      {
        fromInstanceId: workerId,
        toInstanceId: result.members[0]!.parentInstanceId,
      },
    ]);
    expect(
      events.filter(
        (event) =>
          event.type === "message_delivered" && event.message.id === cancelledOutcomes[0]!.id,
      ),
    ).toHaveLength(1);
    expect(
      events.slice(firstCancellation).filter((event) => event.type === "agent_cancelled"),
    ).toHaveLength(3);
    const subtreeIds = new Set(result.members.map((member) => member.instanceId));
    expect(
      events
        .slice(firstCancellation)
        .some(
          (event) => event.type === "message_queued" && subtreeIds.has(event.message.toInstanceId),
        ),
    ).toBe(false);
  });

  it("denies sibling cancellation and cousin or ancestor access even when their IDs are known", async () => {
    let firstParentId = "";
    let firstLeafId = "";
    let coordinatorId = "";
    let secondLeafTurn = 0;
    const leaf = new Agent({
      id: "leaf",
      model: model((request) => {
        const ownId = request.instructions!.match(/Your instance ID is ([^.]+)\./)![1]!;
        if (firstLeafId === "") {
          firstLeafId = ownId;
          return say("first leaf done");
        }
        if (ownId === firstLeafId) return say("first leaf done");
        const h = history(request);
        secondLeafTurn++;
        if (secondLeafTurn === 1) return call("list_agents");
        if (secondLeafTurn === 2) {
          expect(h).not.toContain(firstLeafId);
          expect(h).not.toContain(firstParentId);
          return call("send_message", { to: firstLeafId, content: "cousin cannot send" });
        }
        expect(h).toContain("not an accessible");
        if (secondLeafTurn === 3)
          return call("wait_for_agent", { instanceId: coordinatorId, timeoutMs: 0 });
        return say("second leaf done");
      }),
    });
    let workerTurn = 0;
    const worker = new Agent({
      id: "worker",
      model: model(() => {
        workerTurn++;
        if (workerTurn === 1) return call("spawn_leaf", { prompt: "work" });
        return say("first parent done");
      }),
    });
    // Both parents have cancel_agent because both may spawn; knowing a sibling ID grants no authority.
    let otherTurn = 0;
    const secondParent = new Agent({
      id: "second",
      model: model((request) => {
        otherTurn++;
        if (otherTurn === 1) return call("cancel_agent", { instanceId: firstParentId });
        if (otherTurn === 2) {
          expect(history(request)).toContain("Only a parent can cancel its child");
          return call("send_message", { to: firstLeafId, content: "uncle cannot send" });
        }
        if (otherTurn === 3) {
          expect(history(request)).toContain("not an accessible");
          return call("wait_for_agent", { instanceId: firstLeafId, timeoutMs: 0 });
        }
        if (otherTurn === 4) return call("spawn_leaf", { prompt: "work" });
        return say("second parent done");
      }),
    });
    let leadTurn = 0;
    const { result } = await collect(
      new AgentTeam({
        id: "lead",
        model: model((request) => {
          leadTurn++;
          coordinatorId = request.instructions!.match(/Your instance ID is ([^.]+)\./)![1]!;
          if (leadTurn === 1) return call("spawn_worker", { prompt: "work" });
          if (leadTurn === 2) {
            firstParentId = instanceFrom(request);
            return call("wait_for_agent", { instanceId: firstParentId });
          }
          if (leadTurn === 3) return call("spawn_second", { prompt: "work" });
          return say("done");
        }),
        members: [worker, secondParent, leaf],
        communication: { siblings: true },
        spawning: [
          { from: worker, to: [leaf] },
          { from: secondParent, to: [leaf] },
        ],
        limits: { maxConcurrentAgents: 1 },
      }),
    );
    expect(result.members).toHaveLength(4);
    expect(result.members.every((member) => member.status === "idle")).toBe(true);
  });

  it("enforces the shared turn budget across recursive instances", async () => {
    const worker = new Agent({
      id: "worker",
      model: model((request) =>
        history(request).includes("spawn_worker")
          ? say("early")
          : call("spawn_worker", { prompt: "recurse" }),
      ),
    });
    const team = new AgentTeam({
      id: "lead",
      model: script(call("spawn_worker", { prompt: "work" }), say("early")),
      members: [worker],
      spawning: [{ from: worker, to: [worker] }],
      limits: { maxConcurrentAgents: 1, maxTotalTurns: 5 },
    });
    await expect(team.generate({ prompt: "start" })).rejects.toMatchObject({
      limit: "maxTotalTurns",
    });
  });

  it("cancels a running subtree while unrelated siblings finish", async () => {
    let started!: () => void;
    const leafStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const leaf = new Agent({
      id: "leaf",
      model: model(() => {
        started();
        return new Promise<CompletionResponse>(() => {});
      }),
    });
    const worker = new Agent({
      id: "worker",
      model: script(call("spawn_leaf", { prompt: "work" }), call("wait_for_agent"), say("unused")),
    });
    const sibling = new Agent({ id: "sibling", model: model(() => say("unrelated done")) });
    let turn = 0;
    let parentId = "";
    const lead = model(async (request) => {
      turn++;
      if (turn === 1) return call("spawn_worker", { prompt: "work" });
      if (turn === 2) {
        parentId = instanceFrom(request);
        await leafStarted;
        return call("cancel_agent", { instanceId: parentId });
      }
      if (turn === 3) return call("spawn_sibling", { prompt: "work" });
      return say("done");
    });
    const { result } = await collect(
      new AgentTeam({
        id: "lead",
        model: lead,
        members: [worker, leaf, sibling],
        spawning: [{ from: worker, to: [leaf] }],
        limits: { maxConcurrentAgents: 3 },
      }),
    );
    expect(result.members).toMatchObject([
      { agentId: "worker", status: "cancelled" },
      { agentId: "leaf", status: "cancelled" },
      { agentId: "sibling", status: "idle" },
    ]);
  });

  it("keeps nested tool approval with the application and never inherits parent tools", async () => {
    const execute = vi.fn(() => "written");
    const write = createTool({
      name: "write",
      description: "write",
      inputSchema: z.object({}),
      requiresApproval: true,
      execute,
    });
    const leaf = new Agent({
      id: "leaf",
      tools: [write],
      model: script(call("write"), say("written")),
    });
    const worker = new Agent({
      id: "worker",
      model: script(
        (request) => {
          expect(tools(request)).not.toContain("write");
          return call("spawn_leaf", { prompt: "write" });
        },
        say("early"),
        say("done"),
      ),
    });
    const resolveInteraction = vi.fn(() => {
      expect(execute).not.toHaveBeenCalled();
      return { type: "tool-approval" as const, approved: true };
    });
    const result = await new AgentTeam({
      id: "lead",
      model: script(call("spawn_worker", { prompt: "work" }), say("early"), say("done")),
      members: [worker, leaf],
      spawning: [{ from: worker, to: [leaf] }],
      limits: { maxConcurrentAgents: 1 },
    }).generate({ prompt: "start", resolveInteraction });
    expect(result.members.every((member) => member.status === "idle")).toBe(true);
    expect(resolveInteraction).toHaveBeenCalledOnce();
    expect(resolveInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: result.members[1]!.instanceId }),
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("snapshots spawn rules and preserves coordinator-only spawning by default", async () => {
    const leaf = new Agent({ id: "leaf", model: model(() => say("done")) });
    const worker = new Agent({
      id: "worker",
      model: model((request) => {
        expect(tools(request)).toContain("spawn_leaf");
        expect(tools(request)).not.toContain("spawn_worker");
        return say("done");
      }),
    });
    const to = [leaf];
    const spawning = [{ from: worker, to }];
    const team = new AgentTeam({
      id: "lead",
      model: script(call("spawn_worker", { prompt: "work" }), say("early"), say("done")),
      members: [worker, leaf],
      spawning,
      limits: { maxConcurrentAgents: 1 },
    });
    to.push(worker);
    spawning.length = 0;
    const snapshotResult = await team.generate({ prompt: "start" });
    expect(snapshotResult.members).toMatchObject([{ agentId: "worker", status: "idle" }]);
    const defaultWorker = new Agent({
      id: "worker",
      model: model((request) => {
        expect(tools(request).filter((name) => name.startsWith("spawn_"))).toEqual([]);
        return say("done");
      }),
    });
    const defaultResult = await new AgentTeam({
      id: "lead",
      model: script(call("spawn_worker", { prompt: "work" }), say("early"), say("done")),
      members: [defaultWorker],
      limits: { maxConcurrentAgents: 1 },
    }).generate({ prompt: "start" });
    expect(defaultResult.members).toMatchObject([{ agentId: "worker", status: "idle" }]);
  });
});
