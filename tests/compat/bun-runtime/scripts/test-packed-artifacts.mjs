import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const require = createRequire(import.meta.url);
const tscEntrypoint = require.resolve("typescript/bin/tsc");
const temporaryRoot = await mkdtemp(join(tmpdir(), "anvia-bun-packed-"));
const packsDirectory = join(temporaryRoot, "packs");
const consumerDirectory = join(temporaryRoot, "consumer");
const smokeSource = smokeTestSource();

try {
  await mkdir(packsDirectory);
  await mkdir(consumerDirectory);
  await run("pnpm", ["pack", "--pack-destination", packsDirectory], {
    cwd: join(repositoryRoot, "packages/core"),
  });
  await run("pnpm", ["pack", "--pack-destination", packsDirectory], {
    cwd: join(repositoryRoot, "packages/client"),
  });
  await run("pnpm", ["pack", "--pack-destination", packsDirectory], {
    cwd: join(repositoryRoot, "packages/server"),
  });
  await run("pnpm", ["pack", "--pack-destination", packsDirectory], {
    cwd: join(repositoryRoot, "packages/provider-openai"),
  });
  await run("pnpm", ["pack", "--pack-destination", packsDirectory], {
    cwd: join(repositoryRoot, "packages/mcp"),
  });
  await run("pnpm", ["pack", "--pack-destination", packsDirectory], {
    cwd: join(repositoryRoot, "packages/memory-sqlite"),
  });

  const archives = await readdir(packsDirectory);
  const coreArchive = requireArchive(archives, "anvia-core-");
  const clientArchive = requireArchive(archives, "anvia-client-");
  const serverArchive = requireArchive(archives, "anvia-server-");
  const openaiArchive = requireArchive(archives, "anvia-openai-");
  const mcpArchive = requireArchive(archives, "anvia-mcp-");
  const memorySqliteArchive = requireArchive(archives, "anvia-memory-sqlite-");
  await writeFile(
    join(consumerDirectory, "package.json"),
    JSON.stringify(
      {
        name: "anvia-bun-packed-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@anvia/client": `file:${join(packsDirectory, clientArchive)}`,
          "@anvia/core": `file:${join(packsDirectory, coreArchive)}`,
          "@anvia/mcp": `file:${join(packsDirectory, mcpArchive)}`,
          "@anvia/memory-sqlite": `file:${join(packsDirectory, memorySqliteArchive)}`,
          "@anvia/openai": `file:${join(packsDirectory, openaiArchive)}`,
          "@anvia/server": `file:${join(packsDirectory, serverArchive)}`,
        },
      },
      undefined,
      2,
    ),
  );
  await writeFile(join(consumerDirectory, "smoke.mjs"), smokeSource);

  await run("bun", ["install", "--ignore-scripts"], { cwd: consumerDirectory });
  await writeFile(
    join(consumerDirectory, "tsconfig.json"),
    `${JSON.stringify(consumerTsconfig(), undefined, 2)}\n`,
  );
  await writeFile(join(consumerDirectory, "consumer.ts"), consumerSource());
  await run(process.execPath, [tscEntrypoint, "-p", join(consumerDirectory, "tsconfig.json")], {
    cwd: consumerDirectory,
  });
  console.log("Packed TypeScript consumer compiles against installed declarations.");
  await run("bun", ["run", "./smoke.mjs"], { cwd: consumerDirectory });
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

function requireArchive(archives, prefix) {
  const archive = archives.find((entry) => entry.startsWith(prefix) && entry.endsWith(".tgz"));
  if (archive === undefined) {
    throw new Error(`Packed archive not found for ${prefix}`);
  }
  return archive;
}

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${
            signal === null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`
          }`,
        ),
      );
    });
  });
}

