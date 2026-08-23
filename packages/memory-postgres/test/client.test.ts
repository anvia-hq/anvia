import { describe, expect, it, vi } from "vitest";
import * as memoryPostgres from "../src/index.js";
import {
  PostgresMemoryClient,
  type PostgresMemoryClientLike,
  type PostgresMemoryQueryResult,
} from "../src/index.js";

// @ts-expect-error The legacy store factory was removed.
const removedStoreFactory = memoryPostgres.createPostgresMemoryStore;
// @ts-expect-error Scope-key creation is canonical in @anvia/core/memory.
const removedScopeKeyFactory = memoryPostgres.createPostgresMemoryScopeKey;
void removedStoreFactory;
void removedScopeKeyFactory;

describe("PostgresMemoryClient", () => {
  it("constructs stores without querying and becomes terminal when closed", async () => {
    const native = new LifecyclePgClient();
    const client = new PostgresMemoryClient({ client: native });
    const store = client.memoryStore();

    expect(native.query).not.toHaveBeenCalled();
    await client.close();
    expect(native.end).not.toHaveBeenCalled();
    await expect(store.load({ scope: { sessionId: "thread-1" } })).rejects.toThrow(
      "PostgresMemoryClient is closed",
    );
  });

  it("memoizes injected initialization without taking ownership", async () => {
    const native = new LifecyclePgClient();
    const client = new PostgresMemoryClient({ client: native });
    const first = client.nativeClient();
    const second = client.nativeClient();

    expect(second).toBe(first);
    await expect(first).resolves.toBe(native);
    await client[Symbol.asyncDispose]();
    expect(native.end).not.toHaveBeenCalled();
  });

  it("lazily creates and closes an internally owned pool", async () => {
    const client = new PostgresMemoryClient({
      connectionString: "postgresql://localhost/anvia_lifecycle_test",
    });

    const native = await client.nativeClient();
    expect(native).toBeDefined();
    const firstClose = client.close();
    const secondClose = client.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(() => client.nativeClient()).toThrow("PostgresMemoryClient is closed");
  });

  it("keeps provisioning and validation explicit", async () => {
    const native = new LifecyclePgClient();
    const client = new PostgresMemoryClient({ client: native });
    const store = client.memoryStore();

    await store.validate();
    expect(native.query).toHaveBeenCalledTimes(2);
    native.query.mockClear();

    await store.ensure();
    expect(native.query.mock.calls[0]?.[0]).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(native.query).toHaveBeenCalledTimes(3);
    await client.close();
  });

  it("rejects removed construction and provisioning options at compile time", () => {
    if (Date.now() === Number.NEGATIVE_INFINITY) {
      // @ts-expect-error Native stores are created by PostgresMemoryClient.
      new memoryPostgres.PostgresMemoryStore({});
      const client = new PostgresMemoryClient({ client: new LifecyclePgClient() });
      client.memoryStore({
        // @ts-expect-error Provisioning is explicit through ensure().
        createIfMissing: true,
      });
      client.memoryStore({
        // @ts-expect-error Error storage uses errorPolicy.
        errors: "ignore",
      });
    }
  });
});

class LifecyclePgClient implements PostgresMemoryClientLike {
  readonly query = vi.fn(
    async (_text: string, _values?: readonly unknown[]): Promise<PostgresMemoryQueryResult> => ({
      rows: [],
    }),
  );
  readonly end = vi.fn(async (): Promise<void> => undefined);
}
