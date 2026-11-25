import { readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AgentBlockedOutcome,
  AgentContextInput,
  AgentInteractionOutcome,
  AgentOptions,
  AgentOutcome,
  AgentResponse,
  AgentStream,
  AgentToolInput,
  AgentToolOptions,
  CreateVectorContextOptions,
  AgentErrorStreamEvent as PublicAgentErrorStreamEvent,
  AgentRunOptions as PublicAgentRunOptions,
  AgentStreamEvent as PublicAgentStreamEvent,
  AgentToolCallDeltaEvent as PublicAgentToolCallDeltaEvent,
  Agent as PublicAgentType,
  RetryContext as PublicRetryContext,
  RetryOptions as PublicRetryOptions,
  VectorContext,
} from "../src/agent";
import * as publicAgent from "../src/agent";
import type {
  AgentContinuation as PublicAgentContinuation,
  AgentInteractionRequest as PublicAgentInteractionRequest,
  AgentInteractionResponse as PublicAgentInteractionResponse,
} from "../src/agent/interactions/index";
import * as publicAgentInteractions from "../src/agent/interactions/index";
import type {
  CompletionProviderOutputErrorKind,
  CompletionProviderOutputErrorOptions,
} from "../src/completion";
import * as documents from "../src/documents";
import * as embeddings from "../src/embeddings";
import type {
  AgentErrorStreamEvent as RootAgentErrorStreamEvent,
  AgentOutcome as RootAgentOutcome,
  AgentRunOptions as RootAgentRunOptions,
  AgentStreamEvent as RootAgentStreamEvent,
  AgentToolCallDeltaEvent as RootAgentToolCallDeltaEvent,
  AgentToolOptions as RootAgentToolOptions,
  CompletionProviderOutputErrorKind as RootCompletionProviderOutputErrorKind,
  CompletionProviderOutputErrorOptions as RootCompletionProviderOutputErrorOptions,
  RetryContext as RootRetryContext,
  RetryOptions as RootRetryOptions,
} from "../src/index";
import * as publicCore from "../src/index";
import { Usage } from "../src/index";
// @ts-expect-error ToolApprovalRequest is private to the agent runtime.
import type { ToolApprovalRequest as InternalToolApprovalRequest } from "../src/internal/agent";
import * as internalAgent from "../src/internal/agent";
import * as mcp from "../src/mcp";
import * as memory from "../src/memory";
import * as pipeline from "../src/pipeline";
import * as tool from "../src/tool";
import * as vectorStore from "../src/vector-store";

// @ts-expect-error Agent interaction contracts have a dedicated browser-safe subpath.
type RemovedAgentInteractionResponse = import("../src/agent").AgentInteractionResponse;
// @ts-expect-error Agent interaction contracts are not exported from the root server barrel.
type RemovedRootAgentInteractionResponse = import("../src/index").AgentInteractionResponse;

