import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentBuilder,
  type AgentObserver,
  type AgentRunObserver,
  type AgentRunStartArgs,
  AssistantContent,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionStreamEvent,
  createHook,
  createToolIndex,
  type Embedding,
  type EmbeddingModel,
  embedDocuments,
  InMemoryVectorStore,
  Message,
  type StreamingCompletionModel,
  skipTool,
  type Tool,
  ToolContent,
  Usage,
  UserContent,
} from "@anvia/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Studio } from "../src/index";
import { createSqliteSessionStore } from "../src/sqlite";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

class QueueModel {
  readonly provider = "test";
  readonly defaultModel = "test";
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

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued response");
    }
    return response;
  }
}

class StreamingQueueModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
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

  constructor(private readonly responses: CompletionStreamEvent[][]) {}

  async completion(): Promise<CompletionResponse> {
    throw new Error("completion should not be called");
  }

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No queued stream response");
    }
    yield* response;
  }
}

class GatedReasoningModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
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

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    yield { type: "reasoning_delta", delta: "thinking" };
    await new Promise<void>((resolve) => {
      this.releaseText = resolve;
    });
    yield { type: "text_delta", delta: "done" };
  }
}

class FailingStreamingModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly defaultModel = "test";
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

  async *streamCompletion(request: CompletionRequest): AsyncIterable<CompletionStreamEvent> {
    this.requests.push(request);
    yield { type: "text_delta", delta: "partial" };
    throw new Error("stream failed");
  }
}

