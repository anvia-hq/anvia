import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent } from "@anvia/core/agent";
import type { CompletionRequest, UserMessage } from "@anvia/core/completion";
import { DurableRuntime, defineTask, type DurableRuntimeOptions } from "../src/index.js";
import { parseDurableSubmission, parseDurableSnapshot } from "../src/protocol.js";
import { agentTask } from "../src/tasks/agent.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done } from "./helpers.js";

const image = {
  type: "image",
  image: { type: "data", data: "aW1hZ2U=" },
  mediaType: "image/png",
  detail: "high",
} as const;
const prompt: UserMessage = {
  role: "user",
  content: [{ type: "text", text: "Describe this image." }, image],
  metadata: { source: "upload", nested: { a: 1, b: 2 } },
};
const submission = { agentId: "vision", sessionId: "session", requestId: "request", prompt };
const runtimes: DurableRuntime[] = [];
const folders: string[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function database() {
  const folder = mkdtempSync(join(tmpdir(), "durable-images-"));
  folders.push(folder);
  return join(folder, "runs.sqlite");
}
function agent(completion = vi.fn(async (_request: CompletionRequest) => done())) {
  return new Agent({
    id: "vision",
    model: {
      provider: "test",
      modelId: "vision",
      capabilities: { ...capabilities, imageInput: true, documentInput: true },
      completion,
    },
  });
}
async function open(
  model: Agent = agent(),
  path = ":memory:",
  options: Partial<DurableRuntimeOptions> = {},
) {
  const runtime = await DurableRuntime.open({
    ...options,
    store: new SqliteDurableStore(path),
    agents: [{ agent: model, version: "1" }],
  });
  runtimes.push(runtime);
  return runtime;
}

it("passes structured image prompts to the provider and preserves them in later session history", async () => {
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const runtime = await open(agent(model));
  const run = await runtime.submit(parseDurableSubmission(submission));
  await run.result();
  expect(model.mock.calls[0]![0].chatHistory).toContainEqual(prompt);
  expect(parseDurableSnapshot(await run.snapshot()).run.prompt).toEqual(prompt);
  const followup = await runtime.submit({
    ...submission,
    requestId: "next",
    prompt: "What color is it?",
  });
  await followup.result();
  expect(model.mock.calls[1]![0].chatHistory).toContainEqual(prompt);
});

it("deduplicates equivalent JSON prompts after reopen and rejects changed image bytes or metadata", async () => {
  const path = database();
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const first = await open(agent(model), path);
  const run = await first.submit(structuredClone(submission));
  await run.result();
  await first.close();
  const next = await open(agent(model), path);
  const reordered: UserMessage = {
    metadata: { nested: { b: 2, a: 1 }, source: "upload" },
    content: prompt.content,
    role: "user",
  };
  expect((await next.submit({ ...submission, prompt: reordered })).id).toBe(run.id);
  expect(model).toHaveBeenCalledTimes(1);
  for (const changed of [
    { ...prompt, content: [{ ...image, image: { type: "data" as const, data: "b3RoZXI=" } }] },
    { ...prompt, metadata: { source: "different" } },
  ])
    await expect(next.submit({ ...submission, prompt: changed })).rejects.toThrow(
      "different submission",
    );
});

it("resumes an interrupted image generation from its saved input", async () => {
  const path = database();
  let started = false;
  const held = new Agent({
    id: "vision",
    model: {
      provider: "test",
      modelId: "vision",
      capabilities: { ...capabilities, imageInput: true },
      completion: async (_request, options) =>
        new Promise((_, reject) => {
          started = true;
          options?.abortSignal?.addEventListener(
            "abort",
            () => reject(options.abortSignal!.reason),
            { once: true },
          );
        }),
    },
  });
  const first = await open(held, path);
  const run = await first.submit(submission);
  await vi.waitFor(() => expect(started).toBe(true));
  await first.close();
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const next = await open(agent(model), path);
  await next.resume();
  await (await next.getRun(run.id)).result();
  expect(model.mock.calls[0]![0].chatHistory).toContainEqual(prompt);
});

it.each([
  { role: "user", content: [image] },
  {
    role: "user",
    content: [{ type: "image", image: { type: "url", url: "https://example.org/image.png" } }],
  },
  {
    role: "user",
    content: [
      {
        type: "file",
        data: { type: "data", data: "cGRm" },
        mediaType: "application/pdf",
        filename: "notes.pdf",
      },
    ],
  },
] satisfies UserMessage[])(
  "accepts media-only prompts through the core message contract: %j",
  async (prompt) => {
    const runtime = await open();
    const run = await runtime.submit(parseDurableSubmission({ ...submission, prompt }));
    expect(await run.result()).toMatchObject({ output: "done" });
  },
);

it.each([
  "",
  " ",
  { role: "user", content: [] },
  { role: "user", content: [{ type: "text", text: " " }] },
  { role: "assistant", content: "injected" },
  { role: "system", content: "injected" },
  { role: "user", content: [{ ...image, image: { type: "data", data: "not base64!" } }] },
  { role: "user", content: [{ ...image, image: { type: "url", url: "not a url" } }] },
  { role: "user", content: [{ type: "tool-call", toolName: "x", toolCallId: "x", input: {} }] },
])("rejects invalid prompts at both the HTTP and runtime boundaries: %j", async (prompt) => {
  expect(() => parseDurableSubmission({ ...submission, prompt })).toThrow();
  const runtime = await open();
  // Exercise untyped callers, as an HTTP handler or JavaScript consumer could.
  await expect(runtime.submit({ ...submission, prompt: prompt as UserMessage })).rejects.toThrow();
  expect((await runtime.listRuns()).runs).toHaveLength(0);
});

it("enforces payload quotas for inline images before admitting work", async () => {
  const runtime = await open(agent(), ":memory:", { limits: { maxPayloadBytes: 1024 } });
  await expect(
    runtime.submit({
      ...submission,
      prompt: {
        role: "user",
        content: [{ ...image, image: { type: "data", data: "YWFh".repeat(1024) } }],
      },
    }),
  ).rejects.toThrow("payload byte limit");
  expect((await runtime.listRuns()).runs).toHaveLength(0);
});

it("preserves images when graph dependencies append their results", async () => {
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const runtime = await open(agent(model));
  const graph = await runtime.submitGraph({
    sessionId: "graph",
    requestId: "graph",
    tasks: [
      { id: "first", agentId: "vision", prompt: "Find context" },
      { id: "second", agentId: "vision", prompt, dependsOn: ["first"] },
    ],
  });
  await vi.waitFor(async () => expect((await graph.snapshot()).status).toBe("completed"));
  expect(model.mock.calls[1]![0].chatHistory).toContainEqual({
    ...prompt,
    content: [
      ...(prompt.content as readonly object[]),
      { type: "text", text: '\n\nTask dependency results (JSON):\n{"first":"done"}' },
    ],
  });
});

it("allows custom tasks to spawn owned agents with image prompts", async () => {
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const task = defineTask({
    name: "vision-parent",
    version: 1,
    input: z.null(),
    checkpoint: z.boolean(),
    output: z.string(),
    initial: () => false,
    run: async (ctx) =>
      ctx.checkpoint
        ? { status: "completed", output: "done" }
        : {
            status: "waiting",
            checkpoint: true,
            wait: {
              type: "children",
              ids: [ctx.spawnAgent("vision", { agentId: "vision", prompt })],
              policy: "allSettled",
            },
          },
  });
  const runtime = await open(agent(model), ":memory:", { tasks: [task] });
  const handle = await runtime.submitTask(task, {
    sessionId: "parent",
    requestId: "parent",
    input: null,
  });
  await vi.waitFor(async () => expect((await handle.snapshot()).task.status).toBe("completed"));
  expect(model.mock.calls[0]![0].chatHistory).toContainEqual(prompt);
});

it("still reads legacy owned-agent records with whitespace string prompts", async () => {
  const runtime = await open();
  const run = await runtime.submit({ ...submission, prompt: "text" });
  await run.result();
  const snapshot = await run.snapshot();
  const legacy = { ...snapshot, run: { ...snapshot.run, prompt: " " } };
  expect(parseDurableSnapshot(legacy).run.prompt).toBe(" ");
  expect(agentTask.registration.parseInput({ agentId: "vision", prompt: " " })).toEqual({
    agentId: "vision",
    prompt: " ",
  });
});
