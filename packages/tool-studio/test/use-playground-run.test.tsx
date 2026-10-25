// @vitest-environment happy-dom
import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaygroundRun } from "../src/ui/app/modules/playground/use-playground-run";
import { usePlaygroundTranscript } from "../src/ui/app/modules/playground/use-playground-transcript";
import type { RunState } from "../src/ui/app/modules/shared/types";

type PlaygroundRunProps = Parameters<typeof usePlaygroundRun>[0];

let root: Root;
let container: HTMLDivElement;
let run: ReturnType<typeof usePlaygroundRun>;
let runStates: RunState[];
let streams: ReadableStreamDefaultController<Uint8Array>[];
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

const encode = (frame: unknown) => new TextEncoder().encode(`${JSON.stringify(frame)}\n`);

const sessionsStub = {
  selectedSessionId: "",
  appendSessionLogEntry: vi.fn(),
  createSession: vi.fn(),
  loadAllSessions: vi.fn(async () => {}),
  loadSessionLogs: vi.fn(async () => []),
  openSessionPath: vi.fn(),
  setSelectedSessionId: vi.fn(),
} as unknown as PlaygroundRunProps["sessions"];

const tracesStub = {
  loadSessionTraceSummaries: vi.fn(async () => []),
} as unknown as PlaygroundRunProps["traces"];

function Harness() {
  const [runState, setRunState] = useState<RunState>("idle");
  const transcript = usePlaygroundTranscript();
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const controller = usePlaygroundRun({
    attachments: [],
    messages: transcript.messages,
    promptRef,
    runState,
    selectedAgent: { id: "support", quickPrompts: [] },
    selectedAgentId: "support",
    selectedModelRef: "",
    selectedControls: {},
    sessions: sessionsStub,
    sessionsEnabled: false,
    traces: tracesStub,
    transcript,
    onActivePageChange: vi.fn(),
    onAttachmentsChange: vi.fn(),
    onBeforeRun: vi.fn(),
    onError: vi.fn(),
    onPromptChange: vi.fn(),
    onRunStateChange: (next) => {
      runStates.push(next);
      setRunState(next);
    },
    onSessionTraceSummariesChange: vi.fn(),
    onStatus: vi.fn(),
    onToolCall: vi.fn(),
  });
  useEffect(() => {
    run = controller;
  }, [controller]);
  return null;
}

async function emitRun(events: unknown[]) {
  const stream = streams.at(-1);
  if (stream === undefined) throw new Error("Missing stream");
  const streamId = `stream_${streams.length}`;
  const frames = [
    {
      type: "stream_start",
      protocol: "anvia.client.v3",
      streamId,
      eventId: 0,
      resumable: false,
    },
    ...events.map((event, index) => ({
      type: "stream_event",
      streamId,
      eventId: index + 1,
      event,
    })),
    { type: "stream_end", streamId, eventId: events.length, status: "completed" },
  ];
  for (const frame of frames) {
    await act(async () => stream.enqueue(encode(frame)));
  }
  await act(async () => stream.close());
}

async function suspendFirstRun() {
  let promptDone!: Promise<void>;
  await act(async () => {
    promptDone = run.runPrompt("Delete the account");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await emitRun([
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
  ]);
  await act(async () => {
    await promptDone;
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
  runStates = [];
  streams = [];
  fetchMock = vi.fn<typeof fetch>(async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        controller = stream;
      },
    });
    streams.push(controller);
    return new Response(body, {
      headers: { "x-anvia-stream-protocol": "anvia.client.v3" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("usePlaygroundRun suspended runs", () => {
  it("marks the run suspended and blocks a new prompt while waiting for approval", async () => {
    await suspendFirstRun();
    expect(runStates.at(-1)).toBe("suspended");

    await act(async () => {
      await run.runPrompt("Ignore that, do something else");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runStates.at(-1)).toBe("suspended");
  });

  it("returns to idle when the server no longer has the pending interaction", async () => {
    await suspendFirstRun();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "Interaction continuation is unavailable" } }),
        {
          status: 404,
        },
      ),
    );

    await act(async () => {
      run.decideToolApproval("interaction_1", true);
    });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runStates.at(-1)).toBe("idle");

    await act(async () => {
      void run.runPrompt("Start over");
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await emitRun([
      { type: "run_start", runId: "run_3", source: "agent" },
      { type: "run_end", runId: "run_3", status: "completed" },
    ]);
    expect(runStates.at(-1)).toBe("idle");
  });

  it("unblocks prompts after the approval decision completes", async () => {
    await suspendFirstRun();

    await act(async () => {
      run.decideToolApproval("interaction_1", true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await emitRun([
      { type: "run_start", runId: "run_2", source: "agent" },
      { type: "run_end", runId: "run_2", status: "completed" },
    ]);
    await act(async () => {});
    expect(runStates.at(-1)).toBe("idle");

    await act(async () => {
      void run.runPrompt("Thanks");
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await emitRun([
      { type: "run_start", runId: "run_3", source: "agent" },
      { type: "run_end", runId: "run_3", status: "completed" },
    ]);
    expect(runStates.at(-1)).toBe("idle");
  });
});
