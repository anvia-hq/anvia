import { createBrowserTools, DockerBrowserClient } from "@anvia/browser";
import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";
import { DockerSandboxClient } from "@anvia/sandbox";
import { Studio } from "@anvia/studio";

const image = requiredEnvironment("ANVIA_BROWSER_IMAGE");
const password = requiredEnvironment("ANVIA_BROWSER_VNC_PASSWORD");
const studioPort = Number(process.env.RUNNER_PORT ?? 4021);

const sandboxClient = new DockerSandboxClient();
const browserClient = new DockerBrowserClient({ sandboxClient, image });
const browser = await browserClient.createBrowser({
  id: "studio-browser",
  workspace: { type: "ephemeral" },
  network: { mode: "bridge" },
  desktop: {
    protocol: "novnc",
    password,
    viewport: { width: 1440, height: 900 },
  },
  resources: { memoryMb: 2048, cpus: 2, pidsLimit: 512, sharedMemoryMb: 1024 },
});

try {
  await browser.waitForCapabilities({
    capabilities: ["automation", "desktop"],
    timeoutMs: 30_000,
  });
  const connection = await browser.connect({
    timeoutMs: 30_000,
    scheduling: { mode: "per-tab", maxConcurrentTabs: 8 },
  });
  const browserTools = createBrowserTools({
    connection,
    tools: [
      "browser_list_tabs",
      "browser_open_tab",
      "browser_select_tab",
      "browser_close_tab",
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_press_key",
      "browser_screenshot",
    ],
    navigation: { mode: "allow-all-http" },
  });

  const openai = new OpenAIClient({
    baseUrl: process.env.OPENAI_BASEURL,
    apiKey: process.env.OPENAI_API_KEY ?? "",
  });
  const agent = new Agent({
    id: "studio-browser-agent",
    name: "Browser Agent",
    model: openai.completionModel({ modelId: "gpt-5.6-luna", api: "chat" }),
    instructions: "Use browser snapshots before browser interactions and report verified results.",
    tools: browserTools,
    maxTurns: 12,
  });

  const studio = new Studio([agent], {
    sandboxes: [
      {
        inspector: browser.inspector({ files: true, ports: true, processes: true }),
        agentIds: [agent.id],
        toolNames: browserTools.map((tool) => tool.name),
        views: [
          {
            id: "desktop",
            label: "Chromium",
            source: browser.desktop,
            access: { mode: "local" },
            authentication: { type: "password", password },
          },
        ],
      },
    ],
  });

  console.log(`Studio browser desktop: http://localhost:${studioPort}/ui/sandboxes`);
  console.log("Run a browser task in Playground to open the live desktop panel automatically.");
  console.log("Press Take control to pause agent browser tools while interacting manually.");

  await studio.serve({
    port: studioPort,
    log: false,
    onShutdown: async () => {
      await connection.disconnect();
      await browser.destroy();
    },
  });
} catch (error) {
  await browser.destroy().catch(() => undefined);
  throw error;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}
