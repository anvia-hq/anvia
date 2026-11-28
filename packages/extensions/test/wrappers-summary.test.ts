import {
  Agent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  createTool,
  createToolkit,
  Usage,
} from "@anvia/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { withToolRateLimit, withToolRetry, withToolSummary, withToolTimeout } from "../src/tools";

function createFakeModel(
  handler: (request: CompletionRequest) => Promise<CompletionResponse> | CompletionResponse,
): CompletionModel {
  return {
    provider: "fake",
    modelId: "fake-1",
    capabilities: {
      streaming: false,
      tools: true,
      toolChoice: true,
      imageInput: true,
      documentInput: true,
      outputSchema: true,
      reasoning: false,
    },
    async completion(request) {
      return handler(request);
    },
  };
}

describe("tool wrappers", () => {
  it("enforces withToolTimeout and aborts the child signal", async () => {
    let sawAbort = false;
    const slowTool = createTool({
      name: "slow",
      description: "Sleeps",
      inputSchema: z.object({}),
      handler: (_args, context) =>
        new Promise((resolve) => {
          context.abortSignal?.addEventListener("abort", () => {
            sawAbort = true;
          });
          setTimeout(() => resolve("late"), 500);
        }),
    });

    const wrapped = withToolTimeout(slowTool, { timeoutMs: 30 });
    await expect(wrapped.call({})).rejects.toThrow(/timed out after 30ms/);
    expect(sawAbort).toBe(true);
  });

  it("retries transient failures with withToolRetry and respects retryOn", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const flaky = createTool({
      name: "flaky",
      description: "Fails twice then succeeds",
      inputSchema: z.object({ value: z.string() }),
      handler: (args) => {
        attempts += 1;

        if (attempts < 3) {
          throw new Error("transient failure");
        }

        return `ok:${args.value}`;
      },
    });

    const wrapped = withToolRetry(flaky, {
      maxAttempts: 3,
      backoffMs: 10,
      backoffFactor: 2,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(await wrapped.call({ value: "hi" })).toBe("ok:hi");
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);

    const nonRetryable = withToolRetry(
      createTool({
        name: "bad",
        description: "Always throws fatal",
        inputSchema: z.object({}),
        handler: () => {
          throw new Error("fatal");
        },
      }),
      {
        maxAttempts: 4,
        retryOn: (error) => !(error instanceof Error && error.message === "fatal"),
        sleep: async () => undefined,
      },
    );
    await expect(nonRetryable.call({})).rejects.toThrow("fatal");
  });

  it("enforces sliding window limits with withToolRateLimit", async () => {
    let nowMs = 1_000;
    const ping = createTool({
      name: "ping",
      description: "Ping",
      inputSchema: z.object({}),
      handler: () => "pong",
    });

    const limited = withToolRateLimit(ping, {
      maxCalls: 2,
      windowMs: 1_000,
      now: () => nowMs,
    });

    expect(await limited.call({})).toBe("pong");
    nowMs += 200;
    expect(await limited.call({})).toBe("pong");
    nowMs += 200;
    await expect(limited.call({})).rejects.toThrow(/rate limit/);

    nowMs += 800;
    expect(await limited.call({})).toBe("pong");
  });

  it("injects LLM summary field via withToolSummary, exposes it in Agent lifecycle, and strips it from inner strict tool", async () => {
    const receivedByInner: unknown[] = [];
    const seenSummaries: { toolName: string; summary: string; args: unknown }[] = [];
    const lifecycleInputs: unknown[] = [];

    const strictTool = createTool({
      name: "lookup",
      description: "Look up a record",
      inputSchema: z.object({ id: z.string() }).strict(),
      handler: (args) => {
        receivedByInner.push(args);
        return `record:${args.id}`;
      },
    });

    const wrappedKit = withToolSummary(createToolkit({ name: "records", tools: [strictTool] }), {
      field: "toolSummary",
      onSummary: (event) => {
        seenSummaries.push({
          toolName: event.toolName,
          summary: event.summary,
          args: event.args,
        });
      },
    });

    const def = await wrappedKit.tools[0]!.definition("");
    const params = def.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(params.properties?.toolSummary).toBeDefined();
    expect(params.required).toContain("toolSummary");

    let turn = 0;
    const model = createFakeModel(() => {
      turn += 1;

      if (turn === 1) {
        return {
          choice: [
            {
              type: "tool-call",
              toolCallId: "tc-1",
              toolName: "lookup",
              input: { id: "42", toolSummary: "Fetch user profile" },
            },
          ],
          usage: Usage.empty(),
          rawResponse: {},
        };
      }

      return {
        choice: [{ type: "text", text: "done" }],
        usage: Usage.empty(),
        rawResponse: {},
      };
    });

    const agent = new Agent({
      id: "summary-agent",
      model,
      tools: [wrappedKit],
      lifecycle: {
        onToolStart(event) {
          lifecycleInputs.push(event.input);
        },
      },
    });

    const res = await agent.generate({ prompt: "get 42" });
    expect(res.type).toBe("response");
    expect(receivedByInner).toEqual([{ id: "42" }]);
    expect(seenSummaries).toEqual([
      { toolName: "lookup", summary: "Fetch user profile", args: { id: "42" } },
    ]);
    expect(lifecycleInputs).toEqual([{ id: "42", toolSummary: "Fetch user profile" }]);
  });

  it("does not clobber a tool that already owns the configured summary field even before definition() is called", async () => {
    const existingSummaryTool = createTool({
      name: "save_summary",
      description: "Saves a document summary",
      inputSchema: z.object({ summary: z.string() }),
      handler: (args) => args.summary,
    });

    const wrapped = withToolSummary(existingSummaryTool);
    const parsed = wrapped.parseInput!({ summary: "Quarterly report" });
    expect(await wrapped.call(parsed)).toBe("Quarterly report");
  });

  it("works with transforming parseInput and requiresApproval predicates without leaking synthetic summary field", async () => {
    const approvalArgsSeen: unknown[] = [];
    const transformTool = createTool({
      name: "double",
      description: "Doubles a numeric input",
      inputSchema: z.object({ value: z.number() }).strict(),
      requiresApproval: (args) => {
        approvalArgsSeen.push(args);
        return false;
      },
      handler: (args) => args.value * 2,
    });

    const wrapped = withToolSummary(transformTool);
    const parsed = wrapped.parseInput!({ value: 21, summary: "Double twenty-one" });
    expect(typeof wrapped.requiresApproval).toBe("function");

    if (typeof wrapped.requiresApproval === "function") {
      await wrapped.requiresApproval(parsed, {
        toolName: "double",
        args: parsed,
        rawArgs: JSON.stringify({ value: 21, summary: "Double twenty-one" }),
        toolCallId: "tc-1",
        internalCallId: "ic-1",
        run: { agentId: "test-agent", runId: "run-1" },
      });
    }

    expect(approvalArgsSeen).toEqual([{ value: 21 }]);
    expect(await wrapped.call(parsed)).toBe(42);
  });
});
