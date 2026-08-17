import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, createVectorContext } from "@anvia/core/agent";
import {
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  type Message as CoreMessage,
  type JsonObject,
  type ProviderTool,
  type StreamingCompletionModel,
  Usage,
} from "@anvia/core/completion";
import { type Embedding, type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import { type EvalMetric, EvalOutcome } from "@anvia/core/evals";
import type { McpServer, McpTool } from "@anvia/core/mcp";
import type {
  MemoryAppendOptions,
  MemoryCompactionMessage,
  MemoryConversation,
  MemoryErrorOptions,
  MemoryInspector,
  MemoryScope,
  MemoryStore,
} from "@anvia/core/memory";
import type { AgentObserver, AgentRunObserver, AgentRunStartArgs } from "@anvia/core/observability";
import { Pipeline } from "@anvia/core/pipeline";
import { createQuestionTool, createToolIndex, type Tool } from "@anvia/core/tool";
import { InMemoryVectorStore, type VectorStore } from "@anvia/core/vector-store";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  AssistantContent,
  Message,
  ToolContent,
  UserContent,
} from "../../core/test/helpers/imports";
import {
  type AgentRunResponse,
  type AgentRunStreamEvent,
  createInMemoryStudioStore,
  Studio,
  type StudioSessionRunTranscriptInput,
} from "../src/index";
import { registerObservabilityRoutes, StudioObservabilityHub } from "../src/runtime/observability";
import { createSqliteSessionStore } from "../src/sqlite";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

class QueueModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
    providerTools: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responses: CompletionResponse[]) {}

  traceRequest(request: CompletionRequest, options: { stream?: boolean } = {}): JsonObject {
    return {
      provider: this.provider,
      stream: options.stream === true,
      model: this.modelId,
      messageCount: request.chatHistory.length,
    };
  }

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    return response;
  }
}

type CompletionOutcome = { response: CompletionResponse } | { error: unknown };

class FlakyQueueModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly outcomes: CompletionOutcome[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const outcome = this.outcomes.shift();
    if (outcome === undefined) {
      throw new Error("No queued outcome");
    }
    if ("error" in outcome) {
      throw outcome.error;
    }
    return outcome.response;
  }
}

class StreamingQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  constructor(
    private readonly responses: Array<
      Iterable<CompletionModelStreamEvent> | AsyncIterable<CompletionModelStreamEvent>
    >,
  ) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  traceRequest(request: CompletionRequest, options: { stream?: boolean } = {}): JsonObject {
    return {
      provider: this.provider,
      stream: options.stream === true,
      model: this.modelId,
      messageCount: request.chatHistory.length,
    };
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued stream response");
    }
    for await (const event of response) {
      yield event;
    }
  }
}

async function* streamThenThrow(
  events: CompletionModelStreamEvent[],
  error: unknown,
): AsyncIterable<CompletionModelStreamEvent> {
  yield* events;
  throw error;
}

class GatedReasoningModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];
  releaseText: (() => void) | undefined;

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    yield { type: "reasoning_delta", delta: "thinking" };
    await new Promise<void>((resolve) => {
      this.releaseText = resolve;
    });
    yield { type: "text_delta", delta: "done" };
  }
}

class RecordingMemoryStore implements MemoryStore {
  readonly appendCalls: MemoryAppendOptions[] = [];
  readonly errorCalls: MemoryErrorOptions[] = [];
  private readonly sessions = new Map<string, CoreMessage[]>();

  async load({ scope }: { scope: MemoryScope }): Promise<CoreMessage[]> {
    return [...(this.sessions.get(scope.sessionId) ?? [])];
  }

  async append(input: MemoryAppendOptions): Promise<void> {
    this.appendCalls.push({ ...input, messages: [...input.messages] });
    const current = this.sessions.get(input.scope.sessionId) ?? [];
    this.sessions.set(input.scope.sessionId, [...current, ...input.messages]);
  }

  async clear({ scope }: { scope: MemoryScope }): Promise<void> {
    this.sessions.delete(scope.sessionId);
  }

  async recordError(input: MemoryErrorOptions): Promise<void> {
    this.errorCalls.push({ ...input, messages: [...input.messages] });
  }
}

class InspectableMemoryStore implements MemoryStore {
  readonly inspector: MemoryInspector;

  constructor(private readonly conversations: MemoryConversation[]) {
    this.inspector = {
      listConversations: async (options) =>
        this.conversations
          .filter(
            (conversation) =>
              options.userId === undefined || conversation.userId === options.userId,
          )
          .slice(0, options.limit)
          .map(({ messages: _messages, ...conversation }) => conversation),
      getConversation: async ({ ref }) => this.conversations.find((item) => item.ref === ref),
    };
  }

  async load({ scope }: { scope: MemoryScope }): Promise<CoreMessage[]> {
    return (
      this.conversations
        .find((conversation) => conversation.sessionId === scope.sessionId)
        ?.messages.map((record) => record.message) ?? []
    );
  }

  async append(_input: MemoryAppendOptions): Promise<void> {}

  async clear(_options: { scope: MemoryScope }): Promise<void> {}
}

class FailingStreamingModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: true,
    documentInput: true,
    outputSchema: true,
    reasoning: true,
  };
  readonly requests: CompletionRequest[] = [];

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent> {
    this.requests.push(request);
    yield { type: "text_delta", delta: "partial" };
    throw new Error("stream failed");
  }
}

class KeywordEmbeddingModel implements EmbeddingModel {
  readonly provider = "test";
  readonly modelId = "keyword";
  readonly calls: string[][] = [];

  async embedTexts(texts: string[]): Promise<Embedding[]> {
    this.calls.push(texts);
    return texts.map((document) => ({ document, vector: vectorFor(document) }));
  }
}

class TraceObserver implements AgentObserver {
  readonly starts: AgentRunStartArgs[] = [];

  constructor(private readonly traceId = "trace_1") {}

  startRun(args: AgentRunStartArgs): AgentRunObserver {
    this.starts.push(args);
    return {
      trace: { traceId: this.traceId, observationId: "obs_1" },
      end() {},
    };
  }
}

const addTool = {
  name: "add",
  definition() {
    return {
      name: "add",
      description: "Add numbers",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
      },
    };
  },
  call(args) {
    return args.x + args.y;
  },
} satisfies Tool<{ x: number; y: number }, number>;

let studioDbDir: string | undefined;

beforeEach(() => {
  studioDbDir = mkdtempSync(join(tmpdir(), "anvia-studio-test-"));
});

afterEach(() => {
  if (studioDbDir !== undefined) {
    rmSync(studioDbDir, { force: true, recursive: true });
    studioDbDir = undefined;
  }
});

function createRefundTool(execute: (args: { orderId: string; amount: number }) => string) {
  return {
    name: "issue_refund",
    definition() {
      return {
        name: "issue_refund",
        description: "Issue a customer refund",
        parameters: {
          type: "object",
          properties: {
            orderId: { type: "string" },
            amount: { type: "number" },
          },
          required: ["orderId", "amount"],
        },
      };
    },
    requiresApproval: ({ amount, orderId }) =>
      amount > 0 ? { reason: `Approve refund of ${amount} for ${orderId}.` } : false,
    call(args) {
      return execute(args);
    },
  } satisfies Tool<{ orderId: string; amount: number }, string>;
}

const askQuestionTool = createQuestionTool({
  name: "ask_question",
  description: "Ask the user for missing input",
});

const lookupPolicyTool = {
  name: "lookup_policy",
  definition() {
    return {
      name: "lookup_policy",
      description: "Look up policy documents",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    };
  },
  call(args) {
    return `policy:${args.query}`;
  },
} satisfies Tool<{ query: string }, string>;

function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: Usage.empty(),
    rawResponse: {},
  };
}

function vectorFor(text: string): number[] {
  const normalized = text.toLowerCase();
  return [
    normalized.includes("refund") || normalized.includes("policy") ? 1 : 0,
    normalized.includes("shipping") ? 1 : 0,
    normalized.includes("other") ? 1 : 0,
  ];
}

