import {
  Agent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  createTool,
  Usage,
} from "@anvia/core";
import { ToolOutput } from "@anvia/core/tool";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  lengthGuardrail,
  llmGuardrail,
  piiGuardrail,
  secretLeakGuardrail,
} from "../src/guardrails";
import { type AuditEvent, auditHook, consoleHook, type UsageReport, usageHook } from "../src/hooks";
import { redactCompletionRequest, redactToolOutput, toolOutputLimit } from "../src/middlewares";

function createFakeModel(
  handler: (request: CompletionRequest) => Promise<CompletionResponse> | CompletionResponse,
  capabilitiesOverride: Partial<CompletionModel["capabilities"]> = {},
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
      ...capabilitiesOverride,
    },
    async completion(request) {
      return handler(request);
    },
  };
}

describe("guardrails", () => {
  it("redacts PII, blocks leaked secrets, and resists data:...;base64, prefix bypass", async () => {
    let seenPromptText = "";
    const model = createFakeModel((req) => {
      const userMsg = req.chatHistory.find((m) => m.role === "user");
      seenPromptText =
        userMsg && typeof userMsg.content === "string"
          ? userMsg.content
          : JSON.stringify(userMsg?.content ?? "");
      return {
        choice: [{ type: "text", text: "Contact alice@example.com for details." }],
        usage: Usage.empty(),
        rawResponse: {},
      };
    });

    const piiAgent = new Agent({
      id: "pii-agent",
      model,
      guardrails: [piiGuardrail({ boundary: "both", action: "redact" })],
    });

    const res = await piiAgent.generate({
      prompt: "data:text/plain;base64, My email is bob@example.com",
    });
    expect(seenPromptText).toContain("[redacted-pii]");
    expect(seenPromptText).not.toContain("bob@example.com");
    expect(res.type).toBe("response");

    if (res.type === "response") {
      expect(res.output).toBe("Contact [redacted-pii] for details.");
    }

    const secretModel = createFakeModel(() => ({
      choice: [
        {
          type: "text",
          text: "data:text/plain;base64, key: ghp_123456789012345678901234567890123456",
        },
      ],
      usage: Usage.empty(),
      rawResponse: {},
    }));
    const secretAgent = new Agent({
      id: "secret-agent",
      model: secretModel,
      guardrails: [secretLeakGuardrail()],
    });

    const blocked = await secretAgent.generate({ prompt: "give me token" });
    expect(blocked.type).toBe("blocked");
  });

  it("enforces lengthGuardrail block and truncate strictly even when maxChars < suffix.length", async () => {
    const model = createFakeModel(() => ({
      choice: [{ type: "text", text: "0123456789abcdef" }],
      usage: Usage.empty(),
      rawResponse: {},
    }));

    const blockingAgent = new Agent({
      id: "len-block",
      model,
      guardrails: [lengthGuardrail({ maxChars: 5, boundary: "input", action: "block" })],
    });
    expect((await blockingAgent.generate({ prompt: "too long input" })).type).toBe("blocked");

    const truncAgent = new Agent({
      id: "len-trunc",
      model,
      guardrails: [
        lengthGuardrail({ maxChars: 10, boundary: "output", action: "truncate", suffix: "..." }),
      ],
    });
    const out = await truncAgent.generate({ prompt: "ok" });
    expect(out.type).toBe("response");

    if (out.type === "response") {
      expect(out.output).toBe("0123456...");
    }

    const tinyAgent = new Agent({
      id: "len-tiny",
      model,
      guardrails: [lengthGuardrail({ maxChars: 5, boundary: "output", action: "truncate" })],
    });
    const tinyOut = await tinyAgent.generate({ prompt: "ok" });
    expect(tinyOut.type).toBe("response");

    if (tinyOut.type === "response") {
      expect(tinyOut.output.length).toBeLessThanOrEqual(5);
    }
  });

  it("runs llmGuardrail with structured output and non-outputSchema fallback parsing", async () => {
    const judgeModel = createFakeModel(
      (req) => {
        const prompt = JSON.stringify(req.chatHistory);
        const allowed = !prompt.includes("forbidden");
        return {
          choice: [
            {
              type: "text",
              text: `Verdict:\n\`\`\`json\n${JSON.stringify({
                allowed,
                reason: allowed ? "Compliant" : "Contains forbidden topic",
              })}\n\`\`\``,
            },
          ],
          usage: Usage.empty(),
          rawResponse: {},
        };
      },
      { outputSchema: false, temperature: false },
    );

    const mainModel = createFakeModel(() => ({
      choice: [{ type: "text", text: "ok" }],
      usage: Usage.empty(),
      rawResponse: {},
    }));

    expect(() => llmGuardrail({ model: judgeModel, policy: "ok", maxTokens: 0 })).toThrow(
      /maxTokens/,
    );

    const agent = new Agent({
      id: "llm-guard-agent",
      model: mainModel,
      guardrails: [
        llmGuardrail({
          model: judgeModel,
          policy: "Disallow forbidden topics.",
          boundary: "input",
        }),
      ],
    });

    expect((await agent.generate({ prompt: "safe question" })).type).toBe("response");
    expect((await agent.generate({ prompt: "forbidden question" })).type).toBe("blocked");
  });
});

