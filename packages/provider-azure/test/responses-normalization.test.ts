import { describe, expect, it } from "vitest";
import { normalizeAzureResponsesStream } from "../src/responses-stream";

function added(id: string, name: string) {
  return {
    type: "response.output_item.added",
    item: { type: "function_call", id, call_id: `call_${id}`, name, arguments: "" },
  };
}

function done(id: string) {
  return { type: "response.function_call_arguments.done", item_id: id, arguments: "{}" };
}

async function* streamOf(events: readonly unknown[]): AsyncIterable<unknown> {
  yield* events;
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("Azure Responses normalization", () => {
  it("resolves interleaved calls by item ID, independently of completion order", async () => {
    const first = added("item_a", "weather");
    const second = added("item_b", "forecast");
    const firstDone = Object.freeze(done("item_a"));
    const secondDone = Object.freeze(done("item_b"));
    const delta = {
      type: "response.function_call_arguments.delta",
      item_id: "item_b",
      delta: "{}",
    };

    await expect(
      collect(
        normalizeAzureResponsesStream(streamOf([first, second, delta, secondDone, firstDone])),
      ),
    ).resolves.toEqual([
      first,
      second,
      delta,
      { ...secondDone, name: "forecast" },
      { ...firstDone, name: "weather" },
    ]);
    expect(firstDone).not.toHaveProperty("name");
    expect(secondDone).not.toHaveProperty("name");
  });

  it("isolates concurrently consumed streams with the same item ID", async () => {
    const [first, second] = await Promise.all([
      collect(normalizeAzureResponsesStream(streamOf([added("same", "weather"), done("same")]))),
      collect(normalizeAzureResponsesStream(streamOf([added("same", "forecast"), done("same")]))),
    ]);
    expect(first[1]).toMatchObject({ name: "weather" });
    expect(second[1]).toMatchObject({ name: "forecast" });
  });

  it("does not reuse a previous stream's function name", async () => {
    await collect(
      normalizeAzureResponsesStream(streamOf([added("same", "weather"), done("same")])),
    );
    await expect(
      collect(normalizeAzureResponsesStream(streamOf([done("same")]))),
    ).rejects.toMatchObject({ kind: "invalid-tool-call", toolCallId: "same" });
  });

  it("uses the call ID when the added item omits its item ID", async () => {
    const event = added("item", "weather");
    const { id: _id, ...item } = event.item;
    await expect(
      collect(normalizeAzureResponsesStream(streamOf([{ ...event, item }, done("call_item")]))),
    ).resolves.toEqual([
      { ...event, item },
      { ...done("call_item"), name: "weather" },
    ]);
  });

  it.each(["forecast", "", null, 42])(
    "leaves an explicit name %j for protocol validation",
    async (name) => {
      const terminal = { ...done("item"), name };
      const events = await collect(
        normalizeAzureResponsesStream(streamOf([added("item", "weather"), terminal])),
      );
      expect(events[1]).toBe(terminal);
    },
  );

  it("passes unrelated events and provider errors through unchanged", async () => {
    const events = [
      null,
      "unknown",
      { type: "response.output_text.delta", delta: "hello" },
      { type: "response.failed", response: { error: { message: "filtered" } } },
    ];
    const result = await collect(normalizeAzureResponsesStream(streamOf(events)));
    result.forEach((event, index) => expect(event).toBe(events[index]));
  });

  it("closes the upstream iterator when consumption ends early", async () => {
    let closed = false;
    async function* source() {
      try {
        yield added("item", "weather");
        yield done("item");
      } finally {
        closed = true;
      }
    }
    const iterator = normalizeAzureResponsesStream(source())[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(closed).toBe(true);
  });

  it("preserves transport errors", async () => {
    const failure = new Error("connection closed");
    async function* source() {
      yield added("item", "weather");
      throw failure;
    }
    await expect(collect(normalizeAzureResponsesStream(source()))).rejects.toBe(failure);
  });
});