function smokeTestSource() {
  return `
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createHttpClientTransport, parseClientStreamRequest } from "@anvia/client";
import { Agent } from "@anvia/core";
import { chunkText } from "@anvia/core/documents";
import { toReadableStream } from "@anvia/core/streaming";
import { McpClient } from "@anvia/mcp";
import { SqliteMemoryClient } from "@anvia/memory-sqlite";
import { OpenAIClient } from "@anvia/openai";
import {
  createClientStreamResponse,
  createMemoryResumableStreamStore,
  createResumableStream,
  resumeClientStreamResponse,
} from "@anvia/server";

assert.equal(typeof Agent, "function");
assert.equal(typeof createHttpClientTransport, "function");
assert.equal(typeof chunkText, "function");
assert.equal(typeof toReadableStream, "function");
assert.equal(typeof McpClient, "function");
assert.equal(typeof createClientStreamResponse, "function");

const mcpClient = new McpClient({
  name: "packed-mcp",
  transport: {
    type: "custom",
    create() {
      throw new Error("Packed MCP transport should not connect during this smoke test");
    },
  },
});
assert.equal(mcpClient.name, "packed-mcp");

const packedTransport = createHttpClientTransport({
  endpoint: "https://packed.invalid/stream",
  fetch: async () =>
    createClientStreamResponse({
      events: (async function* () {
        yield { type: "run_start", runId: "packed-run", source: "completion" };
        yield { type: "run_end", runId: "packed-run", status: "completed" };
      })(),
      streamId: "packed-stream",
    }),
});
const packedFrames = [];
for await (const frame of packedTransport.send({
  request: { type: "messages", messages: [] },
})) {
  packedFrames.push(frame);
}
assert.deepEqual(
  packedFrames.map((frame) => frame.type),
  ["stream_start", "stream_event", "stream_event", "stream_end"],
);

const packedServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch() {
    return createClientStreamResponse({
      events: (async function* () {
        yield { type: "run_start", runId: "packed-live", source: "completion" };
        yield { type: "run_end", runId: "packed-live", status: "completed" };
      })(),
      streamId: "packed-http",
    });
  },
});
const packedHttpTransport = createHttpClientTransport({
  endpoint: new URL("/", packedServer.url),
});
const packedHttpFrames = [];
for await (const frame of packedHttpTransport.send({
  request: { type: "messages", messages: [] },
})) {
  packedHttpFrames.push(frame);
}
packedServer.stop(true);
assert.deepEqual(
  packedHttpFrames.map((frame) => frame.type),
  ["stream_start", "stream_event", "stream_event", "stream_end"],
);
assert.deepEqual(packedHttpFrames[2].event, {
  type: "run_end",
  runId: "packed-live",
  status: "completed",
});

const packedStore = createMemoryResumableStreamStore();
const packedProducer = (async function* () {
  yield { kind: "one" };
  yield { kind: "two" };
})();
const packedReplay = [];
for await (const envelope of createResumableStream({
  id: "packed-resumable",
  store: packedStore,
  events: packedProducer,
})) {
  packedReplay.push(envelope);
}
assert.deepEqual(
  packedReplay.map((envelope) => envelope.type),
  ["stream_start", "stream_event", "stream_event", "stream_end"],
);
assert.equal(packedReplay[3].status, "completed");

const packedMemoryRoot = await mkdtemp(join(tmpdir(), "anvia-bun-packed-memory-"));
const packedMemoryClient = new SqliteMemoryClient({
  path: join(packedMemoryRoot, "memory.sqlite"),
});
const packedMemoryStore = packedMemoryClient.memoryStore();
await packedMemoryStore.ensure();
const packedMemoryScope = { sessionId: "packed-memory-thread", userId: "packed-user" };
await packedMemoryStore.append({
  scope: packedMemoryScope,
  runId: "packed-run",
  turn: 0,
  messages: [
    { role: "user", content: [{ type: "text", text: "remember this" }] },
    { role: "assistant", content: [{ type: "text", text: "stored" }] },
  ],
});
const packedLoaded = await packedMemoryStore.load({ scope: packedMemoryScope });
assert.equal(packedLoaded.length, 2);
assert.equal(packedLoaded[0].role, "user");
assert.equal(packedLoaded[1].role, "assistant");
const [packedConversation] = await packedMemoryStore.inspector.listConversations({ limit: 1 });
assert.equal(packedConversation.sessionId, "packed-memory-thread");
assert.equal(packedConversation.messageCount, 2);
await packedMemoryClient.close();
await rm(packedMemoryRoot, { recursive: true, force: true });

const packedInjectedRoot = await mkdtemp(join(tmpdir(), "anvia-bun-packed-memory-injected-"));
const { Database: PackedBunDatabase } = require("bun:sqlite");
const packedInjectedClient = new SqliteMemoryClient({
  database: new PackedBunDatabase(join(packedInjectedRoot, "injected.sqlite")),
});
const packedInjectedStore = packedInjectedClient.memoryStore();
await packedInjectedStore.ensure();
const packedInjectedScope = { sessionId: "packed-injected-thread" };
await packedInjectedStore.append({
  scope: packedInjectedScope,
  runId: "packed-run",
  turn: 0,
  messages: [{ role: "user", content: [{ type: "text", text: "injected works" }] }],
});
const packedInjectedLoaded = await packedInjectedStore.load({ scope: packedInjectedScope });
assert.equal(packedInjectedLoaded.length, 1);
assert.equal(packedInjectedLoaded[0].role, "user");
await packedInjectedClient.close();
await rm(packedInjectedRoot, { recursive: true, force: true });
console.log("Packed memory-sqlite round-trips under Bun.");

let releasePackedProducer;
const packedResumeStore = createMemoryResumableStreamStore();
const packedResumeServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const body = parseClientStreamRequest(await request.json());
    if (body.resume !== undefined) {
      return resumeClientStreamResponse({
        streamId: body.resume.streamId,
        after: body.resume.after,
        store: packedResumeStore,
      });
    }
    return createClientStreamResponse({
      events: gatedProducer(),
      resumable: { streamId: "packed-resume", store: packedResumeStore },
    });
  },
});
function gatedProducer() {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "run_start", runId: "packed-resume", source: "completion" };
      await new Promise((resolve) => {
        releasePackedProducer = resolve;
      });
      yield { type: "run_end", runId: "packed-resume", status: "completed" };
    },
  };
}
const firstIterator = createHttpClientTransport({
  endpoint: new URL("/resume", packedResumeServer.url),
})
  .send({ request: { type: "messages", messages: [] } })
  [Symbol.asyncIterator]();
const firstStart = await firstIterator.next();
const firstEvent = await firstIterator.next();
assert.equal(firstStart.value.type, "stream_start");
assert.equal(firstEvent.value.event.type, "run_start");
assert.equal(firstEvent.value.eventId, 1);
// Sever the first consumer while the producer is parked on its gate; packed
// server drain must keep producing into the store without a reader attached.
await firstIterator.return?.();
const resumeTransport = createHttpClientTransport({
  endpoint: new URL("/resume", packedResumeServer.url),
});
const resumePromise = (async () => {
  const frames = [];
  for await (const frame of resumeTransport.send({
    request: {
      type: "messages",
      messages: [],
      resume: { streamId: "packed-resume", after: 1 },
    },
  })) {
    frames.push(frame);
  }
  return frames;
})();
releasePackedProducer?.();
const resumedFrames = await bounded(resumePromise, "packed resumable reconnect");
packedResumeServer.stop(true);
assert.deepEqual(
  resumedFrames.map((frame) => frame.type),
  ["stream_start", "stream_event", "stream_end"],
);
assert.equal(resumedFrames[0].streamId, "packed-resume");
assert.equal(resumedFrames[0].resumable, true);
assert.equal(resumedFrames[1].eventId, 2);
assert.deepEqual(resumedFrames[1].event, {
  type: "run_end",
  runId: "packed-resume",
  status: "completed",
});
assert.equal(resumedFrames[2].streamId, "packed-resume");
assert.equal(resumedFrames[2].eventId, 2);
assert.equal(resumedFrames[2].status, "completed");

function bounded(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for " + label)), 10_000);
    }),
  ]);
}

const model = new OpenAIClient({
  client: {
    chat: {
      completions: {
        async create() {
          return {
            choices: [
              {
                message: { role: "assistant", content: "packed packages work" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
          };
        },
      },
    },
  },
}).completionModel({ modelId: "gpt-4o-mini", api: "chat" });

const agent = new Agent({ id: "packed-bun-consumer", model });
const result = await agent.generate({ prompt: "hello" });
assert.equal(result.output, "packed packages work");
assert.equal(result.usage.totalTokens, 4);

console.log("Packed Core, Client, Server, OpenAI, and MCP artifacts work under Bun.");
`;
}

