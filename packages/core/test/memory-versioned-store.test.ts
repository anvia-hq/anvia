import { describe, expect, it } from "vitest";
import { InMemoryMemoryStore } from "../src/memory/in-memory-store";
import type { MemoryAppendOptions, MemoryScope, MemoryStore } from "../src/memory/types";
import { Agent, AssistantContent, type CompletionModel, Message, Usage } from "./helpers/imports";

const scope: MemoryScope = { sessionId: "thread-1", userId: "user-1" };

function append(
  overrides: Partial<MemoryAppendOptions> & { messages: MemoryAppendOptions["messages"] },
): MemoryAppendOptions {
  return { scope, runId: "run-1", turn: 1, ...overrides };
}

describe("versioned memory store contract", () => {
  it("returns a version with loadVersioned and changes it on every committed append", async () => {
    const store = new InMemoryMemoryStore();

    const empty = await store.loadVersioned({ scope });
    expect(empty).toEqual({ messages: [], version: "0" });

    const result = await store.append(append({ messages: [Message.user("hello")] }));
    expect(result).toEqual({ status: "committed", version: "1" });

    const loaded = await store.loadVersioned({ scope });
    expect(loaded.version).toBe("1");
    expect(loaded.messages).toEqual([Message.user("hello")]);
    expect(await store.load({ scope })).toEqual(loaded.messages);
  });

  it("reports a repeated idempotency key with the same content as duplicate and writes nothing", async () => {
    const store = new InMemoryMemoryStore();
    const write = append({
      idempotencyKey: "run-1:turn-1:user",
      messages: [Message.user("hello")],
    });

    expect(await store.append(write)).toEqual({ status: "committed", version: "1" });
    expect(await store.append(write)).toEqual({ status: "duplicate", version: "1" });

    expect(await store.load({ scope })).toEqual([Message.user("hello")]);
  });

  it("reports a repeated idempotency key with different content as conflict and writes nothing", async () => {
    const store = new InMemoryMemoryStore();
    await store.append(append({ idempotencyKey: "write-1", messages: [Message.user("first")] }));

    const changed = await store.append(
      append({ idempotencyKey: "write-1", messages: [Message.user("second")] }),
    );

    expect(changed).toEqual({ status: "conflict", version: "1" });
    expect(await store.load({ scope })).toEqual([Message.user("first")]);
  });

  it("rejects a write based on a stale version and accepts one based on the current version", async () => {
    const store = new InMemoryMemoryStore();
    const { version } = await store.loadVersioned({ scope });
    await store.append(append({ messages: [Message.user("from another writer")] }));

    const stale = await store.append(
      append({ expectedVersion: version, messages: [Message.user("late")] }),
    );
    expect(stale).toEqual({ status: "conflict", version: "1" });
    expect(await store.load({ scope })).toEqual([Message.user("from another writer")]);

    const fresh = await store.append(
      append({ expectedVersion: "1", messages: [Message.user("on time")] }),
    );
    expect(fresh).toEqual({ status: "committed", version: "2" });
  });

  it("keeps idempotency keys separate per scope", async () => {
    const store = new InMemoryMemoryStore();
    const otherScope: MemoryScope = { sessionId: "thread-2", userId: "user-1" };

    await store.append(append({ idempotencyKey: "shared", messages: [Message.user("a")] }));
    const other = await store.append({
      scope: otherScope,
      runId: "run-1",
      turn: 1,
      idempotencyKey: "shared",
      messages: [Message.user("b")],
    });

    expect(other).toEqual({ status: "committed", version: "1" });
    expect(await store.load({ scope: otherScope })).toEqual([Message.user("b")]);
  });

  it("keeps idempotency keys across clear, so a retried write is not applied twice", async () => {
    const store = new InMemoryMemoryStore();
    const write = append({ idempotencyKey: "key-1", messages: [Message.user("once")] });
    await store.append(write);

    await store.clear({ scope });
    expect((await store.loadVersioned({ scope })).version).toBe("2");

    expect(await store.append(write)).toEqual({ status: "duplicate", version: "2" });
    expect(await store.load({ scope })).toEqual([]);
  });

  it("checks the idempotency key before the version, so a committed retry is a duplicate", async () => {
    const store = new InMemoryMemoryStore();
    const write = append({ idempotencyKey: "key-1", messages: [Message.user("once")] });
    await store.append(write);

    const retry = await store.append({ ...write, expectedVersion: "0" });

    expect(retry).toEqual({ status: "duplicate", version: "1" });
  });

  it("keeps a store that returns void from append working with an Agent", async () => {
    const legacySessions = new Map<string, Message[]>();
    const legacyStore: MemoryStore = {
      async load({ scope: current }) {
        return [...(legacySessions.get(current.sessionId) ?? [])];
      },
      async append(input) {
        const current = legacySessions.get(input.scope.sessionId) ?? [];
        legacySessions.set(input.scope.sessionId, [...current, ...input.messages]);
      },
      async clear({ scope: current }) {
        legacySessions.delete(current.sessionId);
      },
    };
    const model: CompletionModel = {
      provider: "test",
      modelId: "test",
      capabilities: {
        streaming: false,
        tools: false,
        toolChoice: false,
        imageInput: false,
        documentInput: false,
        outputSchema: false,
        reasoning: false,
      },
      async completion() {
        return { choice: [AssistantContent.text("ok")], usage: Usage.empty(), rawResponse: {} };
      },
    };
    const agent = new Agent({ id: "legacy", model, memory: { store: legacyStore } });

    await agent.generate({ prompt: "remember", session: scope });

    expect(await legacyStore.load({ scope })).toHaveLength(2);
  });
});
