// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTeamRun } from "../src/ui/app/modules/teams/use-team-run";

let root: Root;
let container: HTMLDivElement;
let run: ReturnType<typeof useTeamRun>;
let stream: ReadableStreamDefaultController<Uint8Array>;
let signal: AbortSignal;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const encode = (event: unknown) => new TextEncoder().encode(`${JSON.stringify(event)}\n`);
function Harness() {
  const controller = useTeamRun("team/one");
  useEffect(() => {
    run = controller;
  }, [controller]);
  return null;
}
async function emit(event: unknown) {
  await act(async () => stream.enqueue(encode(event)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
  fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
    signal = init!.signal!;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
          signal.addEventListener(
            "abort",
            () => controller.error(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        },
      }),
      { headers: { "x-anvia-team-run-id": "studio/control" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("useTeamRun", () => {
  it("uses the Studio control ID, keeps invalid answers retryable, and resolves concurrent cards independently", async () => {
    await act(async () => {
      void run.start("work");
    });
    await emit({ type: "team_run_started", runId: "studio/control", teamId: "team/one" });
    for (const id of ["a", "b"])
      await emit({
        type: "interaction",
        teamRunId: "core-id",
        instanceId: id,
        interaction: {
          type: "tool-approval",
          id,
          input: {},
          toolName: "write",
          toolCallId: id,
          internalCallId: id,
        },
      });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Invalid answer" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await act(async () => {
      expect(await run.respond("a", { type: "tool-approval", approved: true })).toBe(false);
    });
    expect(run.state.interactions.a?.status).toBe("pending");
    expect(run.controlError).toContain("Invalid answer");
    let resolveApproval!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve;
        }),
    );
    await act(async () => {
      void run.respond("a", { type: "tool-approval", approved: true });
    });
    expect(run.busy.has("a")).toBe(true);
    expect(run.busy.has("b")).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await act(async () => {
      await run.respond("b", { type: "tool-approval", approved: false });
    });
    expect(run.state.interactions.b?.status).toBe("answered");
    await act(async () => resolveApproval(new Response("{}")));
    expect(run.state.interactions.a?.status).toBe("answered");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/teams/team%2Fone/runs/studio%2Fcontrol/interactions/a",
    );
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await act(async () => {
      await run.steer("focus");
    });
    expect(run.state.conversation.at(-1)).toEqual({ type: "prompt", text: "focus" });
  });

  it("preserves an accepted answer when the terminal event precedes its HTTP response", async () => {
    await act(async () => {
      void run.start("work");
    });
    await emit({
      type: "interaction",
      teamRunId: "core",
      instanceId: "a",
      interaction: {
        type: "tool-approval",
        id: "a",
        input: {},
        toolName: "write",
        toolCallId: "a",
        internalCallId: "a",
      },
    });
    let resolveApproval!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve;
        }),
    );
    await act(async () => {
      void run.respond("a", { type: "tool-approval", approved: true });
    });
    await emit({ type: "response", members: [], text: "done" });
    await act(async () => stream.close());
    await act(async () => resolveApproval(new Response("{}")));
    expect(run.state.interactions.a?.status).toBe("answered");
    expect(run.state.status).toBe("completed");
  });

  it("aborts on stop and unmount and reports a truncated stream", async () => {
    await act(async () => {
      void run.start("work");
    });
    await act(async () => run.stop());
    expect(signal.aborted).toBe(true);
    expect(run.state.status).toBe("cancelled");
    await act(async () => {
      run.reset();
      void run.start("again");
    });
    await act(async () => stream.close());
    expect(run.state.status).toBe("failed");
    expect(run.state.error).toContain("before a result");
    await act(async () => {
      void run.start("last");
    });
    act(() => root.unmount());
    expect(signal.aborted).toBe(true);
  });
});