function consumerTsconfig() {
  return {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM"],
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
    include: ["consumer.ts"],
  };
}

// Type-only consumer: every entrypoint is referenced by name so its installed
// declaration file must resolve, and the calls mirror the runtime smoke so the
// signatures have to accept the same usage a real consumer would write.
function consumerSource() {
  return `
import { Agent } from "@anvia/core";
import { createHttpClientTransport, parseClientStreamRequest } from "@anvia/client";
import { readJsonlStream } from "@anvia/client/transport";
import { chunkText } from "@anvia/core/documents";
import { toReadableStream } from "@anvia/core/streaming";
import { McpClient } from "@anvia/mcp";
import { SqliteMemoryClient } from "@anvia/memory-sqlite";
import { OpenAIClient } from "@anvia/openai";
import {
  createClientStreamResponse,
  createMemoryResumableStreamStore,
  createResumableStream,
  resumeClientStreamResponse,
} from "@anvia/server";

const agentCtor: typeof Agent = Agent;
const transportFactory: typeof createHttpClientTransport = createHttpClientTransport;
const jsonlReader: typeof readJsonlStream = readJsonlStream;
const requestParser: typeof parseClientStreamRequest = parseClientStreamRequest;
const chunker: typeof chunkText = chunkText;
const streamAdapter: typeof toReadableStream = toReadableStream;
const mcpClientCtor: typeof McpClient = McpClient;
const openaiClientCtor: typeof OpenAIClient = OpenAIClient;
const clientStreamResponse: typeof createClientStreamResponse = createClientStreamResponse;
const memoryStoreFactory: typeof createMemoryResumableStreamStore = createMemoryResumableStreamStore;
const resumableFactory: typeof createResumableStream = createResumableStream;
const resumeResponse: typeof resumeClientStreamResponse = resumeClientStreamResponse;

const mcpClient = new McpClient({
  name: "packed-typed",
  transport: {
    type: "custom",
    create() {
      throw new Error("Not connected during the type-only consumer check");
    },
  },
});
const mcpName: string = mcpClient.name;

const stream = toReadableStream(
  (async function* () {
    yield { type: "text_delta", delta: "typed consumer" };
  })(),
);
const store = createMemoryResumableStreamStore();

const memoryClientCtor: typeof SqliteMemoryClient = SqliteMemoryClient;
const typedMemoryClient = new SqliteMemoryClient({ path: ":memory:" });
const typedMemoryStore = typedMemoryClient.memoryStore();
// Type-only injection proof: a real bun:sqlite Database must be assignable to
// the structural driver surface without any consumer-side cast.
declare const typedBunDatabase: import("bun:sqlite").Database;
const typedInjectedClient = new SqliteMemoryClient({ database: typedBunDatabase });

console.log(
  agentCtor.name.length,
  transportFactory.name.length,
  requestParser.name.length,
  jsonlReader.name.length,
  chunker.name.length,
  streamAdapter.name.length,
  mcpClientCtor.name.length,
  openaiClientCtor.name.length,
  clientStreamResponse.name.length,
  resumeResponse.name.length,
  memoryStoreFactory.name.length,
  resumableFactory.name.length,
  memoryClientCtor.name.length,
  mcpName.length,
  stream !== undefined,
  store !== undefined,
  typedMemoryStore !== undefined,
  typedInjectedClient !== undefined,
);
`;
}