describe("middlewares", () => {
  it("truncates oversized plain and multi-part structured tool outputs within maxChars and redacts safely", async () => {
    const noisyTool = createTool({
      name: "noisy",
      description: "Returns a long string with email",
      inputSchema: z.object({}),
      handler: () => "Email alice@example.com " + "x".repeat(100),
    });

    const richTool = createTool({
      name: "rich",
      description: "Returns structured content with FilePart text",
      inputSchema: z.object({}),
      handler: () =>
        ToolOutput.content([
          { type: "text", text: "0123456789" },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "contact-bob@example.com.txt",
            data: { type: "text", text: "secret carol@example.com 01234567890123456789" },
          },
        ]),
    });

    const seenRequests: CompletionRequest[] = [];
    let turn = 0;

    const model = createFakeModel((req) => {
      seenRequests.push(req);
      turn++;

      if (turn === 1) {
        return {
          choice: [
            {
              type: "tool-call",
              toolCallId: "sk_call_1234567890123456",
              toolName: "noisy",
              input: {},
            },
            { type: "tool-call", toolCallId: "c2", toolName: "rich", input: {} },
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

    const binaryPayload = "AIzaSyA12345678901234567890123456789012=";
    const agent = new Agent({
      id: "mw-agent",
      model,
      context: [
        {
          id: "doc-alice@example.com",
          text: "Body text",
          additionalProps: { owner: "owner@example.com" },
        },
      ],
      tools: [noisyTool, richTool],
      middlewares: [
        redactToolOutput({ replacement: "[hidden]" }),
        toolOutputLimit({ maxChars: 25, suffix: "..." }),
        redactCompletionRequest({ replacement: "[req-redacted]" }),
      ],
    });

    const res = await agent.generate({
      prompt: {
        role: "user",
        content: [
          { type: "text", text: "hi bob@example.com" },
          { type: "image", image: { type: "data", data: binaryPayload }, mediaType: "image/png" },
        ],
      },
    });
    expect(res.type).toBe("response");

    const firstReq = seenRequests[0]!;
    const userMsg = firstReq.chatHistory.find((m) => m.role === "user")!;
    expect(Array.isArray(userMsg.content)).toBe(true);

    if (Array.isArray(userMsg.content)) {
      expect(userMsg.content[0]).toEqual({ type: "text", text: "hi [req-redacted]" });
      expect(userMsg.content[1]).toEqual({
        type: "image",
        image: { type: "data", data: binaryPayload },
        mediaType: "image/png",
      });
    }

    expect(firstReq.documents[0]?.id).toBe("[req-redacted]");
    expect(firstReq.documents[0]?.additionalProps?.owner).toBe("[req-redacted]");

    const secondReq = seenRequests[1]!;
    const assistantMsg = secondReq.chatHistory.find((m) => m.role === "assistant")!;

    if (assistantMsg.role === "assistant" && Array.isArray(assistantMsg.content)) {
      const firstCall = assistantMsg.content[0];
      expect(firstCall?.type).toBe("tool-call");

      if (firstCall?.type === "tool-call") {
        expect(firstCall.toolCallId).toBe("sk_call_1234567890123456");
      }
    }

    const toolMsgs = secondReq.chatHistory.filter((m) => m.role === "tool");
    const serializedTools = JSON.stringify(toolMsgs);
    expect(serializedTools).toContain("[hidden]");
    expect(serializedTools).not.toContain("alice@example.com");
    expect(serializedTools).not.toContain("carol@example.com");
    expect(serializedTools).not.toContain("bob@example.com");
    expect(serializedTools).toContain("...");
  });
});

describe("hooks", () => {
  it("composes usageHook, auditHook, and consoleHook on structured-output Agent without duplicate error reports", async () => {
    const reports: UsageReport[] = [];
    const auditEvents: AuditEvent[] = [];
    const consoleLines: string[] = [];
    let nowMs = 10_000;

    const ping = createTool({
      name: "ping",
      description: "Ping",
      inputSchema: z.object({}),
      handler: () => "pong",
    });

    let turn = 0;
    const model = createFakeModel(() => {
      turn++;
      nowMs += 50;

      if (turn === 1) {
        return {
          choice: [{ type: "tool-call", toolCallId: "c1", toolName: "ping", input: {} }],
          usage: { ...Usage.empty(), inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          rawResponse: {},
        };
      }

      return {
        choice: [{ type: "text", text: JSON.stringify({ answer: "all good" }) }],
        usage: { ...Usage.empty(), inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        rawResponse: {},
      };
    });

    const tracker = usageHook({
      onReport: (report) => void reports.push(report),
      now: () => nowMs,
    });
    const auditor = auditHook({
      onEvent: (event) => void auditEvents.push(event),
      timestamp: () => "2026-11-28T00:00:00.000Z",
    });
    const logger = consoleHook({ writer: (line) => void consoleLines.push(line) });

    const agent = new Agent({
      id: "hooks-agent",
      model,
      outputSchema: z.object({ answer: z.string() }),
      tools: [ping],
      lifecycle: [tracker, auditor, logger],
    });

    const outcome = await agent.generate({ prompt: "ping" });
    expect(outcome.type).toBe("response");

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      status: "completed",
      steps: 2,
      toolCalls: 1,
      toolFailures: 0,
      durationMs: 100,
      usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
    });

    expect(auditEvents.map((e) => e.type)).toEqual([
      "run.start",
      "step.finish",
      "tool.start",
      "tool.finish",
      "step.finish",
      "run.finish",
    ]);
    expect(consoleLines.some((l) => l.includes("tool=ping ok"))).toBe(true);
    expect(consoleLines.some((l) => l.includes("finish status=completed"))).toBe(true);
  });
});
