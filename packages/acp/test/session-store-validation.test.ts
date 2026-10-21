import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FileAcpSessionStore,
  InMemoryAcpSessionStore,
  type AcpSessionRecord,
} from "../src/session-store.js";
import { SessionManager } from "../src/session-manager.js";
import { makeAgent } from "./helpers.js";

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "acp-record-validation-")));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each([
  { role: "user", content: [null] },
  { role: "assistant", content: [{ type: "text", text: 42 }] },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "call", input: {} }] },
  { role: "tool", content: "invalid tool result" },
  { role: "system", content: [] },
  { role: "user", content: "hello", metadata: "invalid metadata" },
])(
  "rejects malformed canonical history before storage or session construction: %j",
  async (message) => {
    const valid: AcpSessionRecord = {
      version: 1,
      sessionId: "valid",
      cwd: root,
      title: "Saved",
      createdAt: "2026-10-19T00:00:00.000Z",
      updatedAt: "2026-10-19T00:00:00.000Z",
      config: { mode: "ask" },
      nextToolId: 0,
      messages: [{ role: "user", content: "hello" }],
      transcript: [],
    };
    const invalid = { ...valid, sessionId: "invalid", messages: [message] } as AcpSessionRecord;
    const path = join(root, "sessions.json");
    const fileStore = new FileAcpSessionStore(path);
    for (const store of [new InMemoryAcpSessionStore(), fileStore]) {
      await expect(Promise.resolve().then(() => store.put(invalid))).rejects.toMatchObject({
        kind: "configuration_error",
      });
    }
    // Corrupt nested content must be isolated just like a corrupt record envelope.
    await writeFile(path, JSON.stringify([invalid, valid]));
    await expect(fileStore.get("invalid")).rejects.toMatchObject({ kind: "configuration_error" });
    expect((await fileStore.list({ limit: 50 })).sessions.map((entry) => entry.sessionId)).toEqual([
      "valid",
    ]);

    const factory = vi.fn(() => makeAgent());
    const replay = vi.fn(async () => {});
    const sessions = new SessionManager({
      sessionFactory: factory,
      sessionStore: { get: async () => invalid, put: async () => {} },
    });
    try {
      await expect(
        sessions.restore(
          "invalid",
          root,
          {
            readTextFile: false,
            writeTextFile: false,
            terminal: false,
            elicitationForm: false,
          },
          [],
          undefined,
          replay,
        ),
      ).rejects.toMatchObject({ kind: "configuration_error" });
      expect(factory).not.toHaveBeenCalled();
      expect(replay).not.toHaveBeenCalled();
    } finally {
      await sessions.close();
    }
  },
);
