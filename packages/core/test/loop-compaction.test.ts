import { expect, it, vi } from "vitest";
import { Agent, createVectorContext, type AgentStreamEvent } from "../src/agent";
import type { EmbeddingModel } from "../src/embeddings";
import type { ToolIndex } from "../src/tool";
import {
  Usage,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type Message,
  type StreamingCompletionModel,
} from "../src/completion";
import type { MemoryStore, MemorySavePolicy } from "../src/memory";
import { isMemoryCompactionMessage } from "../src/memory";
import { planLoopContext } from "../src/internal/agent-runtime/loop-context";

const large = "payload".repeat(1000);
function store() {
  const messages: Message[] = [];
  const memory: MemoryStore = {
    load: async () => [...messages],
    append: async (input) => {
      messages.push(...input.messages);
    },
    clear: async () => {
      messages.length = 0;
    },
    compaction: {
      snapshot: async () => ({ revision: "1", messages: [...messages] }),
      replacePrefix: async () => {
        throw new Error("Live compaction must not rewrite the session store.");
      },
    },
  };
  return { memory, messages };
}
const response = (choice: CompletionResponse["choice"]): CompletionResponse => ({
  choice,
  usage: Usage.empty(),
  rawResponse: {},
});
const call = (id: string) => ({
  type: "tool-call" as const,
  toolName: "lookup",
  toolCallId: id,
  input: {},
});
const result = (id: string): Message => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolName: "lookup",
      toolCallId: id,
      output: { type: "text", value: large },
    },
  ],
});

