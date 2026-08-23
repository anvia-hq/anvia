import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";
import { createDockerSandboxTools, DockerSandboxClient } from "@anvia/sandbox";
import { Studio } from "@anvia/studio";

const studioPort = Number(process.env.RUNNER_PORT ?? 4021);
const previewPort = 3000;

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const sandboxClient = new DockerSandboxClient();
await sandboxClient.pullImage({ image: "node:22-bookworm" });
const sandbox = await sandboxClient.createSandbox({
  image: "node:22-bookworm",
  workspace: { type: "ephemeral" },
  network: { mode: "bridge", ports: [previewPort] },
  runtime: {
    commandTimeoutMs: 30_000,
    maxOutputBytes: 128_000,
    maxFileBytes: 1024 * 1024,
    maxProcesses: 4,
  },
  directories: ["notes"],
  files: {
    "README.md": [
      "# Sandbox Studio Preview",
      "",
      "This workspace runs a tiny Node.js preview server.",
      "Edit `src/message.txt` to change the response without restarting the process.",
    ].join("\n"),
    "package.json": JSON.stringify(
      {
        name: "sandbox-studio-preview",
        private: true,
        type: "module",
        scripts: { start: "node server.js" },
      },
      null,
      2,
    ),
    "server.js": [
      'import { readFile } from "node:fs/promises";',
      'import { createServer } from "node:http";',
      "",
      "const server = createServer(async (_request, response) => {",
      '  const message = await readFile(new URL("./src/message.txt", import.meta.url), "utf8");',
      '  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });',
      "  response.end(message);",
      "});",
      "",
      `server.listen(${previewPort}, "0.0.0.0", () => {`,
      `  console.log("Sandbox preview listening on ${previewPort}");`,
      "});",
    ].join("\n"),
    "src/message.txt": "Hello from the live Anvia sandbox.\n",
  },
});

try {
  const previewProcess = await sandbox.runtime.startProcess({
    command: "node",
    args: ["server.js"],
  });
  const publishedPreview = await sandbox.runtime.waitForPort({
    containerPort: previewPort,
    timeoutMs: 10_000,
  });

  const tools = createDockerSandboxTools({
    sandbox: sandbox.runtime,
    tools: [
      "exec_command",
      "read_file",
      "write_file",
      "list_files",
      "list_ports",
      "list_processes",
      "read_process_logs",
    ],
    exec: {
      commands: { mode: "allow", values: ["node"] },
      maxTimeoutMs: 30_000,
    },
    readFile: { maxBytes: 128_000 },
    writeFile: { maxBytes: 128_000 },
    process: { maxLogBytes: 64_000 },
  });

  const model = client.completionModel({ modelId: "gpt-5.6-luna", api: "responses" });
  const agent = new Agent({
    id: "studio-sandbox-builder",
    model: model,
    name: "Sandbox Builder",
    description: "Inspects and edits a live Docker sandbox workspace from Studio.",
    instructions: [
      "Work only through the provided sandbox tools.",
      "Inspect existing files before changing them.",
      "Keep the preview process running; do not replace it with a foreground command.",
      "After a change, verify the relevant file or command output and summarize what changed.",
    ].join("\n"),
    maxTurns: 8,
    tools: [...tools],
  });

  const studio = new Studio([agent], {
    sandboxes: [
      {
        inspector: sandbox.inspector({ files: true, ports: true, processes: true }),
        agentIds: ["studio-sandbox-builder"],
        toolNames: tools.map((tool) => tool.name),
      },
    ],
    quickPrompts: {
      "studio-sandbox-builder": [
        "Inspect the sandbox workspace and explain how the preview server works.",
        "Change src/message.txt to a short launch message, then verify the file.",
        "Show the published port and the latest preview process logs.",
      ],
    },
  });

  console.log(`Studio Playground: http://localhost:${studioPort}/playground`);
  console.log(`Sandbox inspector: http://localhost:${studioPort}/sandboxes`);
  console.log(
    `Sandbox preview: http://${publishedPreview.host}:${publishedPreview.hostPort} (${previewProcess.id})`,
  );
  console.log("Press Ctrl+C to close Studio and remove the ephemeral sandbox.");

  await studio.serve({
    port: studioPort,
    log: false,
    onShutdown: async () => {
      console.log(`Removing sandbox ${sandbox.id}...`);
      await sandbox.destroy();
    },
  });
} catch (error) {
  await sandbox.destroy().catch(() => undefined);
  throw error;
}
