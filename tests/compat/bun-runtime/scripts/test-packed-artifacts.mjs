import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "anvia-bun-packed-"));
const packsDirectory = join(temporaryRoot, "packs");
const consumerDirectory = join(temporaryRoot, "consumer");

try {
  await mkdir(packsDirectory);
  await mkdir(consumerDirectory);
  await run("pnpm", ["pack", "--pack-destination", packsDirectory], {
    cwd: join(repositoryRoot, "packages/core"),
  });
  await run("pnpm", ["pack", "--pack-destination", packsDirectory], {
    cwd: join(repositoryRoot, "packages/provider-openai"),
  });
  await run("pnpm", ["pack", "--pack-destination", packsDirectory], {
    cwd: join(repositoryRoot, "packages/mcp"),
  });

  const archives = await readdir(packsDirectory);
  const coreArchive = requireArchive(archives, "anvia-core-");
  const openaiArchive = requireArchive(archives, "anvia-openai-");
  const mcpArchive = requireArchive(archives, "anvia-mcp-");
  await writeFile(
    join(consumerDirectory, "package.json"),
    JSON.stringify(
      {
        name: "anvia-bun-packed-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@anvia/core": `file:${join(packsDirectory, coreArchive)}`,
          "@anvia/mcp": `file:${join(packsDirectory, mcpArchive)}`,
          "@anvia/openai": `file:${join(packsDirectory, openaiArchive)}`,
        },
      },
      undefined,
      2,
    ),
  );
  await writeFile(join(consumerDirectory, "smoke.mjs"), smokeTestSource());

  await run("bun", ["install", "--ignore-scripts"], { cwd: consumerDirectory });
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
import assert from "node:assert/strict";
import { Agent } from "@anvia/core";
import { extractPdfText } from "@anvia/core/documents";
import { toReadableStream } from "@anvia/core/streaming";
import { McpClient } from "@anvia/mcp";
import { OpenAIClient } from "@anvia/openai";

assert.equal(typeof Agent, "function");
assert.equal(typeof extractPdfText, "function");
assert.equal(typeof toReadableStream, "function");
assert.equal(typeof McpClient, "function");

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

console.log("Packed @anvia/core, @anvia/openai, and @anvia/mcp artifacts work under Bun.");
`;
}