describe("Anvia studio", () => {
  it("exposes only canonical Agent interaction events", () => {
    expectTypeOf<Extract<AgentRunStreamEvent, { type: "approval_required" }>>().toBeNever();
    expectTypeOf<Extract<AgentRunStreamEvent, { type: "tool_approval_request" }>>().toBeNever();
    expectTypeOf<Extract<AgentRunStreamEvent, { type: "interaction_response" }>>().not.toBeNever();
  });

  it("generates config from registered agents", async () => {
    const agent = new Agent({
      id: "support",
      model: new QueueModel([]),
      name: "Support",
      description: "Support assistant",
    });
    const runner = new Studio([agent], {
      quickPrompts: {
        support: ["What can you do?"],
      },
    });

    expect(runner.config()).toMatchObject({
      id: "anvia-studio",
      agents: [
        {
          id: "support",
          name: "Support",
          description: "Support assistant",
          quickPrompts: ["What can you do?"],
          metadata: {
            staticContextCount: 0,
            hasLifecycle: false,
            hasOutputSchema: false,
            observerCount: 0,
            approvalToolCount: 0,
          },
        },
      ],
      chat: {
        quickPrompts: {
          support: ["What can you do?"],
        },
      },
      capabilities: {
        agents: { enabled: true },
        memory: { enabled: true },
        sessions: { enabled: true },
        status: { enabled: true },
        traces: { enabled: true },
      },
      unsupportedCapabilities: [],
    });

    const res = await runner.fetch(new Request("http://runner.test/config"));
    await expect(res.json()).resolves.toMatchObject(runner.config());
  });

  it("uses agent ids and uniquifies duplicates", () => {
    const first = new Agent({
      id: "support-triage",
      model: new QueueModel([]),
      name: "Support Triage",
    });
    const duplicate = new Agent({
      id: "support-triage",
      model: new QueueModel([]),
      name: "Support Triage",
    });
    const unnamed = new Agent({ id: "agent-3", model: new QueueModel([]) });
    const runner = new Studio([first, duplicate, unnamed], {
      quickPrompts: {
        "support-triage": ["first"],
        "support-triage-2": ["second"],
        "agent-3": ["fallback"],
      },
    });

    expect(runner.config().agents).toMatchObject([
      { id: "support-triage", name: "Support Triage", quickPrompts: ["first"] },
      { id: "support-triage-2", name: "Support Triage", quickPrompts: ["second"] },
      { id: "agent-3", quickPrompts: ["fallback"] },
    ]);
    expect(runner.config().chat.quickPrompts).toEqual({
      "support-triage": ["first"],
      "support-triage-2": ["second"],
      "agent-3": ["fallback"],
    });
  });

  it("exposes configured and listed provider models", async () => {
    const agent = new Agent({ id: "support", model: new QueueModel([]), name: "Support" });
    const runner = new Studio([agent], {
      models: {
        defaultModelRef: { providerId: "openai", modelId: "gpt-5" },
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            defaultModelId: "gpt-5",
            models: [
              {
                id: "gpt-5",
                name: "GPT-5",
                modalities: { input: ["text", "image", "document"], output: ["text"] },
                capabilities: { streaming: true, tools: true },
              },
            ],
            createCompletionModel: () => new QueueModel([]),
            listModels: async () => ({
              data: [{ id: "gpt-5-mini", name: "GPT-5 mini", ownedBy: "provider" }],
            }),
          },
        ],
        agents: {
          support: {
            defaultModelRef: { providerId: "openai", modelId: "gpt-5" },
            allowed: ["openai:*"],
          },
        },
      },
    });

    expect(runner.config().models).toMatchObject({
      defaultModelRef: "openai:gpt-5",
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          defaultModelId: "gpt-5",
          models: [
            {
              ref: "openai:gpt-5",
              providerId: "openai",
              providerName: "OpenAI",
              modalities: { input: ["text", "image", "document"], output: ["text"] },
            },
          ],
        },
      ],
      agents: {
        support: {
          defaultModelRef: "openai:gpt-5",
          allowed: ["openai:*"],
        },
      },
    });

    const models = await runner.fetch(new Request("http://runner.test/agents/support/models"));
    await expect(models.json()).resolves.toMatchObject({
      agentId: "support",
      defaultModelRef: "openai:gpt-5",
      models: [
        { ref: "openai:gpt-5", name: "GPT-5" },
        { ref: "openai:gpt-5-mini", name: "GPT-5 mini", metadata: { ownedBy: "provider" } },
      ],
    });
  });

  it("uses the selected provider model for runs and persists the session default", async () => {
    const baseModel = new QueueModel([]);
    const selectedModel = new QueueModel([
      response([AssistantContent.text("First answer")]),
      response([AssistantContent.text("Second answer")]),
    ]);
    const agent = new Agent({ id: "support", model: baseModel });
    const runner = new Studio([agent], {
      models: {
        providers: [
          {
            id: "test",
            defaultModelId: "primary",
            models: [{ id: "secondary", modalities: { input: ["text"], output: ["text"] } }],
            createCompletionModel: ({ modelId }) => {
              if (modelId !== "secondary") {
                throw new Error(`Unexpected model: ${modelId}`);
              }
              return selectedModel;
            },
          },
        ],
        agents: {
          support: {
            allowed: [{ providerId: "test", modelId: "secondary" }],
          },
        },
      },
    });
    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        body: JSON.stringify({ agentId: "support", title: "Support" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const firstRun = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        body: JSON.stringify({
          type: "messages",
          sessionId: session.id,
          messages: [Message.user("first")],
          model: { providerId: "test", modelId: "secondary" },
        }),
      }),
    );
    expect(firstRun.status).toBe(200);

    const secondRun = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        body: JSON.stringify({
          type: "messages",
          sessionId: session.id,
          messages: [Message.user("second")],
        }),
      }),
    );
    expect(secondRun.status).toBe(200);
    expect(baseModel.requests).toHaveLength(0);
    expect(selectedModel.requests).toHaveLength(2);

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      metadata: {
        studioModel: "test:secondary",
      },
    });
  });

  it("rejects models outside the agent policy", async () => {
    const agent = new Agent({ id: "support", model: new QueueModel([]) });
    const runner = new Studio([agent], {
      models: {
        providers: [
          {
            id: "test",
            createCompletionModel: () => new QueueModel([]),
          },
        ],
        agents: {
          support: {
            allowed: [{ providerId: "test", modelId: "allowed" }],
          },
        },
      },
    });

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("hello")],
          model: { providerId: "test", modelId: "blocked" },
        }),
      }),
    );

    expect(run.status).toBe(400);
    await expect(run.json()).resolves.toMatchObject({
      error: {
        code: "bad_request",
        message: "Model test:blocked is not allowed for agent support",
      },
    });
  });

  it("rejects malformed wildcard model policies without broadening them", () => {
    const agent = new Agent({ id: "support", model: new QueueModel([]) });

    expect(
      () =>
        new Studio([agent], {
          models: {
            providers: [
              {
                id: "test",
                createCompletionModel: () => new QueueModel([]),
              },
            ],
            agents: {
              support: {
                allowed: ["test:exact" as never],
              },
            },
          },
        }),
    ).toThrow("Invalid wildcard model reference: test:exact");
  });

  it("accepts multimodal message payloads from Studio runs", async () => {
    const model = new QueueModel([response([AssistantContent.text("image noted")])]);
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        body: JSON.stringify({
          type: "messages",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe this image." },
                {
                  type: "image",
                  image: { type: "data", data: "aW1hZ2U=" },
                  mediaType: "image/png",
                },
              ],
            },
          ],
        }),
      }),
    );

    expect(run.status).toBe(200);
    expect(model.requests[0]?.chatHistory.at(-1)).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "Describe this image." },
        { type: "image", image: { type: "data" }, mediaType: "image/png" },
      ],
    });

    const body = (await run.json()) as { messages: Message[] };
    expect(body.messages[0]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "Describe this image." },
        { type: "image", image: { type: "data" }, mediaType: "image/png" },
      ],
    });
  });

  it("registers pipelines separately from agents", async () => {
    const agent = new Agent({ id: "support", model: new QueueModel([]), name: "Support" });
    const pipeline = new Pipeline({
      id: "ticket-pipeline",
      inputSchema: z.string(),
      name: "Ticket Pipeline",
      description: "Prepare support tickets",
      metadata: { owner: "support" },
    })
      .step({ id: "normalize", name: "Normalize", run: ({ input }) => input.trim() })
      .step({ id: "classify", name: "Classify", run: ({ input }) => input.toUpperCase() });
    const runner = new Studio([agent, pipeline]);

    expect(runner.config()).toMatchObject({
      agents: [{ id: "support" }],
      pipelines: [
        {
          id: "ticket-pipeline",
          name: "Ticket Pipeline",
          description: "Prepare support tickets",
          metadata: { owner: "support" },
          stageCount: 2,
          edgeCount: 3,
          hasParallelStages: false,
        },
      ],
      capabilities: {
        pipelines: { enabled: true },
      },
    });

    const list = await runner.fetch(new Request("http://runner.test/pipelines"));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      pipelines: [{ id: "ticket-pipeline", stageCount: 2 }],
    });

    const detail = await runner.fetch(new Request("http://runner.test/pipelines/ticket-pipeline"));
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      id: "ticket-pipeline",
      graph: {
        id: "ticket-pipeline",
        nodes: [
          { id: "$input", path: ["$input"], kind: "input" },
          { id: "normalize", path: ["normalize"], kind: "step", label: "Normalize" },
          { id: "classify", path: ["classify"], kind: "step", label: "Classify" },
          { id: "$output", path: ["$output"], kind: "output" },
        ],
      },
    });
  });

  it("stores stage logs under the Studio registration id", async () => {
    const pipeline = new Pipeline({ id: "aliased-pipeline", inputSchema: z.string() }).step({
      id: "uppercase",
      run: ({ input }) => input.toUpperCase(),
    });
    const runner = new Studio([pipeline, pipeline]);

    const buffered = await runner.fetch(
      new Request("http://runner.test/pipelines/aliased-pipeline-2/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "buffered" }),
      }),
    );
    expect(buffered.status).toBe(200);

    const streamed = await runner.fetch(
      new Request("http://runner.test/pipelines/aliased-pipeline-2/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "streamed", stream: true }),
      }),
    );
    expect(streamed.status).toBe(200);
    await readJsonl(streamed);

    const registeredLogs = (await (
      await runner.fetch(
        new Request("http://runner.test/pipelines/aliased-pipeline-2/logs?limit=100"),
      )
    ).json()) as { logs: Array<{ event: string }> };
    expect(registeredLogs.logs.filter((log) => log.event === "step.started")).toHaveLength(2);

    const originalLogs = (await (
      await runner.fetch(
        new Request("http://runner.test/pipelines/aliased-pipeline/logs?limit=100"),
      )
    ).json()) as { logs: Array<{ event: string }> };
    expect(originalLogs.logs).toEqual([]);
  });

  it("runs pipelines over HTTP and persists runs plus metadata-only pipeline logs", async () => {
    const pipeline = new Pipeline({ id: "audit-pipeline", inputSchema: z.string() })
      .step({ id: "normalize", name: "Normalize", run: ({ input }) => input.trim() })
      .step({
        id: "shape",
        name: "Shape",
        run: ({ input }) => ({ reply: input.toUpperCase() }),
      });
    const studioDbPath = join(studioDbDir ?? tmpdir(), "pipeline.sqlite");
    const runner = new Studio([pipeline], {
      stores: {
        sessions: createSqliteSessionStore({ path: studioDbPath }),
      },
    });

    const run = await runner.fetch(
      new Request("http://runner.test/pipelines/audit-pipeline/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: " raw secret payload ", stream: true }),
      }),
    );

    expect(run.status).toBe(200);
    expect(run.headers.get("content-type")).toContain("application/x-ndjson");
    const events = await readJsonl(run);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "pipeline_log",
        log: expect.objectContaining({ event: "pipeline.run_started" }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "pipeline_log",
        log: expect.objectContaining({ event: "step.started" }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "pipeline_final",
        output: { reply: "RAW SECRET PAYLOAD" },
      }),
    );

    const firstPage = await runner.fetch(
      new Request("http://runner.test/pipelines/audit-pipeline/logs?limit=2"),
    );
    expect(firstPage.status).toBe(200);
    const firstBody = (await firstPage.json()) as {
      logs: Array<{ event: string; sequence: number; metadata?: unknown }>;
      nextCursor?: number;
    };
    expect(firstBody.logs).toHaveLength(2);
    expect(firstBody.logs[0]).toMatchObject({
      event: "pipeline.run_received",
      sequence: 0,
    });
    expect(firstBody.logs[1]).toMatchObject({
      event: "pipeline.run_started",
      sequence: 1,
    });
    expect(firstBody.nextCursor).toBe(1);

    const nextPage = await runner.fetch(
      new Request(`http://runner.test/pipelines/audit-pipeline/logs?after=${firstBody.nextCursor}`),
    );
    expect(nextPage.status).toBe(200);
    const nextBody = (await nextPage.json()) as {
      logs: Array<{ event: string; sequence: number; metadata?: unknown }>;
    };
    expect(nextBody.logs[0]).toMatchObject({
      event: "step.started",
      sequence: 2,
      metadata: { nodeId: "normalize", nodePath: ["normalize"] },
    });
    expect(nextBody.logs.map((log) => log.event)).toContain("pipeline.run_completed");
    expect(nextBody).not.toHaveProperty("nextCursor");

    const serializedLogs = JSON.stringify([...firstBody.logs, ...nextBody.logs]);
    expect(serializedLogs).not.toContain("raw secret payload");
    expect(serializedLogs).not.toContain("RAW SECRET PAYLOAD");

    const runsPage = await runner.fetch(
      new Request("http://runner.test/pipelines/audit-pipeline/runs?limit=10"),
    );
    expect(runsPage.status).toBe(200);
    const runsBody = (await runsPage.json()) as {
      runs: Array<{
        runId: string;
        pipelineId: string;
        status: string;
        input: unknown;
        output?: unknown;
        metadata?: unknown;
      }>;
    };
    expect(runsBody.runs).toHaveLength(1);
    const [savedRun] = runsBody.runs;
    if (savedRun === undefined) {
      throw new Error("Expected a saved pipeline run");
    }
    expect(savedRun).toMatchObject({
      pipelineId: "audit-pipeline",
      status: "success",
      input: " raw secret payload ",
      output: { reply: "RAW SECRET PAYLOAD" },
    });

    const replay = await runner.fetch(
      new Request(`http://runner.test/pipelines/audit-pipeline/runs/${savedRun.runId}/replay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stream: false,
          metadata: { source: "test" },
        }),
      }),
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      pipelineId: "audit-pipeline",
      output: { reply: "RAW SECRET PAYLOAD" },
    });

    const replayRunsPage = await runner.fetch(
      new Request("http://runner.test/pipelines/audit-pipeline/runs?limit=10"),
    );
    expect(replayRunsPage.status).toBe(200);
    const replayRunsBody = (await replayRunsPage.json()) as {
      runs: Array<{
        runId: string;
        input: unknown;
        output?: unknown;
        metadata?: unknown;
      }>;
    };
    expect(replayRunsBody.runs).toHaveLength(2);
    const replayedRun = replayRunsBody.runs.find((run) => run.runId !== savedRun.runId);
    expect(replayedRun).toMatchObject({
      input: " raw secret payload ",
      output: { reply: "RAW SECRET PAYLOAD" },
      metadata: { source: "test", replayOf: savedRun.runId },
    });

    const missingReplay = await runner.fetch(
      new Request("http://runner.test/pipelines/audit-pipeline/runs/missing/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: false }),
      }),
    );
    expect(missingReplay.status).toBe(404);

    const db = new DatabaseSync(studioDbPath);
    try {
      const row = db
        .prepare(
          `SELECT pipeline_id, status, input_json, output_json
           FROM anvia_studio_pipeline_runs
           WHERE run_id = $runId`,
        )
        .get({ $runId: savedRun.runId }) as
        | { pipeline_id: string; status: string; input_json: string; output_json: string }
        | undefined;
      expect(row).toMatchObject({
        pipeline_id: "audit-pipeline",
        status: "success",
        input_json: JSON.stringify(" raw secret payload "),
        output_json: JSON.stringify({ reply: "RAW SECRET PAYLOAD" }),
      });
    } finally {
      db.close();
    }
  });

  it("replays persisted pipeline runs outside the first runs page", async () => {
    const pipeline = new Pipeline({ id: "audit-pipeline", inputSchema: z.string() }).step({
      id: "shape",
      name: "Shape",
      run: ({ input }) => ({ reply: input.toUpperCase() }),
    });
    const store = createSqliteSessionStore({
      path: join(studioDbDir ?? tmpdir(), "replay.sqlite"),
    });
    const runner = new Studio([pipeline], {
      stores: {
        sessions: store,
      },
    });
    const startedAt = Date.parse("2026-01-01T00:00:00.000Z");

    for (let index = 0; index <= 1000; index += 1) {
      store.savePipelineRun({
        runId: `run_${index}`,
        pipelineId: "audit-pipeline",
        status: "success",
        input: `seed ${index}`,
        output: { reply: `SEED ${index}` },
        startedAt: new Date(startedAt + index).toISOString(),
      });
    }

    const replay = await runner.fetch(
      new Request("http://runner.test/pipelines/audit-pipeline/runs/run_0/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: false, metadata: { source: "regression" } }),
      }),
    );

    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      pipelineId: "audit-pipeline",
      output: { reply: "SEED 0" },
    });
  });

  it("loads pipeline runs by exact id from built-in stores", () => {
    const stores = [
      createInMemoryStudioStore(),
      createSqliteSessionStore({ path: join(studioDbDir ?? tmpdir(), "exact-run.sqlite") }),
    ];

    for (const store of stores) {
      store.savePipelineRun({
        runId: "run_1",
        pipelineId: "pipeline_a",
        status: "success",
        input: "hello",
        output: "HELLO",
        startedAt: "2026-01-01T00:00:00.000Z",
      });
      store.savePipelineRun({
        runId: "run_2",
        pipelineId: "pipeline_b",
        status: "success",
        input: "other",
        output: "OTHER",
        startedAt: "2026-01-01T00:00:01.000Z",
      });

      expect(store.getPipelineRun({ pipelineId: "pipeline_a", runId: "run_1" })).toMatchObject({
        runId: "run_1",
        pipelineId: "pipeline_a",
        input: "hello",
        output: "HELLO",
      });
      expect(store.getPipelineRun({ pipelineId: "pipeline_b", runId: "run_1" })).toBeUndefined();
      expect(store.getPipelineRun({ pipelineId: "pipeline_a", runId: "missing" })).toBeUndefined();
    }
  });

  it("starts a served single-agent runner", async () => {
    const agent = new Agent({
      id: "support",
      model: new QueueModel([response([AssistantContent.text("ok")])]),
      name: "Support",
      description: "Support assistant",
    });
    const runner = new Studio([agent]).start({ port: 0, log: false });

    try {
      expect(runner.config()).toMatchObject({
        id: "anvia-studio",
        agents: [{ id: "support", name: "Support", description: "Support assistant" }],
        capabilities: {
          agents: { enabled: true },
          sessions: { enabled: true },
          traces: { enabled: true },
        },
      });

      const res = await runner.fetch(
        new Request("http://runner.test/agents/support/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "messages", messages: [Message.user("hi")] }),
        }),
      );
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ output: "ok" });
    } finally {
      runner.close();
    }
  });

  it("can leave process signal handling to the application", () => {
    const listenersBeforeStart = process.listeners("SIGINT");
    const agent = new Agent({ id: "support", model: new QueueModel([]) });
    const runner = new Studio([agent]).start({ port: 0, log: false, handleSignals: false });

    try {
      expect(process.listeners("SIGINT")).toEqual(listenersBeforeStart);
    } finally {
      runner.close();
    }
  });

  it("serves until aborted and awaits shutdown cleanup", async () => {
    const controller = new AbortController();
    const agent = new Agent({ id: "support", model: new QueueModel([]) });
    const studio = new Studio([agent]);
    let releaseCleanup: () => void = () => {};
    let markCleanupStarted: () => void = () => {};
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const cleanupStarted = new Promise<void>((resolve) => {
      markCleanupStarted = resolve;
    });

    const serving = studio.serve({
      port: 0,
      log: false,
      signal: controller.signal,
      onShutdown: async () => {
        markCleanupStarted();
        await cleanupGate;
      },
    });

    controller.abort();
    await cleanupStarted;

    let settled = false;
    void serving.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseCleanup();
    await serving;
    expect(settled).toBe(true);
  });

  it("runs serve shutdown cleanup when the port is unavailable", async () => {
    const blocker = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => {
        const address = blocker.address();
        if (typeof address === "object" && address !== null) resolve(address.port);
        else reject(new Error("Expected a TCP server address"));
      });
    });
    const agent = new Agent({ id: "support", model: new QueueModel([]) });
    const studio = new Studio([agent]);
    let cleanedUp = false;

    try {
      await expect(
        studio.serve({
          port,
          hostname: "127.0.0.1",
          log: false,
          onShutdown: () => {
            cleanedUp = true;
          },
        }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
      expect(cleanedUp).toBe(true);
    } finally {
      blocker.close();
      studio.close();
    }
  });

  it("uses built-in stores with automatic Studio traces", async () => {
    const model = new QueueModel([response([AssistantContent.text("traced")])]);
    const agent = new Agent({
      id: "support",
      model,
      name: "Support",
      description: "Support assistant",
    });
    const studio = new Studio([agent]).start({ port: 0, log: false });

    try {
      const created = await studio.fetch(
        new Request("http://runner.test/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentId: "support" }),
        }),
      );
      expect(created.status).toBe(201);
      const session = (await created.json()) as { id: string };

      const run = await studio.fetch(
        new Request("http://runner.test/agents/support/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "messages",
            messages: [Message.user("trace me")],
            sessionId: session.id,
          }),
        }),
      );
      expect(run.status).toBe(200);

      const traces = (await (
        await studio.fetch(new Request(`http://runner.test/sessions/${session.id}/traces`))
      ).json()) as { traces: Array<{ status: string; output: string }> };
      expect(traces.traces).toEqual([
        expect.objectContaining({ status: "success", output: "traced" }),
      ]);
    } finally {
      studio.close();
    }
  });

  it("preserves dynamic context when Studio wraps agents for traces", async () => {
    const embeddings = new KeywordEmbeddingModel();
    const { documents: embedded } = await embedDocuments({
      model: embeddings,
      documents: [{ id: "refund-policy", text: "Refund policy is 30 days." }],
      id: (document) => document.id,
      content: (document) => document.text,
    });
    const store = InMemoryVectorStore.fromDocuments({ documents: embedded });
    const model = new QueueModel([response([AssistantContent.text("ok")])]);
    const agent = new Agent({
      id: "support",
      model,
      context: [
        createVectorContext({
          store,
          model: embeddings,
          topK: 1,
          format: (result) => ({ id: result.id, text: result.document.text }),
        }),
      ],
    });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("refund policy")],
          sessionId: session.id,
        }),
      }),
    );

    expect(run.status).toBe(200);
    expect(model.requests[0]?.documents).toEqual([
      expect.objectContaining({
        id: "refund-policy",
        text: "Refund policy is 30 days.",
      }),
    ]);
  });

  it("preserves dynamic tools when Studio wraps agents for traces", async () => {
    const embeddings = new KeywordEmbeddingModel();
    const index = await createToolIndex({
      model: embeddings,
      tools: [lookupPolicyTool],
      topK: 1,
    });
    const model = new QueueModel([response([AssistantContent.text("ok")])]);
    const agent = new Agent({ id: "support", model, tools: [index] });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("refund policy")],
          sessionId: session.id,
        }),
      }),
    );

    expect(run.status).toBe(200);
    expect(model.requests[0]?.tools).toEqual([
      expect.objectContaining({
        name: "lookup_policy",
      }),
    ]);
  });

  it("preserves provider tools when Studio wraps agents for traces", async () => {
    const providerTool: ProviderTool = {
      kind: "provider",
      provider: "test",
      name: "web_search",
    };
    const model = new QueueModel([response([AssistantContent.text("ok")])]);
    const agent = new Agent({ id: "support", model, tools: [providerTool] });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("research")],
          sessionId: session.id,
        }),
      }),
    );

    expect(run.status).toBe(200);
    expect(model.requests[0]?.providerTools).toEqual([providerTool]);
  });

  it("exposes tool metadata for registered agents", async () => {
    const embeddings = new KeywordEmbeddingModel();
    const index = await createToolIndex({
      model: embeddings,
      tools: [lookupPolicyTool],
      topK: 1,
    });
    const refundTool = createRefundTool(() => "ok");
    const agent = new Agent({
      id: "support",
      model: new QueueModel([]),
      tools: [addTool, refundTool, index],
    });
    const runner = new Studio([agent]);

    expect(runner.config().capabilities.tools).toEqual({ enabled: true });

    const res = await runner.fetch(new Request("http://runner.test/agents/support/tools"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      agentId: "support",
      tools: [
        expect.objectContaining({
          agentId: "support",
          name: "add",
          description: "Add numbers",
          source: "static",
          approval: { required: false },
          parameters: expect.objectContaining({ type: "object" }),
        }),
        expect.objectContaining({
          agentId: "support",
          name: "issue_refund",
          source: "static",
          approval: { required: true },
        }),
        expect.objectContaining({
          agentId: "support",
          name: "lookup_policy",
          description: "Look up policy documents",
          source: "dynamic",
          approval: { required: false },
        }),
      ],
    });
  });

  it("runs registered tools directly", async () => {
    const agent = new Agent({ id: "support", model: new QueueModel([]), tools: [addTool] });
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/tools/add/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args: { x: 2, y: 3 } }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      agentId: "support",
      toolName: "add",
      status: "success",
      result: { type: "json", value: 5 },
      events: [],
    });
  });

  it("exposes only explicitly registered sandbox inspectors", async () => {
    const inspector = {
      id: "workspace_1",
      provider: "test-sandbox",
      workdir: "/workspace",
      listFiles: async () => [{ path: "notes.txt", type: "file" as const, size: 5 }],
      readFile: async () => new TextEncoder().encode("hello"),
    };
    const tool: Tool<Record<string, never>, string> = {
      name: "list_files",
      definition: () => ({
        name: "list_files",
        description: "List sandbox files",
        parameters: { type: "object", properties: {} },
      }),
      call: () => "notes.txt",
    };
    const agent = new Agent({ id: "coder", model: new QueueModel([]), tools: [tool] });
    const implicit = new Studio([agent]);
    expect(implicit.config().capabilities.sandboxes).toBeUndefined();

    const runner = new Studio([agent], {
      sandboxes: [
        {
          inspector,
          agentIds: ["coder"],
          toolNames: ["list_files"],
        },
      ],
    });

    expect(runner.config().capabilities.sandboxes).toEqual({ enabled: true });
    const sandboxes = await runner.fetch(new Request("http://runner.test/sandboxes"));
    expect(sandboxes.status).toBe(200);
    await expect(sandboxes.json()).resolves.toMatchObject({
      sandboxes: [
        {
          id: "workspace_1",
          provider: "test-sandbox",
          workdir: "/workspace",
          agentIds: ["coder"],
          toolNames: ["list_files"],
        },
      ],
    });

    const status = await runner.fetch(new Request("http://runner.test/status"));
    await expect(status.json()).resolves.toMatchObject({
      counts: { sandboxes: 1 },
      capabilities: { sandboxes: { enabled: true } },
    });
  });

  it("exposes runtime status and richer agent runtime metadata", async () => {
    const agent = new Agent({
      id: "support",
      name: "Support",
      model: new QueueModel([]),
      tools: [addTool],
      maxTurns: 4,
      lifecycle: { onStart() {} },
    });
    const runner = new Studio([agent]);

    expect(runner.config().agents[0]?.metadata).toMatchObject({ hasLifecycle: true });

    const status = await runner.fetch(new Request("http://runner.test/status"));
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      runner: { id: "anvia-studio" },
      storage: {
        sessions: "memory",
        traces: "memory",
        pipelineLogs: "available",
        pipelineRuns: "available",
      },
      counts: { agents: 1, pipelines: 0, sessions: 0, traces: 0 },
      capabilities: {
        agents: { enabled: true },
        memory: { enabled: true },
        sessions: { enabled: true },
        status: { enabled: true },
        tools: { enabled: true },
        traces: { enabled: true },
      },
    });

    const runtime = await runner.fetch(new Request("http://runner.test/agents/support/runtime"));
    expect(runtime.status).toBe(200);
    await expect(runtime.json()).resolves.toMatchObject({
      id: "support",
      name: "Support",
      toolCount: 1,
      staticToolCount: 1,
      dynamicToolCount: 0,
      approvalToolCount: 0,
      mcpToolCount: 0,
      hasMemory: false,
      hasLifecycle: true,
      hasOutputSchema: false,
      defaultMaxTurns: 4,
    });
  });

  it("serializes cyclic model metadata in runtime summaries", async () => {
    const model = new QueueModel([]);
    Object.assign(model, { self: model });
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const runtime = await runner.fetch(new Request("http://runner.test/agents/support/runtime"));
    expect(runtime.status).toBe(200);
    await expect(runtime.json()).resolves.toMatchObject({
      id: "support",
      model: {
        provider: "test",
        self: "[Circular]",
      },
    });
  });

  it("exposes MCP server metadata for registered agents", async () => {
    const mcpTool: McpTool = {
      name: "github_lookup_policy",
      mcp: { serverName: "policies", remoteName: "lookup_policy" },
      definition() {
        return {
          name: "github_lookup_policy",
          description: "Look up policy documents",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        };
      },
      async call() {
        return [{ type: "text", text: "policy" }];
      },
    };
    const mcpServer: McpServer = {
      name: "policies",
      tools: [mcpTool],
    };
    const agent = new Agent({
      id: "support",
      model: new QueueModel([]),
      mcpServers: [mcpServer],
    });
    const runner = new Studio([agent]);

    expect(runner.config().capabilities.mcps).toEqual({ enabled: true });

    const res = await runner.fetch(new Request("http://runner.test/agents/support/mcps"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      agentId: "support",
      servers: [
        {
          agentId: "support",
          name: "policies",
          toolCount: 1,
          tools: [
            {
              name: "github_lookup_policy",
              description: "Look up policy documents",
              source: "static",
              approval: { required: false },
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" },
                },
                required: ["query"],
              },
            },
          ],
        },
      ],
    });

    const toolsRes = await runner.fetch(new Request("http://runner.test/agents/support/tools"));
    expect(toolsRes.status).toBe(200);
    await expect(toolsRes.json()).resolves.toEqual({
      agentId: "support",
      tools: [
        expect.objectContaining({
          agentId: "support",
          name: "github_lookup_policy",
          source: "static",
          mcpServerName: "policies",
        }),
      ],
    });

    const toolRun = await runner.fetch(
      new Request("http://runner.test/agents/support/tools/github_lookup_policy/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args: { query: "refunds" } }),
      }),
    );
    expect(toolRun.status).toBe(200);
    await expect(toolRun.json()).resolves.toMatchObject({
      toolName: "github_lookup_policy",
      status: "success",
      result: {
        type: "json",
        value: [{ type: "text", text: "policy" }],
      },
    });
  });

  it("reports knowledge capability and exposes the knowledge inspector route", async () => {
    const agent = new Agent({
      id: "support",
      model: new QueueModel([]),
      context: [{ id: "refund-policy", text: "Refund policy is 30 days." }],
    });
    const runner = new Studio([agent]);

    expect(runner.config().capabilities).toMatchObject({
      knowledge: { enabled: true },
    });
    expect(runner.config().capabilities).not.toHaveProperty("evaluation");

    const knowledge = (await (
      await runner.fetch(new Request("http://runner.test/knowledge"))
    ).json()) as {
      agents: Array<{ agentId: string; staticContext: Array<{ id: string; text: string }> }>;
    };
    expect(knowledge.agents).toEqual([
      expect.objectContaining({
        agentId: "support",
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourceId: "static-context",
            kind: "static_context",
            inspectable: true,
            itemCount: 1,
          }),
        ]),
        staticContext: [{ id: "refund-policy", text: "Refund policy is 30 days." }],
      }),
    ]);

    const items = (await (
      await runner.fetch(
        new Request("http://runner.test/knowledge/items?agentId=support&sourceId=static-context"),
      )
    ).json()) as unknown;
    expect(items).toEqual({
      agentId: "support",
      sourceId: "static-context",
      kind: "static_context",
      inspectable: true,
      items: [{ id: "refund-policy", kind: "static_context", text: "Refund policy is 30 days." }],
      totalCount: 1,
    });

    const evaluations = await runner.fetch(new Request("http://runner.test/evaluations"));
    expect(evaluations.status).toBe(404);
  });

  it("exposes inspectable dynamic knowledge items and unsupported source states", async () => {
    const embeddings = new KeywordEmbeddingModel();
    const { documents: embedded } = await embedDocuments({
      model: embeddings,
      documents: [
        { id: "refund-policy", text: "Refund policy is 30 days." },
        { id: "shipping-policy", text: "Shipping updates go to operations." },
      ],
      id: (document) => document.id,
      content: (document) => document.text,
    });
    const inspectableStore = InMemoryVectorStore.fromDocuments({ documents: embedded });
    const unsupportedStore: VectorStore<{ text: string }> = {
      async ensure() {},
      async validate() {},
      async upsert() {},
      async search() {
        return [];
      },
    };
    const toolIndex = await createToolIndex({
      model: embeddings,
      tools: [lookupPolicyTool],
      topK: 1,
    });
    const agent = new Agent({
      id: "support",
      model: new QueueModel([]),
      context: [
        createVectorContext({ store: inspectableStore, model: embeddings, topK: 1 }),
        createVectorContext({ store: unsupportedStore, model: embeddings, topK: 1 }),
      ],
      tools: [toolIndex],
    });
    const runner = new Studio([agent]);

    const knowledge = (await (
      await runner.fetch(new Request("http://runner.test/knowledge"))
    ).json()) as {
      agents: Array<{
        sources: Array<{ sourceId: string; inspectable: boolean; itemCount?: number }>;
      }>;
    };
    expect(knowledge.agents[0]?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "dynamic-context-0",
          inspectable: true,
          itemCount: 2,
        }),
        expect.objectContaining({ sourceId: "dynamic-context-1", inspectable: false }),
        expect.objectContaining({ sourceId: "dynamic-tools-0", inspectable: true, itemCount: 1 }),
      ]),
    );

    const dynamicItems = (await (
      await runner.fetch(
        new Request(
          "http://runner.test/knowledge/items?agentId=support&sourceId=dynamic-context-0&limit=1",
        ),
      )
    ).json()) as unknown;
    expect(dynamicItems).toMatchObject({
      agentId: "support",
      sourceId: "dynamic-context-0",
      kind: "dynamic_context",
      inspectable: true,
      nextCursor: "1",
      totalCount: 2,
      items: [{ id: "refund-policy", kind: "dynamic_context", text: "Refund policy is 30 days." }],
    });

    const toolItems = (await (
      await runner.fetch(
        new Request("http://runner.test/knowledge/items?agentId=support&sourceId=dynamic-tools-0"),
      )
    ).json()) as unknown;
    expect(toolItems).toMatchObject({
      agentId: "support",
      sourceId: "dynamic-tools-0",
      kind: "dynamic_tools",
      inspectable: true,
      totalCount: 1,
      items: [
        {
          id: "lookup_policy",
          kind: "dynamic_tool",
          toolName: "lookup_policy",
          description: "Look up policy documents",
          parameterKeys: ["query"],
        },
      ],
    });

    const unsupported = (await (
      await runner.fetch(
        new Request(
          "http://runner.test/knowledge/items?agentId=support&sourceId=dynamic-context-1",
        ),
      )
    ).json()) as unknown;
    expect(unsupported).toMatchObject({
      agentId: "support",
      sourceId: "dynamic-context-1",
      kind: "dynamic_context",
      inspectable: false,
      items: [],
    });
  });

  it("starts a served runner from configured agents", async () => {
    const agent = new Agent({
      id: "support",
      model: new QueueModel([response([AssistantContent.text("ok")])]),
      name: "Support",
      tools: [createRefundTool(() => "ok")],
    });
    const runner = new Studio([agent], {
      quickPrompts: {
        support: ["Issue a refund"],
      },
    }).start({ port: 0, log: false });

    try {
      expect(runner.config()).toMatchObject({
        agents: [{ id: "support", name: "Support", quickPrompts: ["Issue a refund"] }],
        capabilities: { interactions: { enabled: true } },
      });

      const res = await runner.fetch(
        new Request("http://runner.test/agents/support/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "messages", messages: [Message.user("hi")] }),
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      runner.close();
    }
  });

  it("runs an agent without streaming and passes history", async () => {
    const model = new QueueModel([response([AssistantContent.text("Anvia")])]);
    const agent = new Agent({ id: "support", model, instructions: "system" });
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [
            Message.user("The project is Anvia."),
            Message.assistant("Noted."),
            Message.user("What is this?"),
          ],
          maxTurns: 2,
          toolConcurrency: 3,
          metadata: { requestId: "req_1" },
        }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ output: "Anvia" });
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]?.instructions).toBe("system");
    expect(model.requests[0]?.chatHistory).toEqual([
      Message.user("The project is Anvia."),
      Message.assistant("Noted."),
      Message.user("What is this?"),
    ]);
  });

  it("links separate buffered runs across an interaction response", async () => {
    let executed = false;
    const refundTool = createRefundTool(({ orderId, amount }) => {
      executed = true;
      return `Refunded ${amount} for ${orderId}`;
    });
    const observer = new TraceObserver();
    const model = new QueueModel([
      response([
        AssistantContent.toolCall(
          "tool_1",
          "issue_refund",
          { orderId: "ORD-1", amount: 25 },
          "call_1",
        ),
      ]),
      response([AssistantContent.text("Refund complete")]),
    ]);
    const agent = new Agent({
      id: "support",
      model,
      tools: [refundTool],
      observability: { observers: { external: observer }, primaryTrace: "external" },
      maxTurns: 2,
    });
    const runner = new Studio([agent]);

    const firstResponse = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("refund")],
          maxTurns: 2,
          trace: { name: "interaction-phase", metadata: { source: "test" } },
        }),
      }),
    );
    const first = (await firstResponse.json()) as AgentRunResponse;
    if (first.status !== "suspended") throw new Error("Expected suspended run");
    expect(first).not.toHaveProperty("continuation");
    expect(first).not.toHaveProperty("messages");
    expect(executed).toBe(false);

    const resumedResponse = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "interaction_response",
          interactionId: first.interaction.id,
          response: { type: "tool-approval", approved: true },
        }),
      }),
    );
    expect(resumedResponse.status).toBe(200);
    const result = (await resumedResponse.json()) as AgentRunResponse;
    expect(result).toMatchObject({
      status: "completed",
      output: "Refund complete",
      resumedFrom: {
        runId: first.runId,
        interactionId: first.interaction.id,
      },
    });
    expect(result.runId).not.toBe(first.runId);
    expect(observer.starts.map((start) => start.runId)).toEqual([first.runId, result.runId]);
    expect(observer.starts.map((start) => start.trace)).toEqual([
      expect.objectContaining({
        name: "interaction-phase",
        metadata: expect.objectContaining({ source: "test" }),
      }),
      expect.objectContaining({
        name: "interaction-phase",
        metadata: expect.objectContaining({ source: "test" }),
      }),
    ]);
    expect(executed).toBe(true);
  });

  it("inherits configured retries for buffered agent runs", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new FlakyQueueModel([
      { error },
      { response: response([AssistantContent.text("recovered")]) },
    ]);
    const agent = new Agent({
      id: "support",
      model,
      retries: { initialDelayMs: 0, maxDelayMs: 0 },
    });
    const runner = new Studio([agent]);
    const random = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      const res = await runner.fetch(
        new Request("http://runner.test/agents/support/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "messages", messages: [Message.user("hi")] }),
        }),
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ output: "recovered" });
      expect(model.requests).toHaveLength(2);
      expect(model.requests[1]).toBe(model.requests[0]);
    } finally {
      random.mockRestore();
    }
  });

  it("passes trace options to observed non-streaming runs and preserves trace output", async () => {
    const observer = new TraceObserver();
    const model = new QueueModel([response([AssistantContent.text("traced")])]);
    const agent = new Agent({
      id: "support",
      model,
      observability: { observers: { external: observer }, primaryTrace: "external" },
    });
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("trace me")],
          trace: {
            name: "ui-run",
            sessionId: "session_1",
            userId: "user_1",
            metadata: { source: "runner-ui" },
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      output: "traced",
      trace: {
        observer: "studio",
        traceId: expect.any(String),
        observationId: expect.any(String),
      },
    });
    expect(observer.starts[0]?.trace).toMatchObject({
      name: "ui-run",
      sessionId: "session_1",
      userId: "user_1",
      metadata: { source: "runner-ui" },
    });
  });

  it("streams agent events as JSONL", async () => {
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "hello" }]]);
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "messages", messages: [Message.user("hi")], stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("x-anvia-stream-protocol")).toBe("anvia.client.v3");
    expect(await readJsonl(res)).toEqual([
      expect.objectContaining({ type: "run_start", source: "agent" }),
      expect.objectContaining({ type: "turn_start", turn: 1 }),
      expect.objectContaining({
        type: "generation_start",
        turn: 1,
        model: { provider: "test", modelId: "test" },
      }),
      expect.objectContaining({ type: "message_start", turn: 1, role: "assistant" }),
      expect.objectContaining({ type: "text_start", turn: 1 }),
      expect.objectContaining({ type: "text_delta", turn: 1, delta: "hello" }),
      expect.objectContaining({ type: "text_end", turn: 1, text: "hello" }),
      expect.objectContaining({ type: "message_end", turn: 1 }),
      expect.objectContaining({ type: "turn_end", turn: 1 }),
      expect.objectContaining({
        type: "run_end",
        status: "completed",
        output: "hello",
      }),
    ]);
  });

  it("inherits configured retries for streaming agent runs", async () => {
    const error = Object.assign(new Error("temporarily unavailable"), { status: 503 });
    const model = new StreamingQueueModel([
      streamThenThrow([], error),
      [{ type: "text_delta", delta: "recovered" }],
    ]);
    const agent = new Agent({
      id: "support",
      model,
      retries: { initialDelayMs: 0, maxDelayMs: 0 },
    });
    const runner = new Studio([agent]);
    const random = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      const res = await runner.fetch(
        new Request("http://runner.test/agents/support/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "messages", messages: [Message.user("hi")], stream: true }),
        }),
      );
      const events = await readJsonl(res);

      expect(res.status).toBe(200);
      expect(events).not.toContainEqual(expect.objectContaining({ type: "error" }));
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "run_end",
          status: "completed",
          output: "recovered",
        }),
      );
      expect(model.requests).toHaveLength(2);
      expect(model.requests[1]).toBe(model.requests[0]);
    } finally {
      random.mockRestore();
    }
  });

  it("accepts shared UI-style agent run requests", async () => {
    const model = new QueueModel([response([AssistantContent.text("hello")])]);
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("hi")],
          metadata: { source: "test" },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(model.requests[0]?.chatHistory).toEqual([Message.user("hi")]);
  });

  it("normalizes UI-style agent run messages into history plus the latest prompt", async () => {
    const model = new QueueModel([response([AssistantContent.text("next")])]);
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("before"), Message.assistant("old"), Message.user("next")],
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(model.requests[0]?.chatHistory).toEqual([
      Message.user("before"),
      Message.assistant("old"),
      Message.user("next"),
    ]);
  });

  it("rejects UI-style history combined with a session id", async () => {
    const agent = new Agent({ id: "support", model: new QueueModel([]) });
    const runner = new Studio([agent]);
    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("before"), Message.user("next")],
          sessionId: session.id,
        }),
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { message: "sessionId requires exactly one user message" },
    });
  });

  it("rejects mixed legacy and canonical message bodies", async () => {
    const model = new QueueModel([response([AssistantContent.text("legacy")])]);
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "legacy",
          messages: [Message.user("ui")],
        }),
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { message: "Legacy message/history requests are not supported; use messages" },
    });
    expect(model.requests).toHaveLength(0);
  });

  it("suspends a protected stream and resumes it through the canonical run route", async () => {
    let executed = false;
    const refundTool = createRefundTool(({ orderId, amount }) => {
      executed = true;
      return `Refunded ${amount} for ${orderId}`;
    });
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "issue_refund",
          argumentsDelta: '{"orderId":"ORD-1","amount":25}',
        },
      ],
      [{ type: "text_delta", delta: "Refund complete" }],
    ]);
    const runner = new Studio([
      new Agent({ id: "support", model, tools: [refundTool], maxTurns: 2 }),
    ]);

    const firstResponse = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("refund")],
          stream: true,
        }),
      }),
    );
    const firstEvents = await readJsonl(firstResponse);
    const interactionEvent = firstEvents.find(
      (event) =>
        (event as { type?: string }).type === "interaction" &&
        (event as { interaction?: { type?: string } }).interaction?.type === "tool-approval",
    ) as { interaction: { id: string }; runId: string } | undefined;
    expect(interactionEvent).toBeDefined();
    expect(executed).toBe(false);
    expect(firstEvents).toContainEqual(
      expect.objectContaining({
        type: "run_end",
        status: "suspended",
        runId: interactionEvent?.runId,
      }),
    );

    const resumedResponse = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "interaction_response",
          interactionId: interactionEvent?.interaction.id,
          response: { type: "tool-approval", approved: true, reason: "Reviewed" },
          stream: true,
        }),
      }),
    );
    const resumedEvents = await readJsonl(resumedResponse);
    expect(executed).toBe(true);
    expect(resumedEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: { status: "success", output: "Refunded 25 for ORD-1" },
      }),
    );
    const resumedEnd = resumedEvents.find(
      (event) => (event as { type?: string }).type === "run_end",
    ) as { runId: string; status: string } | undefined;
    expect(resumedEnd).toMatchObject({ status: "completed" });
    expect(resumedEnd?.runId).not.toBe(interactionEvent?.runId);

    const duplicate = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "interaction_response",
          interactionId: interactionEvent?.interaction.id,
          response: { type: "tool-approval", approved: true },
        }),
      }),
    );
    expect(duplicate.status).toBe(409);
  });

  it("rejects a protected tool without executing it", async () => {
    let executed = false;
    const model = new QueueModel([
      response([
        AssistantContent.toolCall("call_1", "issue_refund", {
          orderId: "ORD-1",
          amount: 25,
        }),
      ]),
      response([AssistantContent.text("Refund denied")]),
    ]);
    const runner = new Studio([
      new Agent({
        id: "support",
        model,
        tools: [
          createRefundTool(() => {
            executed = true;
            return "should not run";
          }),
        ],
        maxTurns: 2,
      }),
    ]);

    const firstResponse = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("refund")],
        }),
      }),
    );
    const first = (await firstResponse.json()) as AgentRunResponse;
    if (first.status !== "suspended") throw new Error("Expected suspended run");

    const resumedResponse = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "interaction_response",
          interactionId: first.interaction.id,
          response: {
            type: "tool-approval",
            approved: false,
            reason: "Rejected in Anvia Studio.",
          },
        }),
      }),
    );
    expect(resumedResponse.status).toBe(200);
    await expect(resumedResponse.json()).resolves.toMatchObject({
      status: "completed",
      output: "Refund denied",
      resumedFrom: { runId: first.runId, interactionId: first.interaction.id },
    });
    expect(executed).toBe(false);
  });

  it("uses the first-class question tool and validates answers on resume", async () => {
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "ask_question",
          argumentsDelta: JSON.stringify({
            questions: [
              {
                id: "priority",
                text: "Which priority should we use?",
                choices: [
                  { label: "Low", value: "low" },
                  { label: "High", value: "high" },
                ],
              },
              { id: "notes", text: "Any extra context?" },
            ],
          }),
        },
      ],
      [{ type: "text_delta", delta: "Thanks for the context" }],
    ]);
    const runner = new Studio([
      new Agent({ id: "support", model, tools: [askQuestionTool], maxTurns: 2 }),
    ]);

    const firstResponse = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("ask")],
          stream: true,
        }),
      }),
    );
    const firstEvents = await readJsonl(firstResponse);
    const interactionEvent = firstEvents.find(
      (event) =>
        (event as { type?: string }).type === "interaction" &&
        (event as { interaction?: { type?: string } }).interaction?.type === "tool-question",
    ) as { interaction: { id: string; questions: unknown[] } } | undefined;
    expect(interactionEvent?.interaction.questions).toHaveLength(2);

    const invalid = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "interaction_response",
          interactionId: interactionEvent?.interaction.id,
          response: {
            type: "tool-question",
            answers: [{ questionId: "priority", value: "high" }],
          },
        }),
      }),
    );
    expect(invalid.status).toBe(400);

    const resumedResponse = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "interaction_response",
          interactionId: interactionEvent?.interaction.id,
          response: {
            type: "tool-question",
            answers: [
              { questionId: "priority", value: "high" },
              { questionId: "notes", value: "Customer is blocked." },
            ],
          },
          stream: true,
        }),
      }),
    );
    const resumedEvents = await readJsonl(resumedResponse);
    expect(resumedEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: {
          status: "success",
          output: {
            answers: [
              { questionId: "priority", value: "high" },
              { questionId: "notes", value: "Customer is blocked." },
            ],
          },
        },
      }),
    );
    expect(resumedEvents).toContainEqual(
      expect.objectContaining({ type: "run_end", status: "completed" }),
    );
  });

  it("does not claim continuations across Studio process restarts", async () => {
    const model = new QueueModel([
      response([
        AssistantContent.toolCall("call_1", "issue_refund", {
          orderId: "ORD-1",
          amount: 25,
        }),
      ]),
    ]);
    const agent = new Agent({
      id: "support",
      model,
      tools: [createRefundTool(() => "done")],
    });
    const firstRunner = new Studio([agent]);
    const firstResponse = await firstRunner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("refund")],
        }),
      }),
    );
    const first = (await firstResponse.json()) as AgentRunResponse;
    if (first.status !== "suspended") throw new Error("Expected suspended run");

    const restartedRunner = new Studio([agent]);
    const unavailable = await restartedRunner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "interaction_response",
          interactionId: first.interaction.id,
          response: { type: "tool-approval", approved: true },
        }),
      }),
    );
    expect(unavailable.status).toBe(404);
  });

  it("runs approval metadata tools directly when the approval condition is false", async () => {
    let executed = false;
    const refundTool = {
      ...createRefundTool(({ orderId, amount }) => {
        executed = true;
        return `Refunded ${amount} for ${orderId}`;
      }),
      requiresApproval: false,
    } satisfies Tool<{ orderId: string; amount: number }, string>;
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "issue_refund",
          argumentsDelta: '{"orderId":"ORD-1","amount":25}',
        },
      ],
      [{ type: "text_delta", delta: "Refund complete" }],
    ]);
    const agent = new Agent({ id: "support", model, tools: [refundTool], maxTurns: 2 });
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("refund")],
          stream: true,
        }),
      }),
    );

    expect(res.status).toBe(200);
    const events = await readJsonl(res);
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "interaction",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: { status: "success", output: "Refunded 25 for ORD-1" },
      }),
    );
    expect(executed).toBe(true);
  });

  it("flushes reasoning deltas before the run completes", async () => {
    const model = new GatedReasoningModel();
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("hi")],
          sessionId: session.id,
          stream: true,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const reader = createJsonlReader(res);
    let reasoningEvent: unknown;
    while (reasoningEvent === undefined) {
      const event = await withTimeout(reader.read(), 1_000);
      if ((event as { type?: string }).type === "reasoning_delta") {
        reasoningEvent = event;
      }
    }

    expect(reasoningEvent).toMatchObject({
      type: "reasoning_delta",
      delta: "thinking",
    });
    const remainingEvents = readRemainingJsonl(reader);
    await waitFor(() => model.releaseText !== undefined);
    model.releaseText?.();
    await expect(remainingEvents).resolves.toContainEqual(
      expect.objectContaining({ type: "run_end", status: "completed" }),
    );
  });

  it("preserves trace output on streaming final events", async () => {
    const observer = new TraceObserver("trace_stream");
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "hello" }]]);
    const agent = new Agent({
      id: "support",
      model,
      observability: { observers: { external: observer }, primaryTrace: "external" },
    });
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("hi")],
          stream: true,
          trace: { name: "stream" },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await readJsonl(res)).toContainEqual(
      expect.objectContaining({
        type: "run_end",
        status: "completed",
        trace: {
          observer: "studio",
          traceId: expect.any(String),
          observationId: expect.any(String),
        },
      }),
    );
    expect(observer.starts[0]?.trace).toMatchObject({ name: "stream" });
  });

  it("marks observability enabled when a registered agent has observers", () => {
    const agent = new Agent({
      id: "support",
      model: new QueueModel([]),
      observability: { observers: { external: new TraceObserver() } },
    });
    const runner = new Studio([agent]);

    expect(runner.config().capabilities.observability).toEqual({ enabled: true });
  });

  it("reserves the studio observer name for local trace persistence", () => {
    const agent = new Agent({
      id: "support",
      model: new QueueModel([]),
      observability: { observers: { studio: new TraceObserver() } },
    });

    expect(() => new Studio([agent])).toThrow('reserves the observer name "studio"');
  });

  it("marks interactions enabled when a registered agent protects tools", () => {
    const agent = new Agent({
      id: "support",
      model: new QueueModel([]),
      tools: [createRefundTool(() => "ok")],
    });
    const runner = new Studio([agent]);

    expect(runner.config().capabilities.interactions).toEqual({ enabled: true });
  });

  it("serves the runner UI shell routes", async () => {
    const runner = new Studio();

    const redirect = await runner.fetch(new Request("http://runner.test/"));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/playground");

    const shell = await runner.fetch(new Request("http://runner.test/playground"));
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="anvia-ui"');

    const legacy = await runner.fetch(new Request("http://runner.test/ui"));
    expect(legacy.status).toBe(302);
    expect(legacy.headers.get("location")).toBe("/playground");

    for (const path of [
      "/playground",
      "/playground/session_1",
      "/tracing",
      "/tracing/trace_1",
      "/tracing/sessions/session_1",
      "/sessions",
      "/agents",
      "/tools",
      "/pipelines",
      "/mcps",
      "/memory",
      "/status",
      "/knowledge",
      "/knowledge/static-context",
      "/knowledge/dynamic-context",
      "/knowledge/dynamic-tools",
      "/knowledge/retrieval-log",
    ]) {
      const routeShell = await runner.fetch(
        new Request(`http://runner.test${path}`, {
          headers: { accept: "text/html" },
        }),
      );
      expect(routeShell.status).toBe(200);
      await expect(routeShell.text()).resolves.toContain('id="anvia-ui"');
    }

    for (const [path, location] of [
      ["/ui/playground", "/playground"],
      ["/ui/playground/session_1", "/playground/session_1"],
      ["/ui/tracing", "/tracing"],
      ["/ui/tracing/trace_1", "/tracing/trace_1"],
      ["/ui/tracing/sessions/session_1", "/tracing/sessions/session_1"],
      ["/ui/sessions", "/sessions"],
      ["/ui/agents", "/agents"],
      ["/ui/tools", "/tools"],
      ["/ui/pipelines", "/pipelines"],
      ["/ui/mcps", "/mcps"],
      ["/ui/memory", "/memory"],
      ["/ui/status", "/status"],
      ["/ui/knowledge", "/knowledge"],
      ["/ui/knowledge/static-context", "/knowledge/static-context"],
    ]) {
      const legacyRoute = await runner.fetch(new Request(`http://runner.test${path}`));
      expect(legacyRoute.status).toBe(302);
      expect(legacyRoute.headers.get("location")).toBe(location);
    }
  });

  it("returns 404 for unknown agents", async () => {
    const runner = new Studio();

    const res = await runner.fetch(
      new Request("http://runner.test/agents/missing/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "messages", messages: [Message.user("hi")] }),
      }),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "Agent not found",
      },
    });
  });

  it("creates sessions, persists run history, and reloads from the same SQLite file", async () => {
    const model = new QueueModel([
      response([AssistantContent.text("First answer")]),
      response([AssistantContent.text("Second answer")]),
    ]);
    const path = join(studioDbDir ?? tmpdir(), "studio.sqlite");
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent], {
      stores: {
        sessions: createSqliteSessionStore({ path }),
      },
    });

    const emptyList = await runner.fetch(new Request("http://runner.test/sessions"));
    await expect(emptyList.json()).resolves.toEqual({ sessions: [] });

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support", title: "First question" }),
      }),
    );
    expect(created.status).toBe(201);
    const session = (await created.json()) as { id: string };

    const firstRun = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("First question")],
          sessionId: session.id,
        }),
      }),
    );
    expect(firstRun.status).toBe(200);

    const secondRun = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("Follow up")],
          sessionId: session.id,
        }),
      }),
    );
    expect(secondRun.status).toBe(200);

    expect(model.requests[1]?.chatHistory).toEqual([
      Message.user([{ type: "text", text: "First question" }]),
      expect.objectContaining(Message.assistant("First answer")),
      Message.user("Follow up"),
    ]);

    const reloadedRunner = new Studio([new Agent({ id: "support", model: new QueueModel([]) })], {
      stores: {
        sessions: createSqliteSessionStore({ path }),
      },
    });
    const loaded = await reloadedRunner.fetch(
      new Request(`http://runner.test/sessions/${session.id}`),
    );
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({
      id: session.id,
      agentId: "support",
      title: "First question",
      messageCount: 4,
      messages: [
        Message.user([{ type: "text", text: "First question" }]),
        Message.assistant("First answer"),
        Message.user([{ type: "text", text: "Follow up" }]),
        Message.assistant("Second answer"),
      ],
      transcript: [
        { kind: "message", role: "user", text: "First question" },
        {
          kind: "message",
          role: "assistant",
          text: "First answer",
          durationMs: expect.any(Number),
        },
        { kind: "message", role: "user", text: "Follow up" },
        {
          kind: "message",
          role: "assistant",
          text: "Second answer",
          durationMs: expect.any(Number),
        },
      ],
    });
  });

  it("preserves agent memory stores during Studio session runs", async () => {
    const model = new QueueModel([
      response([AssistantContent.text("First answer")]),
      response([AssistantContent.text("Second answer")]),
    ]);
    const memory = new RecordingMemoryStore();
    const agent = new Agent({ id: "support", model, memory: { store: memory } });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support", title: "Memory session" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const firstRun = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("First question")],
          sessionId: session.id,
        }),
      }),
    );
    expect(firstRun.status).toBe(200);

    const secondRun = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("Follow up")],
          sessionId: session.id,
        }),
      }),
    );
    expect(secondRun.status).toBe(200);

    expect(memory.appendCalls.map((call) => call.messages.map((message) => message.role))).toEqual([
      ["user"],
      ["assistant"],
      ["user"],
      ["assistant"],
    ]);
    expect(model.requests[1]?.chatHistory).toEqual([
      Message.user("First question"),
      expect.objectContaining(Message.assistant("First answer")),
      Message.user("Follow up"),
    ]);

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      messages: [
        Message.user("First question"),
        Message.assistant("First answer"),
        Message.user("Follow up"),
        Message.assistant("Second answer"),
      ],
    });
  });

  it("streams, logs, and persists explicit memory compaction events", async () => {
    const store = createInMemoryStudioStore();
    store.createSession({ id: "compaction-session", agentId: "support" });
    await store.append({
      scope: { sessionId: "compaction-session" },
      runId: "seed",
      turn: 1,
      messages: [
        Message.user("first"),
        Message.assistant("first answer"),
        Message.user("recent"),
        Message.assistant("recent answer"),
      ],
    });
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "done" }]]);
    const agent = new Agent({
      id: "support",
      model,
      memory: {
        store,
        compaction: {
          trigger: { afterMessages: 4 },
          retention: { recentUserTurns: 1 },
          compactor: async () => ({ summary: "Earlier discussion." }),
        },
      },
    });
    const runner = new Studio([agent], { stores: { sessions: store } });

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("next")],
          sessionId: "compaction-session",
          stream: true,
        }),
      }),
    );
    const events = await readJsonl(run);
    const compactionIndex = events.findIndex(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "memory_compaction",
    );
    const firstTurnIndex = events.findIndex(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "turn_start",
    );

    expect(compactionIndex).toBeGreaterThanOrEqual(0);
    expect(firstTurnIndex).toBeGreaterThan(compactionIndex);
    expect(events[compactionIndex]).toMatchObject({
      type: "memory_compaction",
      originalMessageCount: 4,
      compactedMessageCount: 2,
      retainedMessageCount: 2,
      attempts: 1,
      usage: Usage.empty(),
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "data",
        name: "studio.session_log",
        data: expect.objectContaining({ event: "memory.compacted" }),
      }),
    );

    await expect(store.load({ scope: { sessionId: "compaction-session" } })).resolves.toEqual([
      expect.objectContaining({
        role: "system",
        content: "Earlier discussion.",
        metadata: {
          anvia: {
            memoryCompaction: { version: 1, compactedMessageCount: 2 },
          },
        },
      }),
      Message.user("recent"),
      Message.assistant("recent answer"),
      Message.user("next"),
      expect.objectContaining(Message.assistant("done")),
    ]);
    const logs = await runner.fetch(
      new Request("http://runner.test/sessions/compaction-session/logs"),
    );
    await expect(logs.json()).resolves.toMatchObject({
      logs: expect.arrayContaining([
        expect.objectContaining({
          event: "memory.compacted",
          metadata: expect.objectContaining({
            originalMessageCount: 4,
            compactedMessageCount: 2,
            retainedMessageCount: 2,
            attempts: 1,
          }),
        }),
      ]),
    });
  });

  it("preserves buffered failure transcripts and logs after memory compaction", async () => {
    const store = createInMemoryStudioStore();
    store.createSession({ id: "failed-compaction-session", agentId: "support" });
    await store.append({
      scope: { sessionId: "failed-compaction-session" },
      runId: "seed",
      turn: 1,
      messages: [
        Message.user("first"),
        Message.assistant("first answer"),
        Message.user("recent"),
        Message.assistant("recent answer"),
      ],
    });
    const model = new QueueModel([]);
    const agent = new Agent({
      id: "support",
      model,
      memory: {
        store,
        compaction: {
          trigger: { afterMessages: 4 },
          retention: { recentUserTurns: 1 },
          compactor: async () => ({ summary: "Earlier discussion." }),
        },
      },
    });
    const runner = new Studio([agent], { stores: { sessions: store } });

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("next")],
          sessionId: "failed-compaction-session",
        }),
      }),
    );

    expect(run.status).toBe(500);
    expect(model.requests).toHaveLength(1);
    await expect(
      store.load({ scope: { sessionId: "failed-compaction-session" } }),
    ).resolves.toEqual([
      expect.objectContaining({ role: "system", content: "Earlier discussion." }),
      Message.user("recent"),
      Message.assistant("recent answer"),
      Message.user("next"),
    ]);

    const loaded = await runner.fetch(
      new Request("http://runner.test/sessions/failed-compaction-session"),
    );
    await expect(loaded.json()).resolves.toMatchObject({
      transcript: [
        { kind: "message", role: "user", text: "next" },
        {
          kind: "message",
          role: "assistant",
          text: "",
          durationMs: expect.any(Number),
        },
      ],
    });

    const logsResponse = await runner.fetch(
      new Request("http://runner.test/sessions/failed-compaction-session/logs"),
    );
    const { logs } = (await logsResponse.json()) as { logs: Array<{ event: string }> };
    const compactionLogs = logs.filter((log) => log.event === "memory.compacted");
    expect(compactionLogs).toHaveLength(1);
    expect(logs.findIndex((log) => log.event === "run.failed")).toBeGreaterThan(
      logs.findIndex((log) => log.event === "memory.compacted"),
    );
  });

  it("exposes stored sessions through memory explorer routes", async () => {
    const model = new QueueModel([response([AssistantContent.text("Ticket is blocked")])]);
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "support",
          title: "Ticket triage",
          metadata: { userId: "dev_1" },
        }),
      }),
    );
    expect(created.status).toBe(201);
    const session = (await created.json()) as { id: string };

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("Check ticket")],
          sessionId: session.id,
        }),
      }),
    );
    expect(run.status).toBe(200);

    const users = await runner.fetch(new Request("http://runner.test/memory/users"));
    expect(users.status).toBe(200);
    await expect(users.json()).resolves.toMatchObject({
      total: 1,
      users: [
        {
          userId: "dev_1",
          conversationCount: 1,
          agentIds: ["support"],
        },
      ],
    });

    const conversations = await runner.fetch(
      new Request("http://runner.test/memory/conversations?userId=dev_1"),
    );
    expect(conversations.status).toBe(200);
    await expect(conversations.json()).resolves.toMatchObject({
      total: 1,
      conversations: [
        {
          id: session.id,
          userId: "dev_1",
          agentId: "support",
          title: "Ticket triage",
          messageCount: 2,
        },
      ],
    });

    const messages = await runner.fetch(
      new Request(`http://runner.test/memory/conversations/${session.id}/messages`),
    );
    expect(messages.status).toBe(200);
    await expect(messages.json()).resolves.toMatchObject({
      conversation: { id: session.id, userId: "dev_1" },
      messages: [Message.user("Check ticket"), Message.assistant("Ticket is blocked")],
      transcript: [
        { kind: "message", role: "user", text: "Check ticket" },
        { kind: "message", role: "assistant", text: "Ticket is blocked" },
      ],
    });

    const steps = await runner.fetch(
      new Request(`http://runner.test/memory/conversations/${session.id}/steps`),
    );
    expect(steps.status).toBe(200);
    await expect(steps.json()).resolves.toMatchObject({
      conversation: { id: session.id, userId: "dev_1" },
      steps: [
        { kind: "message", role: "user", text: "Check ticket" },
        { kind: "message", role: "assistant", text: "Ticket is blocked" },
      ],
    });
  });

  it("discovers persisted agent memory through source-scoped explorer routes", async () => {
    const memory = new InspectableMemoryStore([
      {
        ref: "database-row-1",
        sessionId: "customer-thread-42",
        userId: "customer-7",
        metadata: { tenantId: "tenant-2" },
        createdAt: "2026-07-17T01:00:00.000Z",
        updatedAt: "2026-07-17T01:05:00.000Z",
        messageCount: 2,
        messages: [
          {
            position: 0,
            runId: "run-1",
            turn: 0,
            createdAt: "2026-07-17T01:00:00.000Z",
            message: Message.user("Remember the invoice"),
          },
          {
            position: 1,
            runId: "run-1",
            turn: 0,
            createdAt: "2026-07-17T01:00:01.000Z",
            message: Message.assistant("Invoice remembered"),
          },
        ],
      },
    ]);
    const support = new Agent({
      id: "support",
      model: new QueueModel([]),
      memory: { store: memory },
    });
    const billing = new Agent({
      id: "billing",
      model: new QueueModel([]),
      memory: { store: memory },
    });
    const fallback = new Agent({ id: "fallback", model: new QueueModel([]) });
    const runner = new Studio([support, billing, fallback]);

    const sourcesResponse = await runner.fetch(new Request("http://runner.test/memory/sources"));
    expect(sourcesResponse.status).toBe(200);
    const sources = (await sourcesResponse.json()) as {
      sources: Array<{
        ref: string;
        kind: string;
        agentIds: string[];
        available: boolean;
      }>;
    };
    expect(sources.sources).toEqual([
      expect.objectContaining({
        kind: "agent",
        agentIds: ["support", "billing"],
        available: true,
      }),
      expect.objectContaining({
        ref: "studio-sessions",
        kind: "studio",
        agentIds: ["fallback"],
        available: true,
      }),
    ]);
    const sourceRef = sources.sources[0]?.ref;
    expect(sourceRef).toBeDefined();

    const conversations = await runner.fetch(
      new Request(`http://runner.test/memory/sources/${sourceRef}/conversations?userId=customer-7`),
    );
    expect(conversations.status).toBe(200);
    await expect(conversations.json()).resolves.toMatchObject({
      total: 1,
      conversations: [
        {
          ref: "database-row-1",
          sessionId: "customer-thread-42",
          userId: "customer-7",
          agentIds: ["support", "billing"],
          messageCount: 2,
          metadata: { tenantId: "tenant-2" },
        },
      ],
    });

    const users = await runner.fetch(
      new Request(`http://runner.test/memory/sources/${sourceRef}/users`),
    );
    await expect(users.json()).resolves.toMatchObject({
      users: [
        {
          userId: "customer-7",
          conversationCount: 1,
          agentIds: ["support", "billing"],
        },
      ],
    });

    const messages = await runner.fetch(
      new Request(
        `http://runner.test/memory/sources/${sourceRef}/conversations/database-row-1/messages`,
      ),
    );
    expect(messages.status).toBe(200);
    await expect(messages.json()).resolves.toMatchObject({
      conversation: {
        ref: "database-row-1",
        sessionId: "customer-thread-42",
      },
      messages: [Message.user("Remember the invoice"), Message.assistant("Invoice remembered")],
      records: [
        { position: 0, runId: "run-1", message: Message.user("Remember the invoice") },
        { position: 1, runId: "run-1", message: Message.assistant("Invoice remembered") },
      ],
      transcript: [
        { kind: "message", role: "user", text: "Remember the invoice" },
        { kind: "message", role: "assistant", text: "Invoice remembered" },
      ],
    });
  });

  it("reports non-inspectable agent memory without falling back to Studio sessions", async () => {
    const agent = new Agent({
      id: "support",
      model: new QueueModel([]),
      memory: { store: new RecordingMemoryStore() },
    });
    const runner = new Studio([agent]);

    const config = await runner.fetch(new Request("http://runner.test/config"));
    await expect(config.json()).resolves.toMatchObject({
      capabilities: { memory: { enabled: true } },
    });

    const sources = await runner.fetch(new Request("http://runner.test/memory/sources"));
    const body = (await sources.json()) as {
      sources: Array<{ ref: string; available: boolean; agentIds: string[] }>;
    };
    expect(body.sources).toEqual([
      expect.objectContaining({ available: false, agentIds: ["support"] }),
    ]);

    const conversations = await runner.fetch(
      new Request(`http://runner.test/memory/sources/${body.sources[0]?.ref}/conversations`),
    );
    expect(conversations.status).toBe(501);
  });

  it("persists streaming sessions with UI transcript entries", async () => {
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "hello" }]]);
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("hi")],
          sessionId: session.id,
          stream: true,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await readJsonl(res)).toContainEqual(
      expect.objectContaining({ type: "run_end", status: "completed" }),
    );

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      messages: [Message.user("hi"), Message.assistant("hello")],
      transcript: [
        { entryId: 0, kind: "message", role: "user", text: "hi" },
        {
          entryId: 1,
          kind: "message",
          role: "assistant",
          text: "hello",
          durationMs: expect.any(Number),
        },
      ],
    });
  });

  it("persists cancelled streams with their partial transcript and audit log", async () => {
    const model = new GatedReasoningModel();
    const agent = new Agent({ id: "support", model });
    const store = createInMemoryStudioStore();
    const saves: StudioSessionRunTranscriptInput[] = [];
    const saveSessionRunTranscript = store.saveSessionRunTranscript.bind(store);
    store.saveSessionRunTranscript = (input) => {
      saves.push(structuredClone(input));
      return saveSessionRunTranscript(input);
    };
    const runner = new Studio([agent], { stores: { sessions: store } });

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support" }),
      }),
    );
    const session = (await created.json()) as { id: string };
    const response = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("think")],
          sessionId: session.id,
          stream: true,
        }),
      }),
    );
    const reader = createJsonlReader(response);

    let event: unknown;
    do {
      event = await withTimeout(reader.read(), 1_000);
    } while ((event as { type?: string }).type !== "reasoning_delta");

    const cancellation = reader.cancel();
    await waitFor(() => saves.some((save) => save.status === "cancelled"));
    model.releaseText?.();
    await withTimeout(cancellation, 1_000);

    expect(saves.at(-1)).toMatchObject({
      status: "cancelled",
      transcript: [
        { kind: "message", role: "user", text: "think" },
        { kind: "reasoning", text: "thinking" },
        {
          kind: "message",
          role: "assistant",
          text: "",
          durationMs: expect.any(Number),
        },
      ],
    });
    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      messages: [Message.user("think")],
      transcript: [
        { kind: "message", role: "user", text: "think" },
        { kind: "reasoning", text: "thinking" },
        {
          kind: "message",
          role: "assistant",
          text: "",
          durationMs: expect.any(Number),
        },
      ],
    });
    const logs = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}/logs`));
    await expect(logs.json()).resolves.toMatchObject({
      logs: expect.arrayContaining([
        expect.objectContaining({ event: "run.cancelled", level: "info" }),
      ]),
    });
  });

  it("streams and persists metadata-only session audit logs", async () => {
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "safe answer" }]]);
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support", title: "secret title" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("my raw secret prompt")],
          sessionId: session.id,
          stream: true,
        }),
      }),
    );

    expect(run.status).toBe(200);
    const events = await readJsonl(run);
    const streamedLogs = events.filter(
      (
        event,
      ): event is {
        type: "data";
        name: "studio.session_log";
        data: { event: string; sequence: number };
      } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "data" &&
        "name" in event &&
        event.name === "studio.session_log",
    );
    expect(streamedLogs).toContainEqual(
      expect.objectContaining({ data: expect.objectContaining({ event: "run.started" }) }),
    );
    expect(streamedLogs).toContainEqual(
      expect.objectContaining({ data: expect.objectContaining({ event: "memory.loaded" }) }),
    );
    expect(streamedLogs).toContainEqual(
      expect.objectContaining({ data: expect.objectContaining({ event: "prompt.prepared" }) }),
    );
    expect(streamedLogs).toContainEqual(
      expect.objectContaining({ data: expect.objectContaining({ event: "run.completed" }) }),
    );
    expect(streamedLogs).toContainEqual(
      expect.objectContaining({ data: expect.objectContaining({ event: "memory.saved" }) }),
    );
    expect(streamedLogs).not.toContainEqual(
      expect.objectContaining({ data: expect.objectContaining({ event: "run.cancelled" }) }),
    );

    const firstPage = await runner.fetch(
      new Request(`http://runner.test/sessions/${session.id}/logs?limit=2`),
    );
    expect(firstPage.status).toBe(200);
    const firstBody = (await firstPage.json()) as {
      logs: Array<{ event: string; sequence: number; metadata?: unknown }>;
      nextCursor?: number;
    };
    expect(firstBody.logs).toHaveLength(2);
    expect(firstBody.logs[0]).toMatchObject({ event: "session.created", sequence: 0 });
    expect(firstBody.nextCursor).toBe(1);

    const nextPage = await runner.fetch(
      new Request(`http://runner.test/sessions/${session.id}/logs?after=${firstBody.nextCursor}`),
    );
    const nextBody = (await nextPage.json()) as {
      logs: Array<{ event: string; sequence: number; metadata?: unknown }>;
    };
    expect(nextBody.logs[0]).toMatchObject({ event: "run.started", sequence: 2 });
    expect(nextBody.logs.map((log) => log.event)).toContain("run.completed");
    expect(nextBody).not.toHaveProperty("nextCursor");

    const serializedLogs = JSON.stringify([...firstBody.logs, ...nextBody.logs]);
    expect(serializedLogs).not.toContain("my raw secret prompt");
    expect(serializedLogs).not.toContain("secret title");
    expect(serializedLogs).not.toContain("safe answer");
  });

  it("persists streaming subagent activity in tool transcript entries", async () => {
    const parentModel = new StreamingQueueModel([
      [
        {
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_child", "ask_child", { prompt: "inspect" }),
        },
      ],
      [{ type: "text_delta", delta: "done" }],
    ]);
    const childModel = new StreamingQueueModel([
      [
        {
          type: "tool_call",
          toolCall: AssistantContent.toolCall("call_add", "add", { x: 2, y: 5 }),
        },
      ],
      [{ type: "text_delta", delta: "7" }],
    ]);
    const childAgent = new Agent({
      id: "child",
      model: childModel,
      name: "Child Agent",
      tools: [addTool],
      maxTurns: 2,
    });
    const parentAgent = new Agent({
      id: "parent",
      model: parentModel,
      tools: [childAgent.asTool({ name: "ask_child", stream: true, suspension: "reject" })],
      maxTurns: 2,
    });
    const runner = new Studio([parentAgent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "parent" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const res = await runner.fetch(
      new Request("http://runner.test/agents/parent/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("delegate")],
          sessionId: session.id,
          stream: true,
        }),
      }),
    );

    expect(res.status).toBe(200);
    const events = await readJsonl(res);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run_start",
        scope: expect.objectContaining({ agentId: "child", parentToolName: "ask_child" }),
      }),
    );

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      transcript: [
        { kind: "message", role: "user", text: "delegate" },
        {
          kind: "tool",
          toolName: "ask_child",
          result: "7",
          childEvents: [
            {
              kind: "tool",
              agentId: "child",
              agentName: "Child Agent",
              toolName: "add",
              result: "7",
            },
            {
              kind: "message",
              agentId: "child",
              agentName: "Child Agent",
              text: "7",
            },
          ],
        },
        { kind: "message", role: "assistant", text: "done" },
      ],
    });

    const traces = (await (
      await runner.fetch(new Request(`http://runner.test/sessions/${session.id}/traces`))
    ).json()) as { traces: Array<{ id: string }> };
    const trace = await runner.fetch(
      new Request(`http://runner.test/traces/${traces.traces[0]?.id}`),
    );
    const traceBody = (await trace.json()) as {
      observations: Array<{
        id: string;
        parentObservationId?: string;
        kind: string;
        name: string;
        status: string;
        output?: unknown;
        metadata?: Record<string, unknown>;
      }>;
    };
    expect(traceBody).toMatchObject({
      observations: [
        { kind: "generation", name: "model.turn.1", status: "success" },
        { kind: "tool", name: "ask_child", status: "success", output: 7 },
        {
          kind: "agent",
          name: "Child_Agent.run",
          status: "success",
          metadata: expect.objectContaining({
            source: "agent_tool_event",
            childAgentId: "child",
            parentToolName: "ask_child",
          }),
        },
        {
          kind: "generation",
          name: "Child_Agent.model.turn.1",
          status: "success",
          metadata: expect.objectContaining({
            source: "agent_tool_event",
            childAgentId: "child",
            parentToolName: "ask_child",
          }),
        },
        {
          kind: "tool",
          name: "Child_Agent.add",
          status: "success",
          output: 7,
          metadata: expect.objectContaining({
            source: "agent_tool_event",
            childAgentId: "child",
            parentToolName: "ask_child",
          }),
        },
        { kind: "generation", name: "Child_Agent.model.turn.2", status: "success" },
        { kind: "generation", name: "model.turn.2", status: "success" },
      ],
    });

    const parentToolObservation = traceBody.observations.find(
      (observation) => observation.kind === "tool" && observation.name === "ask_child",
    );
    const childAgentObservation = traceBody.observations.find(
      (observation) => observation.kind === "agent" && observation.name === "Child_Agent.run",
    );
    const childToolObservation = traceBody.observations.find(
      (observation) => observation.kind === "tool" && observation.name === "Child_Agent.add",
    );
    expect(childAgentObservation?.parentObservationId).toBe(parentToolObservation?.id);
    expect(childToolObservation?.parentObservationId).toBe(childAgentObservation?.id);
  });

  it("validates session run requests", async () => {
    const agent = new Agent({ id: "support", model: new QueueModel([]) });
    const runner = new Studio([agent]);

    const invalid = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("hi")],
          sessionId: "session_1",
          history: [Message.user("old")],
        }),
      }),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: {
        code: "bad_request",
        message: "Legacy message/history requests are not supported; use messages",
      },
    });

    const missing = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("hi")],
          sessionId: "missing",
        }),
      }),
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "not_found", message: "Session not found" },
    });
  });

  it("persists non-streaming runner traces linked to a session", async () => {
    const model = new QueueModel([response([AssistantContent.text("traced answer")])]);
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support", title: "Trace session" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("trace me")],
          sessionId: session.id,
          trace: { name: "support-run", metadata: { source: "test" } },
        }),
      }),
    );
    expect(run.status).toBe(200);
    const runResult = (await run.json()) as AgentRunResponse;
    expect(runResult).toMatchObject({
      output: "traced answer",
      trace: {
        observer: "studio",
        observationId: expect.any(String),
        traceId: expect.any(String),
      },
    });

    const traces = await runner.fetch(
      new Request(`http://runner.test/sessions/${session.id}/traces`),
    );
    expect(traces.status).toBe(200);
    const traceList = (await traces.json()) as { traces: Array<{ id: string }> };
    expect(traceList.traces).toHaveLength(1);
    expect(traceList.traces[0]).toMatchObject({
      runId: runResult.runId,
      sessionId: session.id,
      name: "support-run",
      status: "success",
      output: "traced answer",
      observationCount: 1,
      metadata: expect.objectContaining({
        runId: runResult.runId,
        metadata: { source: "test", agentId: "support" },
      }),
    });

    const trace = await runner.fetch(
      new Request(`http://runner.test/traces/${traceList.traces[0]?.id}`),
    );
    expect(trace.status).toBe(200);
    await expect(trace.json()).resolves.toMatchObject({
      sessionId: session.id,
      status: "success",
      observations: [
        {
          kind: "generation",
          name: "model.turn.1",
          status: "success",
          metadata: expect.objectContaining({
            provider: "test",
            modelId: "test",
            toolCount: 0,
            toolNames: [],
            documentCount: 0,
            historyCount: 1,
            modelInfo: expect.objectContaining({
              provider: "test",
              modelId: "test",
              capabilities: expect.objectContaining({ streaming: false }),
            }),
            modelCall: expect.objectContaining({
              providerRequest: expect.objectContaining({
                provider: "test",
                stream: false,
                model: "test",
              }),
            }),
            response: expect.objectContaining({
              usage: expect.any(Object),
              contentTypes: ["text"],
            }),
          }),
        },
      ],
    });
  });

  it("deletes sessions and their traces", async () => {
    const model = new QueueModel([response([AssistantContent.text("delete me")])]);
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support", title: "Delete session" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("trace then delete")],
          sessionId: session.id,
        }),
      }),
    );

    const beforeDelete = (await (
      await runner.fetch(new Request(`http://runner.test/sessions/${session.id}/traces`))
    ).json()) as { traces: Array<{ id: string }> };
    expect(beforeDelete.traces).toHaveLength(1);

    const deleted = await runner.fetch(
      new Request(`http://runner.test/sessions/${session.id}`, { method: "DELETE" }),
    );
    expect(deleted.status).toBe(204);

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    expect(loaded.status).toBe(404);

    const traces = (await (
      await runner.fetch(new Request(`http://runner.test/traces?sessionId=${session.id}`))
    ).json()) as { traces: unknown[] };
    expect(traces.traces).toEqual([]);

    const missing = await runner.fetch(
      new Request(`http://runner.test/sessions/${session.id}`, { method: "DELETE" }),
    );
    expect(missing.status).toBe(404);
  });

  it("persists streaming runner traces with generation and tool observations", async () => {
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "add",
          argumentsDelta: '{"x":2,"y":5}',
        },
      ],
      [{ type: "text_delta", delta: "7" }],
    ]);
    const agent = new Agent({ id: "support", model, tools: [addTool], maxTurns: 2 });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("add")],
          sessionId: session.id,
          stream: true,
        }),
      }),
    );
    expect(run.status).toBe(200);
    expect(await readJsonl(run)).toContainEqual(
      expect.objectContaining({ type: "run_end", status: "completed" }),
    );

    const traces = (await (
      await runner.fetch(new Request(`http://runner.test/sessions/${session.id}/traces`))
    ).json()) as { traces: Array<{ id: string }> };
    const trace = await runner.fetch(
      new Request(`http://runner.test/traces/${traces.traces[0]?.id}`),
    );
    await expect(trace.json()).resolves.toMatchObject({
      status: "success",
      observations: [
        {
          kind: "generation",
          name: "model.turn.1",
          status: "success",
          metadata: expect.objectContaining({
            provider: "test",
            modelId: "test",
            toolCount: 1,
            toolNames: ["add"],
            documentCount: 0,
            historyCount: 1,
            firstDeltaMs: expect.any(Number),
            modelInfo: expect.objectContaining({
              provider: "test",
              modelId: "test",
              capabilities: expect.objectContaining({ streaming: true }),
            }),
            modelCall: expect.objectContaining({
              providerRequest: expect.objectContaining({
                provider: "test",
                stream: true,
                model: "test",
              }),
            }),
          }),
        },
        {
          kind: "tool",
          name: "add",
          status: "success",
          output: 7,
          metadata: expect.objectContaining({
            internalCallId: expect.any(String),
            argumentBytes: expect.any(Number),
            resultBytes: expect.any(Number),
            parameterKeys: ["x", "y"],
            requiredParameterKeys: ["x", "y"],
            approvalRequired: false,
            tools: expect.objectContaining({
              name: "add",
              parameterKeys: ["x", "y"],
              requiredParameterKeys: ["x", "y"],
              approvalRequired: false,
            }),
          }),
        },
        {
          kind: "generation",
          name: "model.turn.2",
          status: "success",
          metadata: expect.objectContaining({
            provider: "test",
            modelId: "test",
            toolCount: 1,
            toolNames: ["add"],
            documentCount: 0,
            historyCount: 3,
            firstDeltaMs: expect.any(Number),
            modelCall: expect.objectContaining({
              providerRequest: expect.objectContaining({
                stream: true,
                messageCount: 3,
              }),
            }),
          }),
        },
      ],
    });
  });

  it("persists failed runner traces with partial session memory", async () => {
    const agent = new Agent({ id: "support", model: new QueueModel([]) });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("fail")],
          sessionId: session.id,
        }),
      }),
    );
    expect(run.status).toBe(500);

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      messageCount: 1,
      messages: [Message.user("fail")],
      transcript: [
        { kind: "message", role: "user", text: "fail" },
        {
          kind: "message",
          role: "assistant",
          text: "",
          durationMs: expect.any(Number),
        },
      ],
    });

    const traces = (await (
      await runner.fetch(new Request(`http://runner.test/sessions/${session.id}/traces`))
    ).json()) as { traces: Array<{ id: string }> };
    expect(traces.traces).toHaveLength(1);
    expect(traces.traces[0]).toMatchObject({ status: "error" });

    const trace = await runner.fetch(
      new Request(`http://runner.test/traces/${traces.traces[0]?.id}`),
    );
    await expect(trace.json()).resolves.toMatchObject({
      status: "error",
      error: { message: "No queued response" },
      observations: [{ kind: "generation", status: "error" }],
    });
  });

  it("persists streaming failures with partial transcript entries", async () => {
    const model = new FailingStreamingModel();
    const agent = new Agent({ id: "support", model });
    const runner = new Studio([agent]);

    const created = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "support" }),
      }),
    );
    const session = (await created.json()) as { id: string };

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("stream fail")],
          sessionId: session.id,
          stream: true,
        }),
      }),
    );

    expect(run.status).toBe(200);
    expect(run.headers.get("content-type")).toContain("application/x-ndjson");
    const events = await readJsonl(run);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        usage: Usage.empty(),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: { message: "An unexpected error occurred." },
      }),
    );
    expect(model.requests).toHaveLength(1);

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      messageCount: 1,
      messages: [Message.user("stream fail")],
      transcript: [
        { kind: "message", role: "user", text: "stream fail" },
        { kind: "message", role: "assistant", text: "partial" },
        {
          kind: "message",
          role: "assistant",
          text: expect.stringContaining('"message":"stream failed"'),
          tone: "error",
          durationMs: expect.any(Number),
        },
      ],
    });
  });

  it("isolates in-memory messages and compaction snapshots from caller mutation", async () => {
    const store = createInMemoryStudioStore();
    store.createSession({ id: "session_1", agentId: "support" });
    const original = Message.user([{ type: "text", text: "original" }]);
    await store.append({
      scope: { sessionId: "session_1" },
      runId: "run_1",
      turn: 1,
      messages: [original],
    });
    if (typeof original.content === "string") {
      throw new Error("Expected structured user content");
    }
    const originalText = original.content[0];
    if (originalText?.type !== "text") {
      throw new Error("Expected text message");
    }
    (originalText as { text: string }).text = "mutated after append";

    const snapshot = await store.compaction?.snapshot({ scope: { sessionId: "session_1" } });
    if (snapshot === undefined || store.compaction === undefined) {
      throw new Error("Expected in-memory compaction capability");
    }
    const snapshotMessage = snapshot.messages[0];
    const snapshotText =
      snapshotMessage?.role === "user" && typeof snapshotMessage.content !== "string"
        ? snapshotMessage.content[0]
        : undefined;
    if (snapshotText?.type !== "text") {
      throw new Error("Expected text snapshot message");
    }
    (snapshotText as { text: string }).text = "mutated snapshot";

    await expect(store.load({ scope: { sessionId: "session_1" } })).resolves.toEqual([
      Message.user([{ type: "text", text: "original" }]),
    ]);
    const replacement = Message.system("Earlier discussion.", {
      metadata: {
        anvia: {
          memoryCompaction: { version: 1, compactedMessageCount: 1 },
        },
      },
    }) as MemoryCompactionMessage;
    await expect(
      store.compaction.replacePrefix({
        scope: { sessionId: "session_1" },
        revision: snapshot.revision,
        messageCount: 1,
        replacement,
        runId: "compaction_1",
      }),
    ).resolves.toEqual({ status: "committed" });
  });

  it("uses the SQLite session store as a core memory store", async () => {
    const store = createSqliteSessionStore({ path: ":memory:" });
    store.createSession({ id: "session_1", agentId: "support" });

    await store.append({
      scope: { sessionId: "session_1" },
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi")],
    });
    await expect(store.load({ scope: { sessionId: "session_1" } })).resolves.toEqual([
      Message.user([{ type: "text", text: "hi" }]),
    ]);

    await store.saveSessionRunTranscript({
      id: "session_1",
      runId: "run_1",
      title: "hi",
      status: "success",
      transcript: [
        { entryId: 0, kind: "message", role: "user", text: "hi" },
        {
          entryId: 1,
          kind: "message",
          role: "assistant",
          text: "",
          durationMs: 1_234,
        },
      ],
    });
    expect((await store.listSessions({ limit: 10 }))[0]).toMatchObject({
      id: "session_1",
      title: "hi",
      messageCount: 1,
    });
    expect((await store.getSession("session_1"))?.transcript).toEqual([
      { entryId: 0, kind: "message", role: "user", text: "hi" },
      {
        entryId: 1,
        kind: "message",
        role: "assistant",
        text: "",
        durationMs: 1_234,
      },
    ]);

    await store.recordError?.({
      scope: { sessionId: "session_1", metadata: { studioRunId: "run_2" } },
      runId: "core_run_2",
      error: new Error("failed"),
      messages: [Message.user("failed")],
    });
    expect((await store.getSession("session_1"))?.transcript).toEqual([
      { entryId: 0, kind: "message", role: "user", text: "hi" },
      {
        entryId: 1,
        kind: "message",
        role: "assistant",
        text: "",
        durationMs: 1_234,
      },
      { entryId: 2, kind: "message", role: "user", text: "failed" },
    ]);

    await store.clear({ scope: { sessionId: "session_1" } });
    expect(await store.getSession("session_1")).toMatchObject({
      messageCount: 0,
      messages: [],
      transcript: [],
    });
  });

  it("atomically replaces SQLite memory prefixes and exposes compaction messages", async () => {
    const store = createSqliteSessionStore({ path: ":memory:" });
    store.createSession({ id: "session_1", agentId: "support" });
    const retained = [
      Message.user([{ type: "text", text: "recent" }]),
      Message.assistant("recent answer"),
    ];
    await store.append({
      scope: { sessionId: "session_1" },
      runId: "run_1",
      turn: 1,
      messages: [Message.user("old"), Message.assistant("old answer"), ...retained],
    });
    const snapshot = await store.compaction?.snapshot({
      scope: { sessionId: "session_1" },
    });
    expect(snapshot).toBeDefined();
    if (snapshot === undefined || store.compaction === undefined) {
      throw new Error("Expected SQLite compaction capability");
    }
    const replacement = Message.system("Earlier discussion.", {
      metadata: {
        anvia: {
          memoryCompaction: { version: 1, compactedMessageCount: 2 },
        },
      },
    }) as MemoryCompactionMessage;

    await expect(
      store.compaction.replacePrefix({
        scope: { sessionId: "session_1" },
        revision: snapshot.revision,
        messageCount: 2,
        replacement,
        runId: "compaction_1",
      }),
    ).resolves.toEqual({ status: "committed" });
    await expect(
      store.compaction.replacePrefix({
        scope: { sessionId: "session_1" },
        revision: snapshot.revision,
        messageCount: 1,
        replacement,
        runId: "stale",
      }),
    ).resolves.toEqual({ status: "conflict" });
    await expect(store.load({ scope: { sessionId: "session_1" } })).resolves.toEqual([
      replacement,
      ...retained,
    ]);
    expect(await store.getSession("session_1")).toMatchObject({
      messageCount: 3,
      messages: [replacement, ...retained],
    });
  });

  it("rejects non-JSON message metadata in the SQLite session store", async () => {
    const store = createSqliteSessionStore({ path: ":memory:" });
    store.createSession({ id: "session_1", agentId: "support" });
    const invalidMessage = {
      ...Message.user("hi"),
      metadata: { score: Number.NaN },
    } as CoreMessage;

    expect(() =>
      store.append({
        scope: { sessionId: "session_1" },
        runId: "run_1",
        turn: 1,
        messages: [invalidMessage],
      }),
    ).toThrow("Studio message metadata must be a strict JSON value");
    await expect(store.load({ scope: { sessionId: "session_1" } })).resolves.toEqual([]);
  });

  it("persists session messages and parts in normalized SQLite tables", async () => {
    const path = join(studioDbDir ?? tmpdir(), "normalized.sqlite");
    const store = createSqliteSessionStore({ path });
    store.createSession({ id: "session_1", agentId: "support" });

    const messages = [
      Message.system("Use project policy.", { metadata: { source: "system" } }),
      Message.user(
        [
          UserContent.text("hi @Guide.pdf"),
          UserContent.imageUrl("https://example.test/image.png", { detail: "high" }),
          UserContent.documentUrl("https://example.test/file.pdf", "application/pdf", {
            filename: "file.pdf",
          }),
        ],
        {
          metadata: {
            composer: {
              entities: [
                {
                  id: "document-1",
                  triggerId: "documents",
                  trigger: "@",
                  label: "Guide.pdf",
                  text: "@Guide.pdf",
                  range: { from: 3, to: 13 },
                  data: { kind: "document", documentId: "document-1" },
                },
              ],
            },
          },
        },
      ),
      Message.assistant(
        [
          AssistantContent.text("hello"),
          AssistantContent.reasoning("thinking", "reasoning_1"),
          AssistantContent.toolCall("tool_1", "lookup", { query: "x" }, "call_1"),
          AssistantContent.imageBase64("abc123", "image/png"),
        ],
        { id: "assistant_message_1", metadata: { source: "assistant" } },
      ),
      Message.tool(
        ToolContent.toolResult(
          "tool_1",
          [
            { type: "text", text: "lookup result" },
            { type: "image", data: "abc123", mediaType: "image/png" },
          ],
          "call_1",
        ),
        { metadata: { source: "tool" } },
      ),
    ];

    await store.append({
      scope: { sessionId: "session_1" },
      runId: "run_1",
      turn: 1,
      messages: messages.slice(0, 2),
    });
    await store.append({
      scope: { sessionId: "session_1" },
      runId: "run_1",
      turn: 2,
      messages: messages.slice(2),
    });

    const db = new DatabaseSync(path);
    const messageCount = db
      .prepare("SELECT COUNT(*) AS count FROM anvia_studio_session_messages")
      .get() as { count: number };
    const partCount = db
      .prepare("SELECT COUNT(*) AS count FROM anvia_studio_session_message_parts")
      .get() as { count: number };
    expect(messageCount.count).toBe(4);
    expect(partCount.count).toBe(9);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM anvia_studio_session_messages WHERE metadata_json IS NOT NULL",
        )
        .get(),
    ).toEqual({ count: 4 });
    db.close();

    const reloaded = createSqliteSessionStore({ path });
    await expect(reloaded.load({ scope: { sessionId: "session_1" } })).resolves.toEqual(messages);
    expect(await reloaded.getSession("session_1")).toMatchObject({
      id: "session_1",
      messageCount: 4,
      messages,
    });
  });

  it("migrates normalized SQLite message tables to persist metadata", async () => {
    const path = join(studioDbDir ?? tmpdir(), "normalized-metadata-migration.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE anvia_studio_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE anvia_studio_session_messages (
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        role TEXT NOT NULL,
        message_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(session_id, message_index),
        FOREIGN KEY(session_id) REFERENCES anvia_studio_sessions(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE anvia_studio_session_message_parts (
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        part_index INTEGER NOT NULL,
        type TEXT NOT NULL,
        part_json TEXT NOT NULL,
        PRIMARY KEY(session_id, message_index, part_index),
        FOREIGN KEY(session_id, message_index)
          REFERENCES anvia_studio_session_messages(session_id, message_index)
          ON DELETE CASCADE
      ) STRICT;
      INSERT INTO anvia_studio_sessions
        (id, agent_id, title, metadata_json, created_at, updated_at)
      VALUES ('session_1', 'support', NULL, NULL, '2026-01-01', '2026-01-01');
      INSERT INTO anvia_studio_session_messages
        (session_id, message_index, role, message_id, created_at)
      VALUES ('session_1', 0, 'user', NULL, '2026-01-01');
      INSERT INTO anvia_studio_session_message_parts
        (session_id, message_index, part_index, type, part_json)
      VALUES ('session_1', 0, 0, 'text', '{"type":"text","text":"legacy"}');
    `);
    db.close();

    const store = createSqliteSessionStore({ path });
    await expect(store.load({ scope: { sessionId: "session_1" } })).resolves.toEqual([
      Message.user([{ type: "text", text: "legacy" }]),
    ]);
    const metadata = { composer: { entities: [{ id: "document-1" }] } };
    await store.append({
      scope: { sessionId: "session_1" },
      runId: "run_1",
      turn: 1,
      messages: [Message.user("new", { metadata })],
    });
    await expect(store.load({ scope: { sessionId: "session_1" } })).resolves.toEqual([
      Message.user([{ type: "text", text: "legacy" }]),
      Message.user([{ type: "text", text: "new" }], { metadata }),
    ]);

    const migrated = new DatabaseSync(path);
    const columns = migrated
      .prepare("PRAGMA table_info('anvia_studio_session_messages')")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("metadata_json");
    migrated.close();
  });

  it("persists session audit logs with monotonic sequence and deletes them with sessions", async () => {
    const store = createSqliteSessionStore({ path: ":memory:" });
    store.createSession({ id: "session_1", agentId: "support" });

    const first = await store.appendSessionLog?.({
      sessionId: "session_1",
      level: "info",
      category: "session",
      event: "session.created",
      message: "Session created",
      metadata: { agentId: "support" },
    });
    const second = await store.appendSessionLog?.({
      sessionId: "session_1",
      runId: "run_1",
      level: "debug",
      category: "memory",
      event: "memory.loaded",
      message: "Session memory loaded",
      metadata: { messageCount: 0 },
    });

    expect(first).toMatchObject({ sequence: 0, event: "session.created" });
    expect(second).toMatchObject({ sequence: 1, event: "memory.loaded", runId: "run_1" });
    expect(await store.listSessionLogs?.({ sessionId: "session_1", limit: 10 })).toEqual([
      expect.objectContaining({ sequence: 0 }),
      expect.objectContaining({ sequence: 1 }),
    ]);
    expect(await store.listSessionLogs?.({ sessionId: "session_1", limit: 10, after: 0 })).toEqual([
      expect.objectContaining({ sequence: 1 }),
    ]);

    expect(await store.deleteSession?.("session_1")).toBe(true);
    expect(await store.listSessionLogs?.({ sessionId: "session_1", limit: 10 })).toEqual([]);
  });

  it("rejects legacy SQLite session schemas with messages_json", () => {
    const path = join(studioDbDir ?? tmpdir(), "legacy.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE anvia_studio_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT,
        metadata_json TEXT,
        messages_json TEXT NOT NULL,
        transcript_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    db.close();

    const store = createSqliteSessionStore({ path });
    expect(() => store.createSession({ id: "session_1", agentId: "support" })).toThrow(
      "legacy messages_json schema",
    );
  });

  it("lists global runner traces with filters", async () => {
    const mainAgent = new Agent({
      id: "main",
      model: new QueueModel([response([AssistantContent.text("main answer")])]),
      name: "Main",
    });
    const backupAgent = new Agent({
      id: "backup",
      model: new QueueModel([response([AssistantContent.text("backup answer")])]),
      name: "Backup",
    });
    const runner = new Studio([mainAgent, backupAgent]);

    const mainCreated = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "main" }),
      }),
    );
    const mainSession = (await mainCreated.json()) as { id: string };
    const backupCreated = await runner.fetch(
      new Request("http://runner.test/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "backup" }),
      }),
    );
    const backupSession = (await backupCreated.json()) as { id: string };

    await runner.fetch(
      new Request("http://runner.test/agents/main/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("main")],
          sessionId: mainSession.id,
        }),
      }),
    );
    await runner.fetch(
      new Request("http://runner.test/agents/backup/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("backup")],
          sessionId: backupSession.id,
        }),
      }),
    );
    await runner.fetch(
      new Request("http://runner.test/agents/main/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("fail")],
          sessionId: mainSession.id,
        }),
      }),
    );

    const all = (await (
      await runner.fetch(new Request("http://runner.test/traces?limit=10"))
    ).json()) as { traces: Array<{ id: string }> };
    expect(all.traces).toHaveLength(3);

    const detailed = (await (
      await runner.fetch(new Request("http://runner.test/traces?include=detail&limit=10"))
    ).json()) as { traces: Array<{ id: string; observations: unknown[] }> };
    expect(detailed.traces).toHaveLength(3);
    expect(detailed.traces[0]?.observations).toBeInstanceOf(Array);

    const main = (await (
      await runner.fetch(new Request("http://runner.test/traces?agentId=main&limit=10"))
    ).json()) as { traces: Array<{ id: string }> };
    expect(main.traces).toHaveLength(2);

    const backup = (await (
      await runner.fetch(new Request("http://runner.test/traces?agentId=backup&limit=10"))
    ).json()) as { traces: Array<{ id: string }> };
    expect(backup.traces).toHaveLength(1);

    const session = (await (
      await runner.fetch(
        new Request(`http://runner.test/traces?sessionId=${mainSession.id}&limit=10`),
      )
    ).json()) as { traces: Array<{ id: string }> };
    expect(session.traces).toHaveLength(2);

    const failed = (await (
      await runner.fetch(new Request("http://runner.test/traces?status=error&limit=10"))
    ).json()) as { traces: Array<{ status: string }> };
    expect(failed.traces).toEqual([expect.objectContaining({ status: "error" })]);

    const invalidStatus = await runner.fetch(
      new Request("http://runner.test/traces?status=unknown"),
    );
    expect(invalidStatus.status).toBe(400);
  });

  it("validates trace routes", async () => {
    const runner = new Studio();

    const missingSession = await runner.fetch(
      new Request("http://runner.test/sessions/missing/traces"),
    );
    expect(missingSession.status).toBe(404);

    const missingTrace = await runner.fetch(new Request("http://runner.test/traces/missing"));
    expect(missingTrace.status).toBe(404);
  });

  it("streams realtime observability events", async () => {
    const agent = new Agent({
      id: "support",
      model: new QueueModel([response([AssistantContent.text("observed")])]),
    });
    const runner = new Studio([agent]);
    const session = (await (
      await runner.fetch(
        new Request("http://runner.test/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentId: "support" }),
        }),
      )
    ).json()) as { id: string };

    const stream = await runner.fetch(
      new Request("http://runner.test/observability/events?type=session_log,trace"),
    );
    expect(stream.status).toBe(200);
    const reader = createJsonlReader(stream);

    const run = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "messages",
          messages: [Message.user("observe")],
          sessionId: session.id,
          trace: { name: "observability-test" },
        }),
      }),
    );
    expect(run.status).toBe(200);

    const events = [await withTimeout(reader.read(), 1000)];
    while (!events.some((event) => isTraceObservabilityEvent(event))) {
      events.push(await withTimeout(reader.read(), 1000));
    }
    await reader.cancel();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_log",
        log: expect.objectContaining({ event: "run.received" }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "trace",
        trace: expect.objectContaining({
          name: "observability-test",
          status: "success",
          observationCount: expect.any(Number),
        }),
      }),
    );
  });

  it("closes realtime observability subscriptions when streams are cancelled", async () => {
    const hub = new StudioObservabilityHub();
    const app = new Hono();
    registerObservabilityRoutes(app, hub);

    const stream = await app.request("http://runner.test/observability/events");
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("application/x-ndjson");
    if (stream.body === null) {
      throw new Error("Expected observability response body");
    }

    const reader = stream.body.getReader();
    const pendingRead = reader.read();
    await waitFor(() => observabilitySubscriptionCount(hub) === 1);
    hub.emit({
      type: "trace",
      trace: {
        id: "trace_cancel",
        sessionId: "session_cancel",
        status: "success",
        startedAt: new Date().toISOString(),
        observationCount: 0,
      },
    });
    await expect(pendingRead).resolves.toMatchObject({ done: false });

    await reader.cancel();
    await waitFor(() => observabilitySubscriptionCount(hub) === 0);
  });

  it("runs registered eval suites", async () => {
    const metric: EvalMetric<string, string, boolean, string> = {
      name: "uppercase_match",
      dataType: "BOOLEAN",
      configId: "uppercase-config",
      metadata: { category: "format" },
      evaluate(args) {
        return args.output === args.case.expected
          ? EvalOutcome.pass(true)
          : EvalOutcome.fail(false);
      },
    };
    const runner = new Studio([], {
      evals: [
        {
          id: "uppercase-suite",
          name: "Uppercase Suite",
          description: "Checks a deterministic transform.",
          cases: [
            { id: "basic", input: "hello", expected: "HELLO", metadata: { topic: "greeting" } },
          ],
          target: (input: string) => input.toUpperCase(),
          metrics: [metric],
        },
      ],
    });

    const config = (await (
      await runner.fetch(new Request("http://runner.test/config"))
    ).json()) as { capabilities: { evals?: { enabled: boolean } }; evals: Array<{ id: string }> };
    expect(config.capabilities.evals?.enabled).toBe(true);
    expect(config.evals).toEqual([expect.objectContaining({ id: "uppercase-suite" })]);

    const list = await runner.fetch(new Request("http://runner.test/evals"));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      evals: [
        {
          id: "uppercase-suite",
          name: "Uppercase Suite",
          caseCount: 1,
          metricNames: ["uppercase_match"],
          casePreviewCount: 1,
          casePreviews: [
            {
              id: "basic",
              input: "hello",
              expected: "HELLO",
              metadataKeys: ["topic"],
            },
          ],
          metricSummaries: [
            {
              name: "uppercase_match",
              dataType: "BOOLEAN",
              configId: "uppercase-config",
              metadataKeys: ["category"],
            },
          ],
        },
      ],
    });

    const run = await runner.fetch(
      new Request("http://runner.test/evals/uppercase-suite/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ concurrency: 1 }),
      }),
    );
    expect(run.status).toBe(200);
    await expect(run.json()).resolves.toMatchObject({
      suiteId: "uppercase-suite",
      result: {
        name: "Uppercase Suite",
        metrics: {
          total: 1,
          passed: 1,
          failed: 0,
          invalid: 0,
        },
        cases: {
          total: 1,
          passed: 1,
          failed: 0,
          invalid: 0,
        },
        results: [
          {
            case: { id: "basic", input: "hello", expected: "HELLO" },
            output: "HELLO",
            outcome: "pass",
            metrics: [
              {
                metricName: "uppercase_match",
                required: true,
                outcome: { outcome: "pass", score: true },
              },
            ],
          },
        ],
      },
    });
  });
});

