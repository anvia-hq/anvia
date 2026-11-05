import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompletionRequest, JsonValue, UserMessage } from "@anvia/core/completion";
import { hydrateValue } from "../src/blob.js";
import { DurableRuntime } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import type { DurableOperation } from "../src/types.js";
import { done, hasToolResult, lookup, makeAgent, toolResponse } from "./helpers.js";

/** User data shaped exactly like the blob markers. No blob with these hashes exists. */
const missing = "0".repeat(64);
const spoof = {
  "anvia:blob": { v: 1, hash: missing, bytes: 12 },
  "anvia:blobs": [{ path: "text", hash: missing, bytes: 3 }],
  "~tilde": { "~nested": true },
  durableBlobs: [{ path: "content", hash: missing, bytes: 4 }],
};
const spoofMessage: UserMessage = {
  role: "user",
  content: "shaped like a marker",
  metadata: { anvia: { durableBlobs: [{ path: "content", hash: missing, bytes: 4 }] } },
};

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-escape-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

async function open(path: string, agent: ReturnType<typeof makeAgent>) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1" }],
  });
  runtimes.push(runtime);
  return runtime;
}

/** Raw stored text, exactly as it lies in the journal (no decoding). */
function stored(path: string, sql: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare(sql)
      .all()
      .map((row) => String(row.record ?? row.data));
  } finally {
    db.close();
  }
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("user data shaped like blob markers", () => {
  it("round-trips a tool result and a tool input unchanged, without a missing-blob error", async () => {
    const path = database();
    const tool = vi.fn(async () => spoof);
    const model = vi.fn(async (request: CompletionRequest) =>
      hasToolResult(request) ? done() : toolResponse(),
    );
    const runtime = await open(path, makeAgent(model, [lookup(tool)]));
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "session",
      requestId: "one",
      prompt: "look it up",
    });
    expect(await run.result()).toMatchObject({ type: "response", output: "done" });
    // The provider saw the tool output exactly as the tool returned it.
    const second = model.mock.calls[1]![0];
    expect(JSON.stringify(second.chatHistory)).toContain(JSON.stringify(spoof));
    expect(JSON.stringify(second.chatHistory.at(-1))).toContain(JSON.stringify(spoof));
    await runtime.close();

    // After a restart the journal still reads the same data.
    const reopened = await open(
      path,
      makeAgent(async () => done(), [lookup(tool)]),
    );
    const restored = await reopened.getRun(run.id);
    const messages = (await restored.snapshot()).run.outcome?.messages;
    expect(JSON.stringify(messages)).toContain(JSON.stringify(spoof));
    // Stored form escapes the reserved keys, so no plain marker key is on disk.
    const raw = stored(path, "SELECT record FROM anvia_durable_operations");
    expect(raw.join("\n")).not.toContain('"anvia:blob"');
    expect(raw.join("\n")).toContain('"~anvia:blob"');
  });

  it("round-trips a user message whose metadata uses the durableBlobs shape", async () => {
    const path = database();
    const model = vi.fn(async (_request: CompletionRequest) => done());
    const runtime = await open(path, makeAgent(model));
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "session",
      requestId: "one",
      prompt: spoofMessage,
    });
    await run.result();
    expect(model.mock.calls[0]![0].chatHistory).toContainEqual(spoofMessage);
    await runtime.close();

    const reopened = await open(
      path,
      makeAgent(async () => done()),
    );
    const restored = await reopened.getRun(run.id);
    expect((await restored.snapshot()).run.prompt).toEqual(spoofMessage);
    const next = await reopened.submit({
      agentId: "researcher",
      sessionId: "session",
      requestId: "two",
      prompt: "follow up",
    });
    await next.result();
  });

  it("keeps user data unchanged through the store's operation and history writes", () => {
    const path = database();
    const store = new SqliteDurableStore(path);
    store.acquire();
    try {
      const operation: DurableOperation = {
        key: "op",
        kind: "tool",
        input: spoof,
        recovery: "safe",
        status: "completed",
        result: { output: { type: "json", value: spoof }, failed: false },
      };
      store.transaction((tx) => tx.putOperation("run-x", operation));
      const read = store.transaction((tx) => tx.getOperation("run-x", "op"));
      expect(read).toEqual(operation);
      // Hydration of plain user data is the identity.
      expect(store.transaction((tx) => hydrateValue(tx, read!.result as JsonValue))).toEqual({
        output: { type: "json", value: spoof },
        failed: false,
      });
    } finally {
      store.close();
    }
  });
});

