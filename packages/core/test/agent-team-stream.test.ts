import { describe, expect, it } from "vitest";
import {
  AgentTeam,
  AgentTeamLimitError,
  Usage,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type CompletionResponse,
  type ModelCallOptions,
  type StreamingCompletionModel,
} from "./helpers/imports";

class BurstModel implements StreamingCompletionModel {
  readonly provider = "test";
  readonly modelId = "burst";
  readonly capabilities = {
    streaming: true,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: false,
    reasoning: false,
  };
  produced = 0;
  signal: AbortSignal | undefined;
  constructor(private readonly count: number) {}
  async completion(): Promise<CompletionResponse> {
    return this.response();
  }
  async *streamCompletion(
    _request: CompletionRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<CompletionModelStreamEvent> {
    this.signal = options?.abortSignal;
    for (let i = 0; i < this.count; i++) {
      this.produced++;
      yield { type: "text_delta", delta: "x" };
    }
    yield { type: "final", response: this.response() };
  }
  private response(): CompletionResponse {
    return {
      choice: [{ type: "text", text: "x".repeat(this.count) }],
      usage: Usage.empty(),
      rawResponse: {},
    };
  }
}

describe("AgentTeam stream buffering", () => {
  it.each(["events", "textStream"] as const)(
    "handles %s closure without observing either final promise",
    async (channel) => {
      class PendingModel extends BurstModel {
        override async *streamCompletion(
          _request: CompletionRequest,
          options?: ModelCallOptions,
        ): AsyncIterable<CompletionModelStreamEvent> {
          const signal = options?.abortSignal;
          if (signal === undefined) throw new Error("Expected a cancellation signal");
          yield { type: "text_delta", delta: "partial" };
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
          throw signal.reason;
        }
      }
      const unhandled: unknown[] = [];
      const failures: unknown[] = [];
      const onUnhandled = (error: unknown) => {
        unhandled.push(error);
      };
      process.on("unhandledRejection", onUnhandled);
      try {
        const model = new PendingModel(0);
        const stream = new AgentTeam({
          id: "lead",
          model,
          members: [],
          lifecycle: {
            onError: ({ error }) => {
              failures.push(error);
            },
          },
        }).stream({ prompt: "start" });
        for await (const _event of stream[channel]) {
          break;
        }
        // Let Node report any ignored rejected promises; never read stream.result or stream.text.
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          message: expect.stringContaining("Agent run cancelled:"),
        });
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    },
  );

  it("handles provider failure when only the event iterator is consumed", async () => {
    const failure = new Error("provider failed");
    class FailingModel extends BurstModel {
      override async *streamCompletion(): AsyncIterable<CompletionModelStreamEvent> {
        yield { type: "text_delta", delta: "partial" };
        throw failure;
      }
    }
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      unhandled.push(error);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const stream = new AgentTeam({ id: "lead", model: new FailingModel(0), members: [] }).stream({
        prompt: "start",
      });
      await expect(
        (async () => {
          for await (const _event of stream.events) {
          }
        })(),
      ).rejects.toBe(failure);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it.each([8, 32])("cancels a stalled stream at the configured capacity (%s)", async (capacity) => {
    const model = new BurstModel(10_000);
    const team = new AgentTeam({
      id: "lead",
      model,
      members: [],
      limits: { maxBufferedEvents: capacity },
    });
    const stream = team.stream({ prompt: "start" });
    const iterator = stream[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "agent_started" });

    // Leave the iterator paused while producers run.
    const error = await stream.result.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AgentTeamLimitError);
    expect(error).toMatchObject({ limit: "maxBufferedEvents" });
    expect(model.produced).toBeLessThanOrEqual(capacity + 1);
    expect(model.signal?.aborted).toBe(true);
    // Overflow discards buffered progress rather than delivering stale events before the error.
    await expect(iterator.next()).rejects.toBe(error);
    await expect(stream.text).rejects.toBe(error);
  });

  it("bounds unread events rather than the total number of events", async () => {
    const model = new BurstModel(2000);
    const stream = new AgentTeam({
      id: "lead",
      model,
      members: [],
      limits: { maxBufferedEvents: 8 },
    }).stream({ prompt: "start" });
    let deltas = 0;
    for await (const event of stream) {
      if (event.type === "agent_event" && event.event.type === "text_delta") deltas++;
    }
    expect(deltas).toBe(2000);
    expect(await stream.result).toMatchObject({ type: "response", text: "x".repeat(2000) });
  });

  it("does not buffer events for result-only consumption", async () => {
    const model = new BurstModel(2000);
    const team = new AgentTeam({
      id: "lead",
      model,
      members: [],
      limits: { maxBufferedEvents: 1 },
    });
    expect(await team.stream({ prompt: "start" }).text).toBe("x".repeat(2000));
    expect(await team.generate({ prompt: "start" })).toMatchObject({ type: "response" });
  });

  it("rejects both channels if the terminal outcome itself overflows", async () => {
    const team = new AgentTeam({
      id: "lead",
      model: new BurstModel(0),
      members: [],
      limits: { maxBufferedEvents: 1 },
    });
    const stream = team.stream({ prompt: "start" });
    const iterator = stream[Symbol.asyncIterator]();
    let event = await iterator.next();
    while (
      !event.done &&
      !(event.value.type === "agent_event" && event.value.event.type === "response")
    )
      event = await iterator.next();
    expect(event.value).toMatchObject({ type: "agent_event", event: { type: "response" } });
    // agent_idle fills the single slot; the final team outcome then exceeds capacity.
    const error = await stream.result.catch((error: unknown) => error);
    expect(error).toMatchObject({ name: "AgentTeamLimitError", limit: "maxBufferedEvents" });
    await expect(iterator.next()).rejects.toBe(error);
  });

  it("validates capacity and supplies a bounded default", () => {
    const model = new BurstModel(0);
    expect(new AgentTeam({ id: "lead", model, members: [] }).limits.maxBufferedEvents).toBe(1024);
    for (const capacity of [0, -1, 1.5, Infinity, NaN]) {
      expect(
        () =>
          new AgentTeam({
            id: "lead",
            model,
            members: [],
            limits: { maxBufferedEvents: capacity },
          }),
      ).toThrow("maxBufferedEvents");
    }
  });
});
