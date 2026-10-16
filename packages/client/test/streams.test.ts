import { describe, expect, it, vi } from "vitest";
import { createHttpClientTransport } from "../src/client-transport";
import {
  EventStreamParseError,
  fetchEventStream,
  readJsonlStream,
  readSseFrames,
  readSseStream,
} from "../src/transport";

function chunked(chunks: Array<string | Uint8Array>, onCancel?: () => void) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

describe("readJsonlStream", () => {
  it("skips and reports malformed lines without aborting the stream", async () => {
    const onParseError = vi.fn();
    const values = await collect(
      readJsonlStream(chunked(['{"a":1}\n{bad\n\n  \n{"a":2}\n']), { onParseError }),
    );
    expect(values).toEqual([{ a: 1 }, { a: 2 }]);
    expect(onParseError).toHaveBeenCalledTimes(1);
    const error = onParseError.mock.calls[0]![0] as EventStreamParseError;
    expect(error).toBeInstanceOf(EventStreamParseError);
    expect(error).toMatchObject({ format: "jsonl", raw: "{bad", line: 2 });
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it("throws malformed lines in strict mode and cancels the source", async () => {
    const cancel = vi.fn();
    const iterator = readJsonlStream(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":1}\nnope\n'));
        },
        cancel,
      }),
      { strict: true },
    )[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ a: 1 });
    await expect(iterator.next()).rejects.toBeInstanceOf(EventStreamParseError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("aborts when the error callback throws", async () => {
    const values = readJsonlStream(chunked(["nope\n"]), {
      onParseError(error) {
        throw error;
      },
    });
    await expect(collect(values)).rejects.toThrow("Malformed JSONL frame");
  });

  it("handles LF, CRLF, and bare CR including terminators split across chunks", async () => {
    const values = await collect(
      readJsonlStream(
        chunked(['{"a":1}\r', '\n{"a":2}\r{"a":3}\n{"a":', "4}\r", "", "\n", '{"a":5}']),
      ),
    );
    expect(values).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }]);
  });

  it("decodes multi-byte characters split across chunks and flushes the last line", async () => {
    const bytes = new TextEncoder().encode('{"text":"héllo"}\n{"text":"end"}');
    const values = await collect(readJsonlStream(chunked([bytes.slice(0, 11), bytes.slice(11)])));
    expect(values).toEqual([{ text: "héllo" }, { text: "end" }]);
  });
});

describe("readSseStream", () => {
  it("parses event, id, retry, and multi-line data fields", async () => {
    const frames = await collect(
      readSseFrames(
        chunked([
          ": keep-alive\n",
          "retry: 1500\nid: 7\nevent: update\ndata: {\n",
          'data:  "value":\ndata: "x y"}\n\n',
          "retry: soon\n",
          'data: {"next":true}\n\n',
          "id\n",
          'event: done\ndata:{"done":true}\n\n',
        ]),
      ),
    );
    expect(frames).toEqual([
      { data: { value: "x y" }, event: "update", lastEventId: "7", retry: 1500 },
      { data: { next: true }, event: "message", lastEventId: "7", retry: 1500 },
      { data: { done: true }, event: "done", lastEventId: "", retry: 1500 },
    ]);
  });

  it("strips only one leading space from field values", async () => {
    const frames = await collect(
      readSseFrames(chunked(['event:  spaced\nid:  9\ndata:  "  padded"\n\n'])),
    );
    expect(frames).toEqual([{ data: "  padded", event: " spaced", lastEventId: " 9" }]);
  });

  it("ignores comments, unknown fields, ids with NUL, and frames without data", async () => {
    const values = await collect(
      readSseFrames(
        chunked([
          ": comment\n\n",
          "event: ping\n\n",
          "data:\n\n",
          "id: a\0b\nfoo: bar\nnocolon\n",
          'data: {"ok":true}\n\n',
        ]),
      ),
    );
    expect(values).toEqual([{ data: { ok: true }, event: "message", lastEventId: "" }]);
  });

  it("skips and reports malformed frames with their event metadata", async () => {
    const onParseError = vi.fn();
    const values = await collect(
      readSseStream(
        chunked([
          'data: {"a":1}\n\n',
          "id: 2\nevent: broken\ndata: {oops\n\n",
          'data: {"a":3}\n\n',
        ]),
        { onParseError },
      ),
    );
    expect(values).toEqual([{ a: 1 }, { a: 3 }]);
    expect(onParseError).toHaveBeenCalledTimes(1);
    expect(onParseError.mock.calls[0]![0]).toMatchObject({
      format: "sse",
      raw: "{oops",
      event: "broken",
      lastEventId: "2",
    });
  });

  it("dispatches on blank lines for CRLF, LF, and bare CR split across chunks", async () => {
    const values = await collect(
      readSseStream(
        chunked([
          'data: {"a":1}\r',
          "\n\r",
          '\ndata: {"a":2}\r\r',
          'data: {"a":',
          "3}\n",
          "\n",
          'data: {"a":4}\r',
          "\r",
        ]),
      ),
    );
    expect(values).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
  });

  it("joins multi-line data split across chunks and flushes an unterminated final event", async () => {
    const values = await collect(readSseStream(chunked(["data: [1,\r\nda", "ta: 2]\r\ndata: "])));
    expect(values).toEqual([[1, 2]]);
  });
});

describe("transport parse error wiring", () => {
  it("passes onParseError through fetchEventStream", async () => {
    const onParseError = vi.fn();
    const values = await collect(
      fetchEventStream({
        input: "https://example.test/events",
        fetch: async () =>
          new Response('data: nope\n\ndata: {"a":1}\n\n', {
            headers: { "content-type": "text/event-stream" },
          }),
        onParseError,
      }),
    );
    expect(values).toEqual([{ a: 1 }]);
    expect(onParseError).toHaveBeenCalledWith(expect.objectContaining({ raw: "nope" }));
  });

  it("reports malformed frames from the HTTP client transport", async () => {
    const onParseError = vi.fn();
    const transport = createHttpClientTransport({
      endpoint: "https://example.test/chat",
      onParseError,
      fetch: async () =>
        new Response(
          [
            JSON.stringify({
              type: "stream_start",
              protocol: "anvia.client.v3",
              streamId: "stream_1",
              eventId: 0,
              resumable: false,
            }),
            "{not json",
            JSON.stringify({
              type: "stream_end",
              streamId: "stream_1",
              eventId: 0,
              status: "completed",
            }),
          ].join("\n"),
          {
            headers: {
              "content-type": "application/x-ndjson",
              "x-anvia-stream-protocol": "anvia.client.v3",
            },
          },
        ),
    });
    const frames = await collect(transport.send({ request: { type: "messages", messages: [] } }));
    expect(frames.map((frame) => frame.type)).toEqual(["stream_start", "stream_end"]);
    expect(onParseError).toHaveBeenCalledWith(expect.objectContaining({ raw: "{not json" }));
  });
});
