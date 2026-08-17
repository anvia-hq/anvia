// @vitest-environment happy-dom
import {
  CLIENT_STREAM_PROTOCOL,
  type ClientCompletionRequest,
  type ClientStream,
  type ClientStreamEvent,
  type ClientStreamRequest,
  type ClientTransport,
  createDirectClientTransport,
} from "@anvia/client";
import type { MemoryCompactionMessage } from "@anvia/core/memory";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as publicReact from "../src";
import { useChat, useCompletion } from "../src";
import { saveChatResumeState } from "../src/resume";

declare const incompatibleTransport: ClientTransport<{ query: number }>;
declare const chatTransport: ClientTransport<ClientStreamRequest>;
type AppMetadata = { tenantId: string };
type AppData = { progress: { completed: number; total: number } };
declare const typedChatTransport: ClientTransport<ClientStreamRequest, AppData, AppMetadata>;

function CompileTransportBoundary() {
  // @ts-expect-error Chat transports must accept ClientStreamRequest.
  useChat({ transport: incompatibleTransport });
  // @ts-expect-error Completion transports must accept ClientCompletionRequest.
  useCompletion({ transport: incompatibleTransport });
  // @ts-expect-error React does not own endpoint-based chat transport configuration.
  useChat({ endpoint: "/api/chat" });
  // @ts-expect-error React does not own endpoint-based completion transport configuration.
  useCompletion({ endpoint: "/api/completion" });
  const chat = useChat({ transport: chatTransport });
  // @ts-expect-error send() was removed in favor of sendMessage().
  chat.send({ text: "hello" });
  // @ts-expect-error reset() does not replace the transcript.
  chat.reset([]);
  // @ts-expect-error Tool approvals use the unified interaction response method.
  chat.approveTool({ approvalId: "approval_1" });
  // @ts-expect-error Tool questions use the unified interaction response method.
  chat.answerToolQuestion({ questionId: "question_1", answers: [] });
  const typedChat = useChat({
    transport: typedChatTransport,
    onEvent(event) {
      if (event.type === "data") {
        const completed: number = event.data.completed;
        void completed;
        // @ts-expect-error Custom data remains typed through React events.
        const invalid: string = event.data.completed;
        void invalid;
      }
    },
  });
  void typedChat.sendMessage({ text: "hello", metadata: { tenantId: "acme" } });
  // @ts-expect-error Transport metadata remains typed through sendMessage().
  void typedChat.sendMessage({ text: "hello", metadata: { tenantId: 42 } });
  const metadata: AppMetadata | undefined = typedChat.messages[0]?.metadata;
  void metadata;
  return null;
}
void CompileTransportBoundary;

describe("public boundary", () => {
  it("does not hide explicit memory compaction messages during hydration", () => {
    const compaction: MemoryCompactionMessage = {
      role: "system",
      content: "Earlier conversation summary",
      metadata: {
        anvia: { memoryCompaction: { version: 1, compactedMessageCount: 8 } },
      },
    };
    expect(publicReact.initialMessagesFromMemory([compaction])).toMatchObject([
      { role: "system", metadata: compaction.metadata },
    ]);
  });

  it("does not re-export client protocol or transport ownership", () => {
    expect(publicReact).not.toHaveProperty("createHttpClientTransport");
    expect(publicReact).not.toHaveProperty("createDirectClientTransport");
    expect(publicReact).not.toHaveProperty("parseClientStreamEvent");
    expect(publicReact).not.toHaveProperty("fetchEventStream");
  });

  it("does not expose endpoint or request-factory shortcuts", () => {
    expect(publicReact).not.toHaveProperty("createRequest");
    expect(publicReact).not.toHaveProperty("endpoint");
  });
});