describe("public exports", () => {
  it("exposes public agent type exports", () => {
    expectTypeOf<AgentOptions>().not.toBeNever();
    expectTypeOf<PublicAgentType>().not.toBeNever();
    expectTypeOf<AgentContextInput>().not.toBeNever();
    expectTypeOf<VectorContext>().not.toBeNever();
    expectTypeOf<CreateVectorContextOptions>().not.toBeNever();
    expectTypeOf<AgentToolInput>().not.toBeNever();
    expectTypeOf<AgentToolOptions>().not.toBeNever();
    expectTypeOf<RemovedAgentInteractionResponse>().toBeAny();
    expectTypeOf<RemovedRootAgentInteractionResponse>().toBeAny();
    expectTypeOf<PublicAgentContinuation>().not.toBeNever();
    expectTypeOf<PublicAgentInteractionRequest>().not.toBeNever();
    expectTypeOf<PublicAgentInteractionResponse>().not.toBeNever();
    expectTypeOf<AgentOutcome>().not.toBeNever();
    expectTypeOf<AgentResponse>().not.toBeNever();
    expectTypeOf<AgentBlockedOutcome>().not.toBeNever();
    expectTypeOf<AgentInteractionOutcome>().not.toBeNever();
    expectTypeOf<RootAgentOutcome>().toEqualTypeOf<AgentOutcome>();
    expectTypeOf<RootAgentToolOptions>().toEqualTypeOf<AgentToolOptions>();
    expectTypeOf<Parameters<PublicAgentType["generate"]>["length"]>().toEqualTypeOf<1>();
    expectTypeOf<Parameters<PublicAgentType["stream"]>["length"]>().toEqualTypeOf<1>();
    expectTypeOf<Parameters<PublicAgentType["compactMemory"]>["length"]>().toEqualTypeOf<1>();
    expectTypeOf<Awaited<ReturnType<PublicAgentType["generate"]>>>().toEqualTypeOf<AgentOutcome>();
    expectTypeOf<ReturnType<PublicAgentType["stream"]>>().toEqualTypeOf<AgentStream>();
    const agent = null as unknown as PublicAgentType;

    if (Date.now() === Number.NEGATIVE_INFINITY) {
      // @ts-expect-error Agent.generate no longer accepts a positional prompt.
      agent.generate("hello");
      // @ts-expect-error Agent.stream no longer accepts a positional prompt.
      agent.stream("hello");
      // @ts-expect-error Continuation runs cannot override prompt or session.
      agent.generate({
        continuation: {} as PublicAgentContinuation,
        response: { type: "tool-approval" as const, approved: true },
        prompt: "not allowed",
      });
    }
  });

  it("keeps domain-specific helpers on their subpaths instead of the root barrel", () => {
    expect("matchesVectorFilter" in vectorStore).toBe(true);
    expect("matchesVectorFilter" in publicCore).toBe(false);
    expect("ingestVectorText" in publicCore).toBe(false);
    expect("chunkTextDocuments" in documents).toBe(true);
    expect("chunkTextDocuments" in publicCore).toBe(false);
    expect("chunkText" in publicCore).toBe(false);
    expect("createMiddleware" in tool).toBe(true);
    expect("createMiddleware" in publicAgent).toBe(false);
    expect("Pipeline" in pipeline).toBe(true);
    expect("Pipeline" in publicCore).toBe(false);
    expect("CompletionProviderOutputError" in publicAgent).toBe(false);
  });

  it("isolates Agent interaction contracts on the browser-safe subpath", async () => {
    expect(typeof publicAgentInteractions.parseAgentContinuation).toBe("function");
    expect(typeof publicAgentInteractions.parseAgentInteractionResponse).toBe("function");
    expect("parseAgentContinuation" in publicAgent).toBe(false);
    expect("parseAgentContinuation" in publicCore).toBe(false);
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { exports?: Record<string, unknown> };
    expect(packageJson.exports).toHaveProperty("./agent/interactions", {
      types: "./dist/agent/interactions/index.d.ts",
      import: "./dist/agent/interactions/index.js",
    });
  });

  it("exposes internal agent integration and hook contracts without leaking to public barrels", () => {
    expect("createHook" in publicCore).toBe(false);
    expect("createHook" in publicAgent).toBe(false);
    expect("createHook" in internalAgent).toBe(true);
    expect("createResolvedAgent" in internalAgent).toBe(true);
    expect("getResolvedAgentOptions" in internalAgent).toBe(true);
    expect("getAgentToolState" in internalAgent).toBe(true);
    expect("withInternalAgentRunOptions" in internalAgent).toBe(true);
    expectTypeOf<InternalToolApprovalRequest>().not.toBeNever();
  });

  it("exposes aligned agent and completion error types across barrels", () => {
    expectTypeOf<RootRetryContext>().toEqualTypeOf<PublicRetryContext>();
    expectTypeOf<RootRetryOptions>().toEqualTypeOf<PublicRetryOptions>();
    expectTypeOf<RootAgentErrorStreamEvent>().toEqualTypeOf<PublicAgentErrorStreamEvent>();
    expectTypeOf<RootAgentRunOptions>().toEqualTypeOf<PublicAgentRunOptions>();
    expectTypeOf<RootAgentToolCallDeltaEvent>().toEqualTypeOf<PublicAgentToolCallDeltaEvent>();
    expectTypeOf<RootAgentStreamEvent>().toEqualTypeOf<PublicAgentStreamEvent>();
    expectTypeOf<RootCompletionProviderOutputErrorKind>().toEqualTypeOf<CompletionProviderOutputErrorKind>();
    expectTypeOf<RootCompletionProviderOutputErrorOptions>().toEqualTypeOf<CompletionProviderOutputErrorOptions>();
    expectTypeOf<
      Extract<PublicAgentStreamEvent, { type: "tool_call_delta" }>
    >().toEqualTypeOf<PublicAgentToolCallDeltaEvent>();
    expectTypeOf<
      Extract<PublicAgentStreamEvent, { type: "error" }>
    >().toEqualTypeOf<PublicAgentErrorStreamEvent>();

    const errorEvent: PublicAgentErrorStreamEvent = {
      type: "error",
      error: new Error("failed"),
      usage: Usage.empty(),
    };
    expect(errorEvent.usage).toEqual(Usage.empty());

    // @ts-expect-error Agent runtime error events require cumulative usage.
    const missingUsage: PublicAgentErrorStreamEvent = { type: "error", error: "failed" };
    void missingUsage;
  });

  it("enforces compile-time object-only signatures and lifecycle boundaries", () => {
    expectTypeOf<
      Parameters<typeof memory.createSummaryMemoryCompactor>["length"]
    >().toEqualTypeOf<1>();

    if (Date.now() === Number.NEGATIVE_INFINITY) {
      const server = null as unknown as mcp.McpServer;
      // @ts-expect-error McpServer is a registration snapshot and does not own lifecycle.
      server.close();

      const model = {
        async embedTexts(texts: string[]) {
          return texts.map((document) => ({ document, vector: [1] }));
        },
      };
      // @ts-expect-error Embedding helpers accept one object argument in RC2.
      void embeddings.embedText(model, "text");
      // @ts-expect-error Document embedding accepts one object argument in RC2.
      void embeddings.embedDocuments(model, ["text"], { content: (text: string) => text });

      const completionModel = null as unknown as import("../src/completion").CompletionModel;
      // @ts-expect-error Summary compactor construction is object-only.
      memory.createSummaryMemoryCompactor(completionModel);
    }
  });
});