class KeywordEmbeddingModel implements EmbeddingModel {
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

let previousStudioDb: string | undefined;
let studioDbDir: string | undefined;

beforeEach(() => {
  previousStudioDb = process.env.ANVIA_STUDIO_DB;
  studioDbDir = mkdtempSync(join(tmpdir(), "anvia-studio-test-"));
  process.env.ANVIA_STUDIO_DB = join(studioDbDir, "studio.sqlite");
});

afterEach(() => {
  if (previousStudioDb === undefined) {
    delete process.env.ANVIA_STUDIO_DB;
  } else {
    process.env.ANVIA_STUDIO_DB = previousStudioDb;
  }
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
    approval: {
      when: ({ args }) => args.amount > 0,
      reason: ({ args }) => `Approve refund of ${args.amount} for ${args.orderId}.`,
      rejectMessage: "Rejected by test.",
    },
    call(args) {
      return execute(args);
    },
  } satisfies Tool<{ orderId: string; amount: number }, string>;
}

const askQuestionTool = {
  name: "ask_question",
  definition() {
    return {
      name: "ask_question",
      description: "Ask the user for missing input",
      parameters: {
        type: "object",
        properties: {
          questions: { type: "array" },
        },
        required: ["questions"],
      },
    };
  },
  call() {
    throw new Error("Studio should answer ask_question without executing the tool");
  },
} satisfies Tool<unknown, string>;

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
  it("generates config from registered agents", async () => {
    const agent = new AgentBuilder("support", new QueueModel([]))
      .name("Support")
      .description("Support assistant")
      .build();
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
        sessions: { enabled: true },
        traces: { enabled: true },
      },
      unsupportedCapabilities: [],
    });

    const res = await runner.fetch(new Request("http://runner.test/config"));
    await expect(res.json()).resolves.toMatchObject(runner.config());
  });

  it("uses agent ids and uniquifies duplicates", () => {
    const first = new AgentBuilder("support-triage", new QueueModel([]))
      .name("Support Triage")
      .build();
    const duplicate = new AgentBuilder("support-triage", new QueueModel([]))
      .name("Support Triage")
      .build();
    const unnamed = new AgentBuilder("agent-3", new QueueModel([])).build();
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

  it("starts a served single-agent runner from a built agent", async () => {
    const agent = new AgentBuilder(
      "support",
      new QueueModel([response([AssistantContent.text("ok")])]),
    )
      .name("Support")
      .description("Support assistant")
      .build();
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
          body: JSON.stringify({ message: "hi" }),
        }),
      );
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ output: "ok" });
    } finally {
      runner.close();
    }
  });

  it("uses built-in stores with automatic Studio traces", async () => {
    const model = new QueueModel([response([AssistantContent.text("traced")])]);
    const agent = new AgentBuilder("support", model)
      .name("Support")
      .description("Support assistant")
      .build();
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
          body: JSON.stringify({ message: "trace me", sessionId: session.id }),
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
    const embedded = await embedDocuments(
      embeddings,
      [{ id: "refund-policy", text: "Refund policy is 30 days." }],
      {
        id: (document) => document.id,
        content: (document) => document.text,
      },
    );
    const index = InMemoryVectorStore.fromDocuments(embedded).index(embeddings);
    const model = new QueueModel([response([AssistantContent.text("ok")])]);
    const agent = new AgentBuilder("support", model)
      .dynamicContext(index, {
        topK: 1,
        format: (result) => ({ id: result.id, text: result.document.text }),
      })
      .build();
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
        body: JSON.stringify({ message: "refund policy", sessionId: session.id }),
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
    const index = await createToolIndex(embeddings, [lookupPolicyTool]);
    const model = new QueueModel([response([AssistantContent.text("ok")])]);
    const agent = new AgentBuilder("support", model).dynamicTools(index, { topK: 1 }).build();
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
        body: JSON.stringify({ message: "refund policy", sessionId: session.id }),
      }),
    );

    expect(run.status).toBe(200);
    expect(model.requests[0]?.tools).toEqual([
      expect.objectContaining({
        name: "lookup_policy",
      }),
    ]);
  });

  it("reports knowledge capability and exposes the knowledge inspector route", async () => {
    const agent = new AgentBuilder("support", new QueueModel([]))
      .context("Refund policy is 30 days.", "refund-policy")
      .build();
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
        staticContext: [{ id: "refund-policy", text: "Refund policy is 30 days." }],
      }),
    ]);

    const evaluations = await runner.fetch(new Request("http://runner.test/evaluations"));
    expect(evaluations.status).toBe(404);
  });

  it("starts a served runner from configured agents", async () => {
    const agent = new AgentBuilder(
      "support",
      new QueueModel([response([AssistantContent.text("ok")])]),
    )
      .name("Support")
      .tool(createRefundTool(() => "ok"))
      .build();
    const runner = new Studio([agent], {
      quickPrompts: {
        support: ["Issue a refund"],
      },
    }).start({ port: 0, log: false });

    try {
      expect(runner.config()).toMatchObject({
        agents: [{ id: "support", name: "Support", quickPrompts: ["Issue a refund"] }],
        capabilities: { approvals: { enabled: true } },
      });

      const res = await runner.fetch(
        new Request("http://runner.test/agents/support/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "hi" }),
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      runner.close();
    }
  });

  it("runs an agent without streaming and passes history", async () => {
    const model = new QueueModel([response([AssistantContent.text("Anvia")])]);
    const agent = new AgentBuilder("support", model).instructions("system").build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "What is this?",
          history: [Message.user("The project is Anvia."), Message.assistant("Noted.")],
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

  it("passes trace options to observed non-streaming runs and preserves trace output", async () => {
    const observer = new TraceObserver();
    const model = new QueueModel([response([AssistantContent.text("traced")])]);
    const agent = new AgentBuilder("support", model).observe(observer).build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "trace me",
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
      trace: { traceId: "trace_1", observationId: "obs_1" },
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
    const agent = new AgentBuilder("support", model).build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await readJsonl(res)).toMatchObject([
      { type: "turn_start", turn: 1 },
      { type: "text_delta", turn: 1, delta: "hello" },
      { type: "turn_end", turn: 1 },
      { type: "final", output: "hello" },
    ]);
  });

  it("pauses protected streaming tool calls until approval", async () => {
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
    const agent = new AgentBuilder("support", model).tool(refundTool).defaultMaxTurns(2).build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "refund", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const reader = createJsonlReader(res);
    const eventsBeforeApproval: unknown[] = [];
    let approvalId = "";
    while (approvalId.length === 0) {
      const event = await withTimeout(reader.read(), 1_000);
      eventsBeforeApproval.push(event);
      if ((event as { type?: string }).type === "tool_approval_request") {
        approvalId = (event as { approval: { id: string } }).approval.id;
      }
    }

    expect(eventsBeforeApproval).toContainEqual(
      expect.objectContaining({ type: "tool_call", toolCall: expect.any(Object) }),
    );
    expect(executed).toBe(false);

    const pending = (await (
      await runner.fetch(new Request("http://runner.test/approvals?status=pending"))
    ).json()) as { approvals: Array<{ id: string; status: string; toolName: string }> };
    expect(pending.approvals).toEqual([
      expect.objectContaining({
        id: approvalId,
        status: "pending",
        toolName: "issue_refund",
      }),
    ]);

    const decision = await runner.fetch(
      new Request(`http://runner.test/approvals/${approvalId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true }),
      }),
    );
    expect(decision.status).toBe(200);
    await expect(decision.json()).resolves.toMatchObject({ id: approvalId, status: "approved" });

    const duplicate = await runner.fetch(
      new Request(`http://runner.test/approvals/${approvalId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true }),
      }),
    );
    expect(duplicate.status).toBe(409);

    const missing = await runner.fetch(
      new Request("http://runner.test/approvals/missing/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true }),
      }),
    );
    expect(missing.status).toBe(404);

    const remaining = await readRemainingJsonl(reader);
    expect(executed).toBe(true);
    expect(remaining).toContainEqual(
      expect.objectContaining({
        type: "tool_approval_result",
        approval: expect.objectContaining({ id: approvalId, status: "approved" }),
      }),
    );
    expect(remaining).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: "Refunded 25 for ORD-1",
      }),
    );
    expect(remaining).toContainEqual(expect.objectContaining({ type: "final" }));
  });

  it("rejects protected tool calls without executing them and persists approval status", async () => {
    let executed = false;
    const refundTool = createRefundTool(() => {
      executed = true;
      return "should not run";
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
      [{ type: "text_delta", delta: "Refund denied" }],
    ]);
    const agent = new AgentBuilder("support", model).tool(refundTool).defaultMaxTurns(2).build();
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
        body: JSON.stringify({ message: "refund", sessionId: session.id, stream: true }),
      }),
    );
    expect(res.status).toBe(200);

    const reader = createJsonlReader(res);
    let approvalId = "";
    while (approvalId.length === 0) {
      const event = await withTimeout(reader.read(), 1_000);
      if ((event as { type?: string }).type === "tool_approval_request") {
        approvalId = (event as { approval: { id: string } }).approval.id;
      }
    }

    const decision = await runner.fetch(
      new Request(`http://runner.test/approvals/${approvalId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: false }),
      }),
    );
    expect(decision.status).toBe(200);
    const remaining = await readRemainingJsonl(reader);

    expect(executed).toBe(false);
    expect(remaining).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: "Rejected by test.",
      }),
    );

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      transcript: [
        { kind: "message", role: "user", text: "refund" },
        {
          kind: "tool",
          toolName: "issue_refund",
          approval: {
            id: approvalId,
            status: "rejected",
            reason: "Rejected by test.",
          },
          result: "Rejected by test.",
        },
        { kind: "message", role: "assistant", text: "Refund denied" },
      ],
    });
  });

  it("handles hook-based approval requests in streaming runs", async () => {
    let executed = false;
    const refundTool = {
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
      call(args) {
        executed = true;
        return `Refunded ${args.amount} for ${args.orderId}`;
      },
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
    const agent = new AgentBuilder("support", model)
      .tool(refundTool)
      .hook(
        createHook({
          onToolCall({ toolName, tool }) {
            if (toolName === "issue_refund") {
              return tool.requestApproval({
                reason: "Review refund before issuing it.",
                rejectMessage: "Rejected by hook.",
              });
            }
            return tool.run();
          },
        }),
      )
      .defaultMaxTurns(2)
      .build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "refund", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const reader = createJsonlReader(res);
    let approvalId = "";
    while (approvalId.length === 0) {
      const event = await withTimeout(reader.read(), 1_000);
      if ((event as { type?: string }).type === "tool_approval_request") {
        const approval = (event as { approval: { id: string; reason?: string } }).approval;
        approvalId = approval.id;
        expect(approval.reason).toBe("Review refund before issuing it.");
      }
    }
    expect(executed).toBe(false);

    const decision = await runner.fetch(
      new Request(`http://runner.test/approvals/${approvalId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true }),
      }),
    );
    expect(decision.status).toBe(200);

    const remaining = await readRemainingJsonl(reader);
    expect(executed).toBe(true);
    expect(remaining).toContainEqual(
      expect.objectContaining({
        type: "tool_approval_result",
        approval: expect.objectContaining({ id: approvalId, status: "approved" }),
      }),
    );
    expect(remaining).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: "Refunded 25 for ORD-1",
      }),
    );
  });

  it("skips rejected hook-based approval requests with the reject message", async () => {
    let executed = false;
    const refundTool = {
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
      call() {
        executed = true;
        return "should not run";
      },
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
      [{ type: "text_delta", delta: "Refund denied" }],
    ]);
    const agent = new AgentBuilder("support", model)
      .tool(refundTool)
      .hook(
        createHook({
          onToolCall({ tool }) {
            return tool.requestApproval({
              reason: "Review refund before issuing it.",
              rejectMessage: "Rejected by hook.",
            });
          },
        }),
      )
      .defaultMaxTurns(2)
      .build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "refund", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const reader = createJsonlReader(res);
    let approvalId = "";
    while (approvalId.length === 0) {
      const event = await withTimeout(reader.read(), 1_000);
      if ((event as { type?: string }).type === "tool_approval_request") {
        approvalId = (event as { approval: { id: string } }).approval.id;
      }
    }

    const decision = await runner.fetch(
      new Request(`http://runner.test/approvals/${approvalId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: false }),
      }),
    );
    expect(decision.status).toBe(200);

    const remaining = await readRemainingJsonl(reader);
    expect(executed).toBe(false);
    expect(remaining).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: "Rejected by hook.",
      }),
    );
  });

  it("pauses ask_question tool calls until Studio receives answers", async () => {
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
                question: "Which priority should we use?",
                choices: ["Low", "Medium", "High"],
              },
              {
                id: "notes",
                question: "Any extra context?",
                choices: [{ label: "Other", value: "other" }],
              },
            ],
          }),
        },
      ],
      [{ type: "text_delta", delta: "Thanks for the context" }],
    ]);
    const agent = new AgentBuilder("support", model)
      .tool(askQuestionTool)
      .defaultMaxTurns(2)
      .build();
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
        body: JSON.stringify({ message: "ask", sessionId: session.id, stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const reader = createJsonlReader(res);
    let questionId = "";
    while (questionId.length === 0) {
      const event = await withTimeout(reader.read(), 1_000);
      if ((event as { type?: string }).type === "tool_question_request") {
        questionId = (event as { question: { id: string } }).question.id;
      }
    }

    const pending = (await (
      await runner.fetch(new Request("http://runner.test/questions?status=pending"))
    ).json()) as { questions: Array<{ id: string; status: string; toolName: string }> };
    expect(pending.questions).toEqual([
      expect.objectContaining({
        id: questionId,
        status: "pending",
        toolName: "ask_question",
      }),
    ]);

    const answer = await runner.fetch(
      new Request(`http://runner.test/questions/${questionId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: [
            { questionId: "priority", answer: "High", choice: "High" },
            { questionId: "notes", answer: "Customer is blocked.", custom: true },
          ],
        }),
      }),
    );
    expect(answer.status).toBe(200);
    await expect(answer.json()).resolves.toMatchObject({ id: questionId, status: "answered" });

    const remaining = await readRemainingJsonl(reader);
    expect(remaining).toContainEqual(
      expect.objectContaining({
        type: "tool_question_result",
        question: expect.objectContaining({ id: questionId, status: "answered" }),
      }),
    );
    expect(remaining).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: JSON.stringify({
          answers: [
            { questionId: "priority", answer: "High", choice: "High" },
            { questionId: "notes", answer: "Customer is blocked.", custom: true },
          ],
        }),
      }),
    );

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      transcript: [
        { kind: "message", role: "user", text: "ask" },
        {
          kind: "tool",
          toolName: "ask_question",
          question: {
            id: questionId,
            status: "answered",
            answers: [
              { questionId: "priority", answer: "High", choice: "High" },
              { questionId: "notes", answer: "Customer is blocked.", custom: true },
            ],
          },
        },
        { kind: "message", role: "assistant", text: "Thanks for the context" },
      ],
    });
  });

  it("skips invalid ask_question calls that omit choices", async () => {
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "ask_question",
          argumentsDelta: JSON.stringify({
            questions: [
              {
                id: "notes",
                question: "Any extra context?",
                choices: [],
              },
            ],
          }),
        },
      ],
      [{ type: "text_delta", delta: "I need choices first" }],
    ]);
    const agent = new AgentBuilder("support", model)
      .tool(askQuestionTool)
      .defaultMaxTurns(2)
      .build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "ask", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const events = await readJsonl(res);
    expect(events).not.toContainEqual(expect.objectContaining({ type: "tool_question_request" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: "ask_question requires every question to include text and at least one choice.",
      }),
    );
  });

  it("runs approval metadata tools directly when the approval condition is false", async () => {
    let executed = false;
    const refundTool = {
      ...createRefundTool(({ orderId, amount }) => {
        executed = true;
        return `Refunded ${amount} for ${orderId}`;
      }),
      approval: {
        when: () => false,
      },
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
    const agent = new AgentBuilder("support", model).tool(refundTool).defaultMaxTurns(2).build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "refund", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const events = await readJsonl(res);
    expect(events).not.toContainEqual(expect.objectContaining({ type: "tool_approval_request" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: "Refunded 25 for ORD-1",
      }),
    );
    expect(executed).toBe(true);
  });

  it("lets existing tool hooks skip protected tools before Studio approval", async () => {
    let executed = false;
    const refundTool = createRefundTool(() => {
      executed = true;
      return "should not run";
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
      [{ type: "text_delta", delta: "Skipped" }],
    ]);
    const agent = new AgentBuilder("support", model)
      .tool(refundTool)
      .hook(
        createHook({
          onToolCall() {
            return skipTool("Blocked by existing hook.");
          },
        }),
      )
      .defaultMaxTurns(2)
      .build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "refund", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const events = await readJsonl(res);
    expect(events).not.toContainEqual(expect.objectContaining({ type: "tool_approval_request" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: "Blocked by existing hook.",
      }),
    );
    expect(executed).toBe(false);
  });

  it("lets existing tool hooks terminate protected tools before Studio approval", async () => {
    const refundTool = createRefundTool(() => "should not run");
    const model = new StreamingQueueModel([
      [
        {
          type: "tool_call_delta",
          id: "call_1",
          name: "issue_refund",
          argumentsDelta: '{"orderId":"ORD-1","amount":25}',
        },
      ],
    ]);
    const agent = new AgentBuilder("support", model)
      .tool(refundTool)
      .hook(
        createHook({
          onToolCall() {
            return { type: "terminate", reason: "Blocked by existing hook." };
          },
        }),
      )
      .defaultMaxTurns(2)
      .build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "refund", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const events = await readJsonl(res);
    expect(events).not.toContainEqual(expect.objectContaining({ type: "tool_approval_request" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ reason: "Blocked by existing hook." }),
      }),
    );
  });

  it("flushes reasoning deltas before the run completes", async () => {
    const model = new GatedReasoningModel();
    const agent = new AgentBuilder("support", model).build();
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
        body: JSON.stringify({ message: "hi", sessionId: session.id, stream: true }),
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
    model.releaseText?.();
    await expect(readRemainingJsonl(reader)).resolves.toContainEqual(
      expect.objectContaining({ type: "final" }),
    );
  });

  it("preserves trace output on streaming final events", async () => {
    const observer = new TraceObserver("trace_stream");
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "hello" }]]);
    const agent = new AgentBuilder("support", model).observe(observer).build();
    const runner = new Studio([agent]);

    const res = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", stream: true, trace: { name: "stream" } }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await readJsonl(res)).toContainEqual(
      expect.objectContaining({
        type: "final",
        trace: { traceId: "trace_stream", observationId: "obs_1" },
      }),
    );
    expect(observer.starts[0]?.trace).toMatchObject({ name: "stream" });
  });

  it("marks observability enabled when a registered agent has observers", () => {
    const agent = new AgentBuilder("support", new QueueModel([]))
      .observe(new TraceObserver())
      .build();
    const runner = new Studio([agent]);

    expect(runner.config().capabilities.observability).toEqual({ enabled: true });
  });

  it("marks approvals enabled when a registered agent protects tools", () => {
    const agent = new AgentBuilder("support", new QueueModel([]))
      .tool(createRefundTool(() => "ok"))
      .build();
    const runner = new Studio([agent]);

    expect(runner.config().capabilities.approvals).toEqual({ enabled: true });
  });

  it("marks approvals enabled when a registered agent has hooks", () => {
    const agent = new AgentBuilder("support", new QueueModel([]))
      .hook(createHook({ onToolCall: ({ tool }) => tool.requestApproval() }))
      .build();
    const runner = new Studio([agent]);

    expect(runner.config().capabilities.approvals).toEqual({ enabled: true });
  });

  it("serves the runner UI shell routes", async () => {
    const runner = new Studio();

    const redirect = await runner.fetch(new Request("http://runner.test/"));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/playground");

    const shell = await runner.fetch(new Request("http://runner.test/ui"));
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain('id="anvia-ui"');

    const sessionShell = await runner.fetch(new Request("http://runner.test/ui/session_1"));
    expect(sessionShell.status).toBe(200);
    await expect(sessionShell.text()).resolves.toContain('data-ui-path="/ui"');

    for (const path of [
      "/playground",
      "/playground/session_1",
      "/tracing",
      "/tracing/trace_1",
      "/tracing/sessions/session_1",
      "/ui/playground",
      "/ui/playground/session_1",
      "/ui/tracing",
      "/ui/tracing/trace_1",
      "/ui/tracing/sessions/session_1",
      "/ui/sessions",
      "/ui/agents",
      "/ui/knowledge",
    ]) {
      const routeShell = await runner.fetch(new Request(`http://runner.test${path}`));
      expect(routeShell.status).toBe(200);
      await expect(routeShell.text()).resolves.toContain('id="anvia-ui"');
    }
  });

  it("returns 404 for unknown agents", async () => {
    const runner = new Studio();

    const res = await runner.fetch(
      new Request("http://runner.test/agents/missing/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
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
    const agent = new AgentBuilder("support", model).build();
    const runner = new Studio([agent]);

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
        body: JSON.stringify({ message: "First question", sessionId: session.id }),
      }),
    );
    expect(firstRun.status).toBe(200);

    const secondRun = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Follow up", sessionId: session.id }),
      }),
    );
    expect(secondRun.status).toBe(200);

    expect(model.requests[1]?.chatHistory).toEqual([
      Message.user("First question"),
      Message.assistant("First answer"),
      Message.user("Follow up"),
    ]);

    const reloadedRunner = new Studio([new AgentBuilder("support", new QueueModel([])).build()]);
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
        Message.user("First question"),
        Message.assistant("First answer"),
        Message.user("Follow up"),
        Message.assistant("Second answer"),
      ],
      transcript: [
        { kind: "message", role: "user", text: "First question" },
        { kind: "message", role: "assistant", text: "First answer" },
        { kind: "message", role: "user", text: "Follow up" },
        { kind: "message", role: "assistant", text: "Second answer" },
      ],
    });
  });

  it("persists streaming sessions with UI transcript entries", async () => {
    const model = new StreamingQueueModel([[{ type: "text_delta", delta: "hello" }]]);
    const agent = new AgentBuilder("support", model).build();
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
        body: JSON.stringify({ message: "hi", sessionId: session.id, stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await readJsonl(res)).toContainEqual(expect.objectContaining({ type: "final" }));

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      messages: [Message.user("hi"), Message.assistant("hello")],
      transcript: [
        { entryId: 0, kind: "message", role: "user", text: "hi" },
        { entryId: 1, kind: "message", role: "assistant", text: "hello" },
      ],
    });
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
    const childAgent = new AgentBuilder("child", childModel)
      .name("Child Agent")
      .tool(addTool)
      .defaultMaxTurns(2)
      .build();
    const parentAgent = new AgentBuilder("parent", parentModel)
      .tool(childAgent.asTool({ name: "ask_child", stream: true }))
      .defaultMaxTurns(2)
      .build();
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
        body: JSON.stringify({ message: "delegate", sessionId: session.id, stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const events = await readJsonl(res);
    expect(events).toContainEqual(expect.objectContaining({ type: "agent_tool_event" }));

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
    const agent = new AgentBuilder("support", new QueueModel([])).build();
    const runner = new Studio([agent]);

    const invalid = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "hi",
          sessionId: "session_1",
          history: [Message.user("old")],
        }),
      }),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "bad_request", message: "sessionId cannot be combined with history" },
    });

    const missing = await runner.fetch(
      new Request("http://runner.test/agents/support/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", sessionId: "missing" }),
      }),
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "not_found", message: "Session not found" },
    });
  });

  it("persists non-streaming runner traces linked to a session", async () => {
    const model = new QueueModel([response([AssistantContent.text("traced answer")])]);
    const agent = new AgentBuilder("support", model).build();
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
          message: "trace me",
          sessionId: session.id,
          trace: { name: "support-run", metadata: { source: "test" } },
        }),
      }),
    );
    expect(run.status).toBe(200);
    await expect(run.json()).resolves.toMatchObject({
      output: "traced answer",
      trace: { observationId: expect.any(String), traceId: expect.any(String) },
    });

    const traces = await runner.fetch(
      new Request(`http://runner.test/sessions/${session.id}/traces`),
    );
    expect(traces.status).toBe(200);
    const traceList = (await traces.json()) as { traces: Array<{ id: string }> };
    expect(traceList.traces).toHaveLength(1);
    expect(traceList.traces[0]).toMatchObject({
      sessionId: session.id,
      name: "support-run",
      status: "success",
      output: "traced answer",
      observationCount: 1,
      metadata: expect.objectContaining({
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
      observations: [{ kind: "generation", name: "model.turn.1", status: "success" }],
    });
  });

  it("deletes sessions and their traces", async () => {
    const model = new QueueModel([response([AssistantContent.text("delete me")])]);
    const agent = new AgentBuilder("support", model).build();
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
        body: JSON.stringify({ message: "trace then delete", sessionId: session.id }),
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
    const agent = new AgentBuilder("support", model).tool(addTool).defaultMaxTurns(2).build();
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
        body: JSON.stringify({ message: "add", sessionId: session.id, stream: true }),
      }),
    );
    expect(run.status).toBe(200);
    expect(await readJsonl(run)).toContainEqual(expect.objectContaining({ type: "final" }));

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
          metadata: expect.objectContaining({ firstDeltaMs: expect.any(Number) }),
        },
        { kind: "tool", name: "add", status: "success", output: 7 },
        {
          kind: "generation",
          name: "model.turn.2",
          status: "success",
          metadata: expect.objectContaining({ firstDeltaMs: expect.any(Number) }),
        },
      ],
    });
  });

  it("persists failed runner traces with partial session memory", async () => {
    const agent = new AgentBuilder("support", new QueueModel([])).build();
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
        body: JSON.stringify({ message: "fail", sessionId: session.id }),
      }),
    );
    expect(run.status).toBe(500);

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      messageCount: 1,
      messages: [Message.user("fail")],
      transcript: [{ kind: "message", role: "user", text: "fail" }],
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
    const agent = new AgentBuilder("support", model).build();
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
        body: JSON.stringify({ message: "stream fail", sessionId: session.id, stream: true }),
      }),
    );

    expect(run.status).toBe(200);
    expect(await readJsonl(run)).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ message: "stream failed" }),
      }),
    );

    const loaded = await runner.fetch(new Request(`http://runner.test/sessions/${session.id}`));
    await expect(loaded.json()).resolves.toMatchObject({
      messageCount: 1,
      messages: [Message.user("stream fail")],
      transcript: [
        { kind: "message", role: "user", text: "stream fail" },
        { kind: "message", role: "assistant", text: "partial" },
      ],
    });
  });

  it("uses the SQLite session store as a core memory store", async () => {
    const store = createSqliteSessionStore({ path: ":memory:" });
    store.createSession({ id: "session_1", agentId: "support" });

    await store.append({
      context: { sessionId: "session_1" },
      runId: "run_1",
      turn: 1,
      messages: [Message.user("hi")],
    });
    await expect(store.load({ sessionId: "session_1" })).resolves.toEqual([Message.user("hi")]);

    await store.saveSessionRunTranscript({
      id: "session_1",
      runId: "run_1",
      title: "hi",
      status: "success",
      transcript: [{ entryId: 0, kind: "message", role: "user", text: "hi" }],
    });
    expect((await store.listSessions({ limit: 10 }))[0]).toMatchObject({
      id: "session_1",
      title: "hi",
      messageCount: 1,
    });
    expect((await store.getSession("session_1"))?.transcript).toEqual([
      { entryId: 0, kind: "message", role: "user", text: "hi" },
    ]);

    await store.recordError?.({
      context: { sessionId: "session_1", metadata: { studioRunId: "run_2" } },
      runId: "core_run_2",
      error: new Error("failed"),
      messages: [Message.user("failed")],
    });
    expect((await store.getSession("session_1"))?.transcript).toEqual([
      { entryId: 0, kind: "message", role: "user", text: "hi" },
      { entryId: 1, kind: "message", role: "user", text: "failed" },
    ]);

    await store.clear({ sessionId: "session_1" });
    expect(await store.getSession("session_1")).toMatchObject({
      messageCount: 0,
      messages: [],
      transcript: [],
    });
  });

  it("persists session messages and parts in normalized SQLite tables", async () => {
    const path = join(studioDbDir ?? tmpdir(), "normalized.sqlite");
    const store = createSqliteSessionStore({ path });
    store.createSession({ id: "session_1", agentId: "support" });

    const messages = [
      Message.system("Use project policy."),
      Message.user([
        UserContent.text("hi"),
        UserContent.imageUrl("https://example.test/image.png", { detail: "high" }),
        UserContent.documentUrl("https://example.test/file.pdf", "application/pdf", {
          filename: "file.pdf",
        }),
      ]),
      Message.assistant(
        [
          AssistantContent.text("hello"),
          AssistantContent.reasoning("thinking", "reasoning_1"),
          AssistantContent.toolCall("tool_1", "lookup", { query: "x" }, "call_1"),
          AssistantContent.imageBase64("abc123", "image/png"),
        ],
        "assistant_message_1",
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
      ),
    ];

    await store.append({
      context: { sessionId: "session_1" },
      runId: "run_1",
      turn: 1,
      messages: messages.slice(0, 2),
    });
    await store.append({
      context: { sessionId: "session_1" },
      runId: "run_1",
      turn: 2,
      messages: messages.slice(2),
    });

    const db = new DatabaseSync(path);
    const messageCount = db
      .prepare("SELECT COUNT(*) AS count FROM runner_session_messages")
      .get() as { count: number };
    const partCount = db
      .prepare("SELECT COUNT(*) AS count FROM runner_session_message_parts")
      .get() as { count: number };
    expect(messageCount.count).toBe(4);
    expect(partCount.count).toBe(9);
    db.close();

    const reloaded = createSqliteSessionStore({ path });
    await expect(reloaded.load({ sessionId: "session_1" })).resolves.toEqual(messages);
    expect(await reloaded.getSession("session_1")).toMatchObject({
      id: "session_1",
      messageCount: 4,
      messages,
    });
  });

  it("rejects legacy SQLite session schemas with messages_json", () => {
    const path = join(studioDbDir ?? tmpdir(), "legacy.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE runner_sessions (
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
    const mainAgent = new AgentBuilder(
      "main",
      new QueueModel([response([AssistantContent.text("main answer")])]),
    )
      .name("Main")
      .build();
    const backupAgent = new AgentBuilder(
      "backup",
      new QueueModel([response([AssistantContent.text("backup answer")])]),
    )
      .name("Backup")
      .build();
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
        body: JSON.stringify({ message: "main", sessionId: mainSession.id }),
      }),
    );
    await runner.fetch(
      new Request("http://runner.test/agents/backup/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "backup", sessionId: backupSession.id }),
      }),
    );
    await runner.fetch(
      new Request("http://runner.test/agents/main/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "fail", sessionId: mainSession.id }),
      }),
    );

    const all = (await (
      await runner.fetch(new Request("http://runner.test/traces?limit=10"))
    ).json()) as { traces: Array<{ id: string }> };
    expect(all.traces).toHaveLength(3);

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
});

async function readJsonl(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function createJsonlReader(response: Response): { read: () => Promise<unknown> } {
  if (response.body === null) {
    throw new Error("Expected response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: unknown[] = [];

  return {
    async read(): Promise<unknown> {
      while (events.length === 0) {
        const next = await reader.read();
        if (next.done) {
          buffer += decoder.decode();
          if (buffer.trim().length > 0) {
            events.push(JSON.parse(buffer));
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
            events.push(JSON.parse(line));
          }
        }
      }
      return events.shift();
    },
  };
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
