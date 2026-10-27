// A remote sandbox with a desktop, inside Studio: the Sandboxes page lists its files and processes,
// and the Playground opens a live desktop panel when the agent calls one of its tools, where you can
// watch it and take control. Studio and the hub run in this one process.
//
// Start a desktop sandbox that dials this hub (see docs/packages/tool-sandbox.md for the image):
//
//   docker build -t my-desktop-sandbox packages/tool-sandbox/images/desktop
//   docker run --rm -e ANVIA_CONTROL_URL=ws://host.docker.internal:8787/daemon \
//     -e ANVIA_SANDBOX_TOKEN=local-dev-token my-desktop-sandbox
import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";
import { createDesktopTools, createSandboxTools } from "@anvia/sandbox";
import { RemoteSandboxHub, studioSandbox } from "@anvia/sandbox/remote";
import { Studio } from "@anvia/studio";

const studioPort = Number(process.env.RUNNER_PORT ?? 4021);
const hubPort = Number(process.env.SANDBOX_HUB_PORT ?? 8787);
const token = process.env.ANVIA_SANDBOX_TOKEN ?? "local-dev-token";
const sandboxId = "desktop-1";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const hub = new RemoteSandboxHub({
  authorize: (candidate) => (candidate === token ? { sandboxId } : null),
  connectTimeoutMs: 60_000,
});
await hub.listen({ host: "0.0.0.0", port: hubPort, path: "/daemon" });

const tools = [
  ...createDesktopTools({ sandbox: hub.desktop(sandboxId) }),
  ...createSandboxTools({
    sandbox: hub.runtime(sandboxId, { workdir: "/workspace" }),
    tools: ["exec_command", "read_file", "list_files"],
  }),
];

const agent = new Agent({
  id: "desktop-operator",
  model: client.completionModel({ modelId: "gpt-5.6-luna", api: "responses" }),
  name: "Desktop Operator",
  description: "Looks at and drives a remote sandbox's desktop.",
  instructions: [
    "Take a screenshot before acting, and again after to check what happened.",
    "If a desktop action fails because a person has taken control, wait and look instead of retrying.",
  ].join("\n"),
  maxTurns: 12,
  tools,
});

const studio = new Studio([agent], {
  sandboxes: [
    studioSandbox(hub, sandboxId, {
      agentIds: [agent.id],
      toolNames: tools.map((tool) => tool.name),
    }),
  ],
  quickPrompts: {
    "desktop-operator": [
      "Take a screenshot and describe what is on the desktop.",
      "Open a terminal from the desktop and run `uname -a`.",
    ],
  },
});

console.log(`Sandbox hub: ws://localhost:${hubPort}/daemon (token: ${token})`);
console.log(`Studio Playground: http://localhost:${studioPort}/playground`);
console.log(`Sandbox inspector: http://localhost:${studioPort}/sandboxes`);

await studio.serve({
  port: studioPort,
  log: false,
  onShutdown: async () => {
    await hub.close();
  },
});