describe("useChat", () => {
  it("exposes memory compaction through events and onEvent without creating a message", async () => {
    const onEvent = vi.fn();
    const transport = createDirectClientTransport({
      handler: () =>
        events([
          { type: "run_start", runId: "run_1", source: "agent" },
          {
            type: "memory_compaction",
            runId: "run_1",
            originalMessageCount: 12,
            compactedMessageCount: 8,
            retainedMessageCount: 4,
            attempts: 1,
            usage: {
              inputTokens: 20,
              outputTokens: 5,
              totalTokens: 25,
              cachedInputTokens: 0,
              cacheCreationInputTokens: 0,
            },
          },
          { type: "run_end", runId: "run_1", status: "completed", text: "done" },
        ]),
    });
    const { result } = renderHook(() => useChat({ transport, onEvent }));

    await act(async () => result.current.sendMessage({ text: "Hi" }));

    expect(result.current.events.map((event) => event.type)).toEqual([
      "run_start",
      "memory_compaction",
      "run_end",
    ]);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "memory_compaction", compactedMessageCount: 8 }),
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.role).toBe("user");
  });

  it("sends core messages and reduces the canonical framed stream", async () => {
    const requests: ClientStreamRequest[] = [];
    const transport = createDirectClientTransport({
      handler: ({ request }) => {
        requests.push(request);
        return events([
          { type: "run_start", runId: "run_1", source: "completion" },
          {
            type: "message_start",
            runId: "run_1",
            messageId: "assistant_1",
            role: "assistant",
          },
          {
            type: "text_start",
            runId: "run_1",
            messageId: "assistant_1",
            partId: "text_1",
          },
          {
            type: "text_delta",
            runId: "run_1",
            messageId: "assistant_1",
            partId: "text_1",
            delta: "Hello",
          },
          {
            type: "text_end",
            runId: "run_1",
            messageId: "assistant_1",
            partId: "text_1",
            text: "Hello!",
          },
          { type: "run_end", runId: "run_1", status: "completed", text: "Hello!" },
        ]);
      },
    });
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => result.current.sendMessage({ text: "Hi" }));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
    expect("stream" in (requests[0] as unknown as Record<string, unknown>)).toBe(false);
    expect(result.current.text).toBe("Hello!");
    expect(result.current.status).toBe("ready");
    expect(result.current.events).toHaveLength(6);
  });

  it("uses submitted, streaming, and error as distinct states", async () => {
    let releaseStart: (() => void) | undefined;
    let releaseEnd: (() => void) | undefined;
    const transport = {
      async *send() {
        yield {
          type: "stream_start" as const,
          protocol: CLIENT_STREAM_PROTOCOL,
          streamId: "stream_1",
          eventId: 0 as const,
          resumable: false,
        };
        await new Promise<void>((resolve) => {
          releaseStart = resolve;
        });
        yield {
          type: "stream_event" as const,
          streamId: "stream_1",
          eventId: 1,
          event: { type: "run_start" as const, runId: "run_1", source: "completion" as const },
        };
        await new Promise<void>((resolve) => {
          releaseEnd = resolve;
        });
        yield {
          type: "stream_event" as const,
          streamId: "stream_1",
          eventId: 2,
          event: {
            type: "error" as const,
            runId: "run_1",
            error: { message: "Safe failure" },
          },
        };
        yield {
          type: "stream_end" as const,
          streamId: "stream_1",
          eventId: 2,
          status: "completed" as const,
        };
      },
    };
    const onError = vi.fn();
    const { result } = renderHook(() => useChat({ transport, onError }));
    let pending: Promise<void>;
    act(() => {
      pending = result.current.sendMessage({ text: "Hi" });
    });
    await waitFor(() => expect(result.current.status).toBe("submitted"));
    act(() => releaseStart?.());
    await waitFor(() => expect(result.current.status).toBe("streaming"));
    act(() => releaseEnd?.());
    await act(async () => pending);
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("Safe failure");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("enters waiting state and resumes through a unified interaction request", async () => {
    const requests: ClientStreamRequest[] = [];
    const transport = createDirectClientTransport({
      handler: ({ request }) => {
        requests.push(request);
        return request.type === "messages"
          ? events([
              { type: "run_start", runId: "run_1", source: "agent" },
              {
                type: "interaction",
                runId: "run_1",
                interaction: {
                  type: "tool-approval",
                  id: "interaction_1",
                  toolName: "delete_account",
                  toolCallId: "call_1",
                  internalCallId: "internal_1",
                  input: { accountId: "account_1" },
                },
              },
              { type: "run_end", runId: "run_1", status: "suspended" },
            ])
          : events([
              { type: "run_start", runId: "run_2", source: "agent" },
              { type: "run_end", runId: "run_2", status: "completed", text: "Deleted" },
            ]);
      },
    });
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => result.current.sendMessage({ text: "Delete the account" }));
    expect(result.current.status).toBe("waiting");
    expect(result.current.interactions.pending).toHaveLength(1);

    await act(async () =>
      result.current.respondToInteraction({
        interactionId: "interaction_1",
        response: { type: "tool-approval", approved: true },
      }),
    );

    expect(requests[1]).toEqual({
      type: "interaction_response",
      interactionId: "interaction_1",
      response: { type: "tool-approval", approved: true },
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.interactions.pending).toHaveLength(0);
    expect(result.current.interactions.all[0]?.status).toBe("responded");
    expect(result.current.respondingInteractions.size).toBe(0);
  });

  it("keeps an interaction pending when transport fails before accepting it", async () => {
    let attempt = 0;
    const transport: ClientTransport<ClientStreamRequest> = {
      async *send() {
        attempt += 1;
        if (attempt > 1) throw new Error("Network unavailable");
        yield {
          type: "stream_start",
          protocol: CLIENT_STREAM_PROTOCOL,
          streamId: "stream_1",
          eventId: 0,
          resumable: false,
        };
        yield {
          type: "stream_event",
          streamId: "stream_1",
          eventId: 1,
          event: {
            type: "interaction",
            runId: "run_1",
            interaction: {
              type: "tool-approval",
              id: "interaction_1",
              toolName: "delete_account",
              toolCallId: "call_1",
              internalCallId: "internal_1",
              input: {},
            },
          },
        };
        yield {
          type: "stream_event",
          streamId: "stream_1",
          eventId: 2,
          event: { type: "run_end", runId: "run_1", status: "suspended" },
        };
        yield {
          type: "stream_end",
          streamId: "stream_1",
          eventId: 2,
          status: "completed",
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));
    await act(async () => result.current.sendMessage({ text: "Delete" }));

    let responseError: unknown;
    await act(async () => {
      try {
        await result.current.respondToInteraction({
          interactionId: "interaction_1",
          response: { type: "tool-approval", approved: false },
        });
      } catch (error) {
        responseError = error;
      }
    });

    expect(responseError).toMatchObject({ message: "The interaction response was not accepted." });
    expect(result.current.status).toBe("error");
    expect(result.current.interactions.pending).toHaveLength(1);
    expect(result.current.respondingInteractions.size).toBe(0);
  });

  it("restores pending interactions when replay resumes after their event", async () => {
    const resume = {
      key: "pending-interaction",
      storage: window.sessionStorage,
      auto: false,
    } as const;
    saveChatResumeState(resume, {
      version: 3,
      streamId: "stream_1",
      lastEventId: 2,
      messages: [],
      interactions: [
        {
          request: {
            type: "tool-approval",
            id: "interaction_1",
            toolName: "delete_account",
            toolCallId: "call_1",
            internalCallId: "internal_1",
            input: {},
          },
          runId: "run_1",
          status: "pending",
        },
      ],
      request: { type: "messages", messages: [] },
    });
    const transport: ClientTransport<ClientStreamRequest> = {
      async *send({ resume: cursor }) {
        expect(cursor).toEqual({ streamId: "stream_1", after: 2 });
        yield {
          type: "stream_start",
          protocol: CLIENT_STREAM_PROTOCOL,
          streamId: "stream_1",
          eventId: 0,
          resumable: true,
        };
        yield {
          type: "stream_end",
          streamId: "stream_1",
          eventId: 2,
          status: "completed",
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport, resume }));

    await act(async () => result.current.resume());

    expect(result.current.status).toBe("waiting");
    expect(result.current.interactions.pending[0]?.request.id).toBe("interaction_1");
  });
});

describe("useCompletion", () => {
  it("runs independent prompt-oriented requests over the client protocol", async () => {
    const requests: ClientCompletionRequest[] = [];
    const transport = createDirectClientTransport<ClientCompletionRequest>({
      handler: ({ request }) => {
        requests.push(request);
        return events([
          { type: "run_start", runId: "run_1", source: "completion" },
          {
            type: "text_delta",
            runId: "run_1",
            messageId: "assistant_1",
            partId: "text_1",
            delta: "Done",
          },
          { type: "run_end", runId: "run_1", status: "completed", text: "Done" },
        ]);
      },
    });
    const { result } = renderHook(() => useCompletion({ transport }));
    act(() => result.current.setInput("Write"));
    await act(async () => result.current.submit());
    expect(requests).toEqual([{ prompt: "Write" }]);
    expect(result.current.input).toBe("Write");
    expect(result.current.completion).toBe("Done");
    expect(result.current.status).toBe("ready");
  });

  it("keeps error status when the stream reports a protocol error event", async () => {
    const onError = vi.fn();
    const transport = createDirectClientTransport<ClientCompletionRequest>({
      handler: () =>
        events([
          { type: "run_start", runId: "run_1", source: "completion" },
          { type: "error", runId: "run_1", error: { message: "Safe failure" } },
          { type: "run_end", runId: "run_1", status: "error" },
        ]),
    });
    const { result } = renderHook(() => useCompletion({ transport, onError }));

    await act(async () => result.current.complete({ prompt: "Write" }));

    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("Safe failure");
    expect(onError).toHaveBeenCalledOnce();
  });
});

function events(values: ClientStreamEvent[]): ClientStream {
  return {
    async *[Symbol.asyncIterator]() {
      yield* values;
    },
  };
}
