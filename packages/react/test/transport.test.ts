import type { AgentStreamEvent } from "@anvia/core/agent";
import { AssistantContent, type CompletionStreamEvent, Usage } from "@anvia/core/completion";
import type { UIMessage, UIStreamEvent, UIStreamRequest } from "@anvia/core/ui";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type CreateChatRequestArgs,
  createChatTransport,
  createFetchTransport,
  EventStreamHttpError,
  type EventTransport,
  fetchEventStream,
  readJsonlStream,
  readSseStream,
  useChat,
} from "../src";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("@anvia/react transports", () => {
  it("reads jsonl streams", async () => {
    const parsed = await collect<{ type: string }>(
      readJsonlStream(streamFrom('{"type":"one"}\n{"type":"two"}\n')),
    );

    expect(parsed).toEqual([{ type: "one" }, { type: "two" }]);
  });

  it("reads server-sent event streams", async () => {
    const parsed = await collect<{ type: string; text: string }>(
      readSseStream(streamFrom('event: text\ndata: {"type":"text_delta","text":"hello"}\n\n')),
    );

    expect(parsed).toEqual([{ type: "text_delta", text: "hello" }]);
  });

  it("fetches event streams and infers sse content type", async () => {
    const parsed = await collect<{ type: string }>(
      fetchEventStream("https://example.test/events", {
        fetch: async () =>
          new Response(streamFrom('data: {"type":"one"}\n\n'), {
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          }),
      }),
    );

    expect(parsed).toEqual([{ type: "one" }]);
  });

  it("throws typed HTTP errors with response bodies", async () => {
    let error: unknown;

    try {
      await collect(
        fetchEventStream("https://example.test/events", {
          fetch: async () => new Response("nope", { status: 500 }),
        }),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EventStreamHttpError);
    expect((error as EventStreamHttpError).response.status).toBe(500);
    expect((error as EventStreamHttpError).body).toBe("nope");
  });

  it("creates fetch transports", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Response(streamFrom(`${JSON.stringify({ type: "body", body: init?.body })}\n`)),
    );
    const transport = createFetchTransport<{ message: string }, { type: string }>({
      endpoint: "https://example.test/chat",
      fetch: fetchMock,
    });

    const parsed = await collect(transport.send({ message: "hi" }));

    expect(parsed).toEqual([{ type: "body", body: '{"message":"hi"}' }]);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("does not add an implicit body for GET or HEAD transports", async () => {
    for (const method of ["GET", "HEAD"]) {
      const fetchMock = vi.fn(
        async (_input: string | URL | Request, _init?: RequestInit) =>
          new Response(streamFrom('{"type":"ok"}\n')),
      );
      const transport = createFetchTransport<{ message: string }, { type: string }>({
        endpoint: "https://example.test/events",
        method,
        fetch: fetchMock,
      });

      await collect(transport.send({ message: "hi" }));

      const [, init] = fetchMock.mock.calls[0] ?? [];
      expect(init?.method).toBe(method);
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).has("content-type")).toBe(false);
    }
  });

  it("passes custom fetch transport options and maps events", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(streamFrom('{"ok":true}\n')),
    );
    const transport = createFetchTransport<{ id: string }, { mapped: boolean }>({
      endpoint: (request) => `https://example.test/items/${request.id}`,
      method: "PATCH",
      fetch: fetchMock,
      headers: (request) => ({
        "x-request": request.id,
        "x-override": "base",
      }),
      body: (request) => `payload-${request.id}`,
      init: { credentials: "include" },
      mapEvent: (event) => ({ mapped: (event as { ok?: boolean }).ok === true }),
    });

    const parsed = await collect(
      transport.send(
        { id: "42" },
        {
          headers: {
            "x-extra": "yes",
            "x-override": "transport",
          },
        },
      ),
    );

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(String(input)).toBe("https://example.test/items/42");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe("payload-42");
    expect(init?.credentials).toBe("include");
    expect(headers.get("x-request")).toBe("42");
    expect(headers.get("x-extra")).toBe("yes");
    expect(headers.get("x-override")).toBe("transport");
    expect(parsed).toEqual([{ mapped: true }]);
  });

  it("creates chat transports as fetch transports", async () => {
    const transport = createChatTransport<UIStreamRequest, UIStreamEvent>({
      endpoint: "https://example.test/chat",
      fetch: async () =>
        new Response(
          streamFrom(
            '{"type":"message_start","message":{"id":"msg_1","role":"assistant","parts":[]}}\n',
          ),
        ),
    });

    await expect(collect(transport.send({ messages: [], stream: true }))).resolves.toMatchObject([
      { type: "message_start" },
    ]);
  });
});