async function readJsonl(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown)
    .flatMap((value) => {
      const unwrapped = unwrapClientFrame(value);
      return unwrapped.kind === "event" ? [unwrapped.value] : [];
    });
}

function createJsonlReader(response: Response): {
  cancel: () => Promise<void>;
  read: () => Promise<unknown>;
} {
  if (response.body === null) {
    throw new Error("Expected response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: unknown[] = [];

  return {
    async cancel(): Promise<void> {
      await reader.cancel();
    },
    async read(): Promise<unknown> {
      while (true) {
        while (events.length === 0) {
          const next = await reader.read();
          if (next.done) {
            buffer += decoder.decode();
            if (buffer.trim().length > 0) {
              events.push(JSON.parse(buffer) as unknown);
              buffer = "";
              break;
            }
            throw new Error("Stream ended before another JSONL event");
          }
          buffer += decoder.decode(next.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim().length > 0) {
              events.push(JSON.parse(line) as unknown);
            }
          }
        }
        const value = events.shift();
        const unwrapped = unwrapClientFrame(value);
        if (unwrapped.kind === "event") return unwrapped.value;
        if (unwrapped.kind === "end") {
          throw new Error("Stream ended before another JSONL event");
        }
      }
    },
  };
}

function unwrapClientFrame(
  value: unknown,
): { kind: "event"; value: unknown } | { kind: "skip" } | { kind: "end" } {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return { kind: "event", value };
  }
  if (value.type === "stream_event" && "event" in value) {
    return { kind: "event", value: value.event };
  }
  if (value.type === "stream_start") return { kind: "skip" };
  if (value.type === "stream_end") return { kind: "end" };
  return { kind: "event", value };
}

function isTraceObservabilityEvent(event: unknown): boolean {
  return typeof event === "object" && event !== null && "type" in event && event.type === "trace";
}

function observabilitySubscriptionCount(hub: StudioObservabilityHub): number {
  return (hub as unknown as { subscriptions: Set<unknown> }).subscriptions.size;
}

async function readRemainingJsonl(reader: { read: () => Promise<unknown> }): Promise<unknown[]> {
  const events: unknown[] = [];
  while (true) {
    try {
      events.push(await reader.read());
    } catch (error) {
      if (error instanceof Error && error.message === "Stream ended before another JSONL event") {
        return events;
      }
      throw error;
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function waitFor(predicate: () => boolean, ms = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > ms) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
