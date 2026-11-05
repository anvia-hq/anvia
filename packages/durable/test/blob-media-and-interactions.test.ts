import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import type { CompletionRequest, UserMessage } from "@anvia/core/completion";
import { DurableRuntime } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import type { DurableRun } from "../src/run.js";
import { capabilities, done, lookup, makeAgent, response } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-media-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

async function open(path: string, agent: Agent) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1" }],
  });
  runtimes.push(runtime);
  return runtime;
}

/** Raw stored text of one table column (no decoding), to check what the journal keeps. */
function stored(path: string, sql: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare(sql)
      .all()
      .map((row) => String(Object.values(row)[0]));
  } finally {
    db.close();
  }
}

/** Poll until the run is waiting for an interaction, and return that outcome. */
async function waiting(run: DurableRun) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const outcome = (await run.snapshot()).run.outcome;
    if ((await run.snapshot()).run.status === "waiting" && outcome?.type === "interaction")
      return outcome;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The durable run did not wait for an interaction.");
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const toolCall = (toolName: string, toolCallId: string) =>
  response([{ type: "tool-call", toolCallId, toolName, input: {} }]);

const big = "A".repeat(150_000); // base64-like media, well over the 64 KiB inline threshold
const media: UserMessage = {
  role: "user",
  content: [
    { type: "text", text: "Compare the image with the document." },
    { type: "image", image: { type: "data", data: big }, mediaType: "image/png", detail: "high" },
    {
      type: "file",
      data: { type: "data", data: "B".repeat(150_000) },
      mediaType: "application/pdf",
      filename: "report.pdf",
    },
  ],
  metadata: { source: "upload" },
};
const mediaAgent = (completion: (request: CompletionRequest) => Promise<unknown>) =>
  new Agent({
    id: "researcher",
    model: {
      provider: "test",
      modelId: "vision",
      capabilities: { ...capabilities, imageInput: true, documentInput: true },
      completion: completion as never,
    },
  });

it("stores image and file parts as blob references and restores them intact for later turns", async () => {
  const path = database();
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const runtime = await open(path, mediaAgent(model));
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "one",
    prompt: media,
  });
  await run.result();
  // The provider sees the full media, not a reference.
  expect(model.mock.calls[0]![0].chatHistory).toContainEqual(media);
  await runtime.close();

  // The journal keeps neither the image nor the file bytes inline in operations or messages.
  // The submission (run record and its `submitted` event) keeps the prompt inline, as before this
  // change; the check covers the model input and the history rows that hold the media.
  for (const text of [
    ...stored(path, "SELECT record FROM anvia_durable_operations"),
    ...stored(path, "SELECT record FROM anvia_durable_messages"),
    ...stored(path, "SELECT data FROM anvia_durable_events WHERE type = 'model_started'"),
  ]) {
    expect(text).not.toContain(big);
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM anvia_durable_blobs").get()!.n as number,
    ).toBeGreaterThan(0);
  } finally {
    db.close();
  }

  // A fresh owner runs a follow-up turn; the earlier media comes back from the blob table.
  const restarted = await open(path, mediaAgent(model));
  const followup = await restarted.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "two",
    prompt: "What did the document say?",
  });
  await followup.result();
  expect(model.mock.calls[1]![0].chatHistory).toContainEqual(media);
  const restored = await restarted.getRun(run.id);
  expect((await restored.snapshot()).run.outcome?.messages).toContainEqual(media);
});

/** A tool that returns oversized output first, then a tool that needs approval. */
function fetchThenApprove(seen: CompletionRequest[], fetched: string) {
  const fetch = vi.fn(async () => fetched);
  const approve = vi.fn(async () => "approved result");
  const named = (name: string, call: (input: never) => Promise<string>, approval: boolean) =>
    ({
      ...lookup(call as never),
      name,
      definition: () => ({
        name,
        description: name,
        parameters: { type: "object", properties: {} },
      }),
      requiresApproval: approval,
    }) as ReturnType<typeof lookup>;
  const agent = makeAgent(
    async (request) => {
      seen.push(request);
      const results = request.chatHistory.filter((message) => message.role === "tool").length;
      if (results === 0) return toolCall("fetch", "call-1");
      if (results === 1) return toolCall("approve", "call-2");
      return done();
    },
    [named("fetch", fetch, false), named("approve", approve, true)],
  );
  return { agent, fetch, approve };
}

it("keeps an interaction continuation with oversized history restorable across a restart", async () => {
  const path = database();
  const seen: CompletionRequest[] = [];
  const fetched = `context-${"x".repeat(140_000)}`;
  const { agent, fetch, approve } = fetchThenApprove(seen, fetched);
  const runtime = await open(path, agent);
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "session",
    requestId: "one",
    prompt: "fetch it, then ask me",
  });
  const pending = await waiting(run);
  expect(pending.type).toBe("interaction");
  expect(approve).not.toHaveBeenCalled();
  await runtime.close();

  // The waiting record keeps the oversized transcript out of line.
  for (const record of stored(path, "SELECT record FROM anvia_durable_runs")) {
    expect(record.length).toBeLessThan(10_000);
    expect(record).not.toContain("x".repeat(1_000));
  }

  const restarted = await open(path, agent);
  const restored = await restarted.getRun(run.id);
  if (pending.type !== "interaction") throw new Error("Missing approval");
  await restored.respond(pending.interaction.id, { type: "tool-approval", approved: true });
  expect(await restored.result()).toMatchObject({ type: "response", output: "done" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(approve).toHaveBeenCalledTimes(1);
  const snapshot = await restored.snapshot();
  expect(snapshot.run.status).toBe("completed");
  // The last model call after the restart received the full fetched output from the continuation.
  expect(JSON.stringify(seen.at(-1)!.chatHistory)).toContain(fetched);
});