describe("@anvia/react useChat", () => {
  it("sends converted core messages and applies UI stream events", async () => {
    const onEvent = vi.fn();
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: async function* (request) {
        expect(request.messages).toHaveLength(1);
        expect(request.messages[0]).toMatchObject({
          role: "user",
          content: [{ type: "text", text: "hi" }],
        });
        expect(request.stream).toBe(true);
        yield {
          type: "message_start",
          message: { id: "assistant_1", role: "assistant", parts: [] },
        };
        yield {
          type: "text_delta",
          messageId: "assistant_1",
          partId: "assistant_1_text",
          delta: "Hel",
        };
        yield {
          type: "text_delta",
          messageId: "assistant_1",
          partId: "assistant_1_text",
          delta: "lo",
        };
        yield {
          type: "message_end",
          messageId: "assistant_1",
          metadata: { providerMessageId: "provider_1" },
        };
      },
    };

    const { result } = renderHook(() => useChat({ transport, onEvent }));

    await act(async () => {
      await result.current.sendMessage({ text: "hi", id: "user_1" });
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeUndefined();
    expect(result.current.text).toBe("Hello");
    expect(result.current.messages).toMatchObject([
      { id: "user_1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "assistant_1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
        metadata: { providerMessageId: "provider_1" },
      },
    ]);
    expect(result.current.events).toHaveLength(4);
    expect(onEvent).toHaveBeenCalledTimes(4);
  });

  it("creates endpoint-backed chat transports", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          streamFrom(
            `${[
              '{"type":"text_delta","delta":"hi"}',
              '{"type":"final","response":{"choice":[{"type":"text","text":"hi"}],"usage":{"inputTokens":0,"outputTokens":0,"totalTokens":0,"cachedInputTokens":0,"cacheCreationInputTokens":0},"rawResponse":{}}}',
            ].join("\n")}\n`,
          ),
          { headers: { "content-type": "application/x-ndjson" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChat({ endpoint: "https://example.test/chat" }));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      stream: true,
    });
    expect(result.current.text).toBe("hi");
  });

  it("passes core and UI messages to custom chat request factories", async () => {
    type CustomRequest = {
      messages: unknown[];
      uiMessages: unknown[];
      stream: true;
    };
    const createRequest = vi.fn((args: CreateChatRequestArgs) => ({
      messages: args.coreMessages,
      uiMessages: args.uiMessages,
      stream: true as const,
    }));
    const transport: EventTransport<CustomRequest, UIStreamEvent> = {
      send: async function* (request) {
        expect(request.messages[0]).toMatchObject({
          role: "user",
          content: [{ type: "text", text: "hello" }],
        });
        expect(request.uiMessages[0]).toMatchObject({
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        });
        yield {
          type: "message_start",
          message: { id: "assistant_1", role: "assistant", parts: [] },
        };
      },
    };
    const { result } = renderHook(() => useChat<CustomRequest>({ transport, createRequest }));

    await act(async () => {
      await result.current.send("hello");
    });

    expect(createRequest).toHaveBeenCalledWith({
      messages: [
        expect.objectContaining({
          role: "user",
          parts: [expect.objectContaining({ type: "text", text: "hello" })],
        }),
      ],
      uiMessages: [
        expect.objectContaining({
          role: "user",
          parts: [expect.objectContaining({ type: "text", text: "hello" })],
        }),
      ],
      coreMessages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
  });

  it("reports UI conversion errors before sending chat requests", async () => {
    const onError = vi.fn();
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: vi.fn(async function* (): AsyncIterable<UIStreamEvent> {
        yield {
          type: "message_start",
          message: { id: "assistant_1", role: "assistant", parts: [] },
        };
      }),
    };
    const invalidMessage: UIMessage = {
      id: "bad_user",
      role: "user",
      parts: [{ id: "bad_part", type: "data", name: "custom", data: { value: 1 } }],
    };
    const { result } = renderHook(() =>
      useChat({
        transport,
        initialMessages: [invalidMessage],
        onError,
      }),
    );

    await act(async () => {
      await result.current.send("hello");
    });

    expect(transport.send).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBeInstanceOf(TypeError);
    expect(onError).toHaveBeenCalledWith(result.current.error);
  });

  it("applies raw completion stream events", async () => {
    const transport: EventTransport<UIStreamRequest, CompletionStreamEvent> = {
      send: async function* () {
        yield { type: "text_delta", delta: "Hel" };
        yield { type: "text_delta", delta: "lo" };
        yield {
          type: "final",
          response: {
            choice: [AssistantContent.text("Hello")],
            usage: Usage.empty(),
            rawResponse: {},
            messageId: "provider_1",
          },
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.text).toBe("Hello");
    expect(result.current.messages).toMatchObject([
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
        metadata: { providerMessageId: "provider_1" },
      },
    ]);
  });

  it("merges raw completion tool call deltas", async () => {
    const transport: EventTransport<UIStreamRequest, CompletionStreamEvent> = {
      send: async function* () {
        yield {
          type: "tool_call_delta",
          id: "tool_1",
          name: "lookup",
          argumentsDelta: '{"query"',
        };
        yield {
          type: "tool_call_delta",
          id: "tool_1",
          argumentsDelta: ':"Anvia"}',
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("lookup");
    });

    expect(result.current.messages[1]?.parts).toEqual([
      expect.objectContaining({
        type: "tool",
        toolName: "lookup",
        toolCallId: "tool_1",
        state: "input-streaming",
        input: '{"query":"Anvia"}',
      }),
    ]);
  });

  it("applies raw agent stream events", async () => {
    const transport: EventTransport<UIStreamRequest, AgentStreamEvent> = {
      send: async function* () {
        yield {
          type: "tool_call",
          turn: 1,
          toolCall: AssistantContent.toolCall("tool_1", "add", { x: 2, y: 5 }, "call_1"),
        };
        yield {
          type: "tool_result",
          turn: 1,
          toolName: "add",
          toolCallId: "call_1",
          internalCallId: "tool_1",
          args: '{"x":2,"y":5}',
          result: "7",
          structuredResult: { value: 7 },
        } as unknown as AgentStreamEvent;
        yield { type: "text_delta", turn: 1, delta: "7" };
        yield {
          type: "final",
          runId: "run_1",
          output: "7",
          usage: Usage.empty(),
          messages: [],
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.send("add");
    });

    expect(result.current.text).toBe("7");
    expect(result.current.messages).toMatchObject([
      { role: "user", parts: [{ type: "text", text: "add" }] },
      {
        role: "assistant",
        metadata: { runId: "run_1" },
      },
    ]);
    const toolParts = result.current.messages[1]?.parts.filter((part) => part.type === "tool");
    expect(toolParts).toEqual([
      expect.objectContaining({
        type: "tool",
        toolName: "add",
        toolCallId: "tool_1",
        callId: "call_1",
        state: "output-available",
        input: { x: 2, y: 5 },
        output: { value: 7 },
      }),
    ]);
    expect(result.current.messages[1]?.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "7" })]),
    );
  });

  it("supports custom event mapping for non-UI streams", async () => {
    const transport: EventTransport<UIStreamRequest, { type: string; delta?: string }> = {
      send: async function* () {
        yield { type: "token", delta: "ok" };
      },
    };
    const { result } = renderHook(() =>
      useChat({
        transport,
        eventToDelta: (event) => (event.type === "token" ? event.delta : undefined),
      }),
    );

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.text).toBe("ok");
  });

  it("lets custom delta mapping override raw Anvia event names", async () => {
    const transport: EventTransport<UIStreamRequest, { type: "text_delta"; delta: string }> = {
      send: async function* () {
        yield { type: "text_delta", delta: "raw" };
      },
    };
    const { result } = renderHook(() =>
      useChat({
        transport,
        eventToDelta: (event) => (event.type === "text_delta" ? "custom" : undefined),
      }),
    );

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.text).toBe("custom");
  });

  it("aborts active streams when stopped", async () => {
    let signal: AbortSignal | undefined;
    let sendPromise!: Promise<void>;
    const transport: EventTransport<UIStreamRequest, UIStreamEvent> = {
      send: async function* (_request, options) {
        signal = options?.signal;
        yield {
          type: "message_start",
          message: { id: "assistant_1", role: "assistant", parts: [] },
        };
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      sendPromise = result.current.send("hi");
      await vi.waitFor(() => {
        expect(signal).toBeDefined();
      });
    });

    act(() => {
      result.current.stop();
    });

    expect(signal?.aborted).toBe(true);
    await sendPromise;
    expect(result.current.status).toBe("idle");
  });

  it("keeps a newer chat stream active when an older stream aborts", async () => {
    const requests: UIStreamRequest[] = [];
    let resolveSecond!: () => void;
    const transport: EventTransport<UIStreamRequest, CompletionStreamEvent> = {
      send: async function* (request, options) {
        requests.push(request);

        if (requests.length === 1) {
          yield { type: "text_delta", delta: "partial" };
          await new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
          return;
        }

        yield { type: "text_delta", delta: "done" };
        await new Promise<void>((resolve) => {
          resolveSecond = resolve;
        });
      },
    };
    const { result } = renderHook(() => useChat({ transport }));

    let firstSend!: Promise<void>;
    act(() => {
      firstSend = result.current.send("first");
    });
    await vi.waitFor(() => {
      expect(result.current.text).toBe("partial");
    });

    let secondSend!: Promise<void>;
    act(() => {
      secondSend = result.current.send("second");
    });
    await vi.waitFor(() => {
      expect(result.current.text).toBe("done");
    });
    await firstSend;

    expect(result.current.status).toBe("streaming");
    expect(requests[1]?.messages).toMatchObject([
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ]);
    expect(requests[1]?.messages).toHaveLength(2);

    await act(async () => {
      resolveSecond();
      await secondSend;
    });

    expect(result.current.status).toBe("idle");
  });

  it("tracks Studio approval and question events", async () => {
    const transport: EventTransport<UIStreamRequest, unknown> = {
      send: async function* () {
        yield {
          type: "tool_approval_request",
          approval: {
            id: "approval-1",
            toolName: "issue_refund",
            status: "pending",
            reason: "Review refund.",
          },
        };
        yield {
          type: "tool_question_request",
          question: {
            id: "question-1",
            toolName: "ask_question",
            status: "pending",
            questions: [
              {
                id: "priority",
                question: "Priority?",
                choices: [{ label: "High", value: "high" }],
              },
            ],
          },
        };
        yield {
          type: "tool_approval_result",
          approval: {
            id: "approval-1",
            toolName: "issue_refund",
            status: "approved",
            reason: "Approved.",
          },
        };
      },
    };
    const { result } = renderHook(() => useChat({ transport, humanInput: { endpoint: "" } }));

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.humanInput.approvals.all).toEqual([
      expect.objectContaining({
        id: "approval-1",
        toolName: "issue_refund",
        status: "approved",
      }),
    ]);
    expect(result.current.humanInput.approvals.pending).toEqual([]);
    expect(result.current.humanInput.questions.pending).toEqual([
      expect.objectContaining({
        id: "question-1",
        toolName: "ask_question",
        status: "pending",
      }),
    ]);
  });

  it("submits Studio approval decisions and question answers to default endpoints", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/approvals/approval-1/decision") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ approved: true, reason: "looks good" }));
        return new Response(
          JSON.stringify({
            id: "approval-1",
            toolName: "issue_refund",
            status: "approved",
          }),
        );
      }
      if (url === "/questions/question-1/answer") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(
          JSON.stringify({
            answers: [{ questionId: "priority", answer: "High", choice: "high" }],
          }),
        );
        return new Response(
          JSON.stringify({
            id: "question-1",
            toolName: "ask_question",
            status: "answered",
            questions: [],
            answers: [{ questionId: "priority", answer: "High", choice: "high" }],
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const transport: EventTransport<UIStreamRequest, unknown> = {
      send: async function* () {
        yield {
          type: "tool_approval_request",
          approval: { id: "approval-1", toolName: "issue_refund", status: "pending" },
        };
        yield {
          type: "tool_question_request",
          question: {
            id: "question-1",
            toolName: "ask_question",
            status: "pending",
            questions: [
              {
                id: "priority",
                question: "Priority?",
                choices: [{ label: "High", value: "high" }],
              },
            ],
          },
        };
      },
    };
    const { result } = renderHook(() =>
      useChat({ transport, humanInput: { endpoint: "", fetch: fetchMock as typeof fetch } }),
    );

    await act(async () => {
      await result.current.send("hi");
    });
    await act(async () => {
      await result.current.approveTool("approval-1", "looks good");
      await result.current.answerToolQuestion("question-1", [
        { questionId: "priority", answer: "High", choice: "high" },
      ]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.humanInput.approvals.pending).toEqual([]);
    expect(result.current.humanInput.questions.pending).toEqual([]);
    expect(result.current.humanInput.questions.all[0]?.answers).toEqual([
      { questionId: "priority", answer: "High", choice: "high" },
    ]);
  });

  it("supports custom human input event mapping and handlers", async () => {
    const decideApproval = vi.fn(async () => ({
      id: "a1",
      toolName: "custom_tool",
      status: "rejected" as const,
    }));
    const answerQuestion = vi.fn(async () => ({
      id: "q1",
      toolName: "custom_question",
      status: "answered" as const,
      questions: [],
    }));
    const transport: EventTransport<UIStreamRequest, { kind: string; payload: unknown }> = {
      send: async function* () {
        yield {
          kind: "approval",
          payload: { id: "a1", toolName: "custom_tool", status: "pending" },
        };
        yield {
          kind: "question",
          payload: { id: "q1", toolName: "custom_question", status: "pending", questions: [] },
        };
      },
    };
    const { result } = renderHook(() =>
      useChat({
        transport,
        humanInput: {
          eventToApproval: (event) =>
            event.kind === "approval"
              ? (event.payload as {
                  id: string;
                  toolName: string;
                  status: "pending";
                })
              : undefined,
          eventToQuestion: (event) =>
            event.kind === "question"
              ? (event.payload as {
                  id: string;
                  toolName: string;
                  status: "pending";
                  questions: [];
                })
              : undefined,
          decideApproval,
          answerQuestion,
        },
      }),
    );

    await act(async () => {
      await result.current.send("hi");
    });
    await act(async () => {
      await result.current.rejectTool("a1", "no");
      await result.current.answerToolQuestion("q1", []);
    });

    expect(decideApproval).toHaveBeenCalledWith({
      approvalId: "a1",
      approved: false,
      reason: "no",
      approval: { id: "a1", toolName: "custom_tool", status: "pending" },
    });
    expect(answerQuestion).toHaveBeenCalledWith({
      questionId: "q1",
      answers: [],
      question: { id: "q1", toolName: "custom_question", status: "pending", questions: [] },
    });
    expect(result.current.humanInput.approvals.all[0]?.status).toBe("rejected");
    expect(result.current.humanInput.questions.all[0]?.status).toBe("answered");
  });

  it("guards duplicate human input submissions while a request is in flight", async () => {
    const pendingResponses: Array<(value: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve);
        }),
    );
    const transport: EventTransport<UIStreamRequest, unknown> = {
      send: async function* () {
        yield {
          type: "tool_approval_request",
          approval: { id: "approval-1", toolName: "issue_refund", status: "pending" },
        };
        yield {
          type: "tool_question_request",
          question: {
            id: "question-1",
            toolName: "ask_question",
            status: "pending",
            questions: [],
          },
        };
      },
    };
    const { result } = renderHook(() =>
      useChat({ transport, humanInput: { endpoint: "", fetch: fetchMock as typeof fetch } }),
    );

    await act(async () => {
      await result.current.send("hi");
    });

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.approveTool("approval-1");
    });
    expect(result.current.decidingApprovals.has("approval-1")).toBe(true);
    await act(async () => {
      await result.current.approveTool("approval-1");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingResponses[0]?.(
        new Response(
          JSON.stringify({
            id: "approval-1",
            toolName: "issue_refund",
            status: "approved",
          }),
        ),
      );
      await first;
    });

    expect(result.current.decidingApprovals.has("approval-1")).toBe(false);

    let questionAnswer!: Promise<void>;
    await act(async () => {
      questionAnswer = result.current.answerToolQuestion("question-1", []);
    });
    expect(result.current.answeringQuestions.has("question-1")).toBe(true);
    await act(async () => {
      await result.current.answerToolQuestion("question-1", []);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingResponses[1]?.(
        new Response(
          JSON.stringify({
            id: "question-1",
            toolName: "ask_question",
            status: "answered",
            questions: [],
          }),
        ),
      );
      await questionAnswer;
    });

    expect(result.current.answeringQuestions.has("question-1")).toBe(false);
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const event of events) {
    items.push(event);
  }
  return items;
}

function streamFrom(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