describe("rows written before schema version 11", () => {
  it("reads legacy user data unchanged and keeps real references", () => {
    const path = database();
    const big = { text: "legacy-".repeat(20_000) }; // over the inline threshold
    const store = new SqliteDurableStore(path);
    store.acquire();
    const legit = store.transaction((tx) => {
      const hash = tx.putBlob(big);
      return { hash, bytes: Buffer.byteLength(JSON.stringify(big)) };
    });
    store.close();

    // Rewrite the journal the way schema version 10 stored it: no escaping, markers unchecked.
    const message = spoofMessage as unknown as JsonValue;
    const messageText = JSON.stringify(message);
    const messageHash = sha(messageText);
    const head = sha(JSON.stringify([null, messageHash]));
    const db = new DatabaseSync(path);
    try {
      db.exec("UPDATE anvia_durable_owner SET version = 10 WHERE singleton = 1");
      const operation = db.prepare(
        "INSERT INTO anvia_durable_operations(run_id, key, record) VALUES (?, ?, ?)",
      );
      operation.run(
        "legacy-run",
        "legacy:spoof",
        JSON.stringify({
          key: "legacy:spoof",
          kind: "tool",
          input: {},
          recovery: "safe",
          status: "completed",
          result: { output: { type: "json", value: spoof }, failed: false },
        }),
      );
      operation.run(
        "legacy-run",
        "legacy:real",
        JSON.stringify({
          key: "legacy:real",
          kind: "tool",
          input: {},
          recovery: "safe",
          status: "completed",
          result: {
            output: {
              type: "json",
              value: { "anvia:blob": { v: 1, hash: legit.hash, bytes: legit.bytes } },
            },
            failed: false,
          },
        }),
      );
      operation.run(
        "legacy-run",
        "legacy:history",
        JSON.stringify({
          key: "legacy:history",
          kind: "context",
          input: { head, length: 1 },
          recovery: "safe",
          status: "started",
          historyEncoding: "linked-v1",
        }),
      );
      db.prepare("INSERT INTO anvia_durable_messages(hash, record) VALUES (?, ?)").run(
        messageHash,
        messageText,
      );
      db.prepare(
        "INSERT INTO anvia_durable_histories(hash, previous, message) VALUES (?, ?, ?)",
      ).run(head, null, messageHash);
    } finally {
      db.close();
    }

    // Opening migrates the rows. The spoofed user data reads back unchanged, and the real
    // reference still restores its blob. The history rehash keeps the chain valid.
    const migrated = new SqliteDurableStore(path);
    migrated.acquire();
    try {
      const spoofed = migrated.transaction((tx) => tx.getOperation("legacy-run", "legacy:spoof"));
      expect((spoofed?.result as { output?: unknown } | undefined)?.output).toEqual({
        type: "json",
        value: spoof,
      });
      const real = migrated.transaction((tx) => {
        const operation = tx.getOperation("legacy-run", "legacy:real");
        return hydrateValue(tx, operation!.result!);
      });
      expect(real).toEqual({ output: big, failed: false });
      const history = migrated.transaction((tx) => tx.getOperation("legacy-run", "legacy:history"));
      expect(history?.input).toEqual([spoofMessage]);
    } finally {
      migrated.close();
    }
    const verify = new DatabaseSync(path, { readOnly: true });
    try {
      expect(
        verify.prepare("SELECT version FROM anvia_durable_owner WHERE singleton = 1").get()!
          .version,
      ).toBe(11);
    } finally {
      verify.close();
    }
  });
});