it.each(["message", "turn", "run"] as MemorySavePolicy[])(
  "compacts tool output and preserves retrieval with %s persistence in generate and stream",
  async (savePolicy) => {
    for (const streaming of [false, true]) {
      const { memory, messages } = store();
      const requests: CompletionRequest[] = [];
      const completion = async (request: CompletionRequest) => {
        requests.push(request);
        if (JSON.stringify(request.chatHistory).length > 2000)
          throw new Error("context length exceeded");
        return requests.length <= 3
          ? response([call(String(requests.length))])
          : response([{ type: "text", text: "done" }]);
      };
      const model: StreamingCompletionModel = {
        provider: "test",
        modelId: "bounded",
        capabilities: {
          streaming: true,
          tools: true,
          toolChoice: true,
          imageInput: false,
          documentInput: false,
          outputSchema: false,
          reasoning: false,
        },
        completion,
        async *streamCompletion(request) {
          yield { type: "final", response: await completion(request) };
        },
      };
      const compactor = vi.fn(async () => ({
        summary: "Lookup found the needed facts.",
        usage: { ...Usage.empty(), inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      }));
      const tool = vi.fn(async () => large);
      const definition = vi.fn((query: string) => ({
        name: "lookup",
        description: `Lookup for ${query}`,
        parameters: { type: "object", properties: {} },
      }));
      const nextDefinition = {
        name: "next",
        description: "Next step discovered from lookup output",
        parameters: { type: "object", properties: {} },
      };
      const search = vi.fn<ToolIndex["search"]>(async ({ query }) =>
        query === large
          ? [
              {
                id: "next",
                score: 1,
                document: { toolName: "next", definition: nextDefinition, text: "next" },
              },
            ]
          : [],
      );
      const embedTexts = vi.fn<EmbeddingModel["embedTexts"]>(async (texts) =>
        texts.map((document) => ({ document, vector: [1] })),
      );
      const agent = new Agent({
        id: "test",
        model,
        maxTurns: 4,
        tools: [
          {
            name: "lookup",
            definition,
            call: tool,
          },
          {
            kind: "tool-index",
            tools: [{ name: "next", definition: () => nextDefinition, call: async () => "done" }],
            topK: 1,
            search,
          },
        ],
        context: [
          createVectorContext({
            model: { provider: "test", modelId: "embedding", embedTexts },
            store: {
              async ensure() {},
              async validate() {},
              async upsert() {},
              async search() {
                return [];
              },
            },
            topK: 1,
          }),
        ],
        memory: {
          store: memory,
          savePolicy,
          compaction: {
            trigger: { afterTokens: 500 },
            retention: { recentToolTurns: 0 },
            compactor,
          },
        },
      });
      const options = { prompt: "Find the answer", session: { sessionId: "test" } };
      const events: AgentStreamEvent[] = [];
      if (streaming) for await (const event of agent.stream(options)) events.push(event);
      const outcome = streaming ? events.at(-1)! : await agent.generate(options);
      expect(outcome).toMatchObject({
        type: "response",
        output: "done",
        usage: { totalTokens: 9 },
      });
      expect(compactor).toHaveBeenCalledTimes(3);
      expect(tool).toHaveBeenCalledTimes(3);
      // Compact only the provider transcript; retrieval still follows the latest tool output.
      const queries = ["Find the answer", large, large, large];
      expect(definition.mock.calls.map(([query]) => query)).toEqual(queries);
      expect(search.mock.calls.map(([request]) => request.query)).toEqual(queries);
      expect(embedTexts.mock.calls.map(([texts]) => texts)).toEqual(
        queries.map((query) => [query]),
      );
      expect(requests[0]!.tools?.some((tool) => tool.name === "next")).toBe(false);
      expect(
        requests.slice(1).every((request) => request.tools?.some((tool) => tool.name === "next")),
      ).toBe(true);
      expect(
        requests.slice(1).every((request) => request.chatHistory.some(isMemoryCompactionMessage)),
      ).toBe(true);
      expect(
        requests.every((request) =>
          request.chatHistory.some(
            (message) => message.role === "user" && message.content === "Find the answer",
          ),
        ),
      ).toBe(true);
      expect(messages.filter((message) => message.role === "tool")).toHaveLength(3);
      expect(messages.some(isMemoryCompactionMessage)).toBe(false);
      if (streaming)
        expect(events.filter((event) => event.type === "memory_compaction")).toHaveLength(3);
    }
  },
);

it("never cuts a parallel tool exchange while a result is outstanding", async () => {
  const messages: Message[] = [
    { role: "user", content: "task" },
    { role: "assistant", content: [call("a"), call("b")] },
    result("a"),
  ];
  expect(
    await planLoopContext(messages, undefined, { afterTokens: 1, recentToolTurns: 0 }),
  ).toBeUndefined();
  messages.push(result("b"));
  const plan = await planLoopContext(messages, undefined, { afterTokens: 1, recentToolTurns: 0 });
  expect(plan?.coveredMessages).toBe(4);
  expect(plan?.messages).toEqual([{ role: "user", content: "task" }]);
});

it("retains the newest complete tool round by default", async () => {
  const messages: Message[] = [
    { role: "user", content: "task" },
    { role: "assistant", content: [call("a")] },
    result("a"),
    { role: "assistant", content: [call("b")] },
    result("b"),
  ];
  const plan = await planLoopContext(messages, undefined, { afterTokens: 1 });
  expect(plan?.coveredMessages).toBe(3);
  expect(plan?.messages).toEqual([messages[0], ...messages.slice(3)]);
});

it("carries an already prepared projection through approval without re-summarizing it", async () => {
  const { memory } = store();
  const compactor = vi.fn(async () => ({ summary: "Lookup found the answer." }));
  let calls = 0;
  const model: CompletionModel = {
    provider: "test",
    modelId: "bounded",
    capabilities: {
      streaming: true,
      tools: true,
      toolChoice: true,
      imageInput: false,
      documentInput: false,
      outputSchema: false,
      reasoning: false,
    },
    async completion(request) {
      if (JSON.stringify(request.chatHistory).length > 2000)
        throw new Error("context length exceeded");
      calls += 1;
      return calls === 1
        ? response([call("a")])
        : calls === 2
          ? response([{ ...call("b"), toolName: "confirm" }])
          : response([{ type: "text", text: "done" }]);
    },
  };
  const agent = new Agent({
    id: "test",
    model,
    tools: [
      {
        name: "lookup",
        definition: () => ({
          name: "lookup",
          description: "Lookup",
          parameters: { type: "object", properties: {} },
        }),
        call: async () => large,
      },
      {
        name: "confirm",
        requiresApproval: true,
        definition: () => ({
          name: "confirm",
          description: "Confirm",
          parameters: { type: "object", properties: {} },
        }),
        call: async () => "ok",
      },
    ],
    memory: {
      store: memory,
      compaction: { trigger: { afterTokens: 500 }, retention: { recentToolTurns: 0 }, compactor },
    },
  });
  const waiting = await agent.generate({
    prompt: "Find the answer",
    session: { sessionId: "test" },
  });
  if (waiting.type !== "interaction") throw new Error("Expected approval");
  expect(compactor).toHaveBeenCalledTimes(1);
  const outcome = await agent.generate({
    continuation: JSON.parse(JSON.stringify(waiting.continuation)),
    response: { type: "tool-approval", approved: true },
  });
  expect(outcome).toMatchObject({ type: "response", output: "done" });
  expect(compactor).toHaveBeenCalledTimes(1);
});
