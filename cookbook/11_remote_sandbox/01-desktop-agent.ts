import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { AnthropicClient } from "@anvia/anthropic";
import { Agent } from "@anvia/core/agent";
import { createDesktopTools } from "@anvia/sandbox";
import { RemoteSandboxHub } from "@anvia/sandbox/remote";

// An agent that drives a real Linux desktop in a container, through screenshots and input tools.
//
// The container runs the reference image (pnpm --filter cookbook remote-sandbox:image). Its daemon
// dials OUT to the hub below, so the container needs no published ports. Nothing graphical starts
// until the agent first looks at the screen.
//
// Set ANVIA_DEMO_TAKEOVER=1 to have a "person" take control for a while mid-run: the agent's inputs
// fail (the error says who holds control), it waits, and carries on once control is handed back.
//
// Screenshots are saved to ./desktop-demo-out as it goes (and one at the end), so you can watch.

const image = process.env.ANVIA_DESKTOP_IMAGE ?? "anvia-desktop";
const sandboxId = "desktop-demo";
const outDir = "desktop-demo-out";
// ANVIA_DEMO_TASK replaces the default task. (Not argv: every cookbook script receives a dotenv
// argument there.)
const task =
  process.env.ANVIA_DEMO_TASK ??
  "In the browser that is already open, go to https://example.com. Then tell me the page's " +
    "main heading and the first sentence of its paragraph.";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY (in the repo's .env, or the environment).");

// 1. The hub: where the sandbox's daemon connects. It authorizes the daemon by token.
const daemonToken = randomBytes(24).toString("base64url");
const hub = new RemoteSandboxHub({
  authorize: (token) => (token === daemonToken ? { sandboxId } : null),
  connectTimeoutMs: 120_000,
});
const { port } = await hub.listen({ host: "0.0.0.0", path: "/daemon" });

// 2. The sandbox: a container whose daemon connects to the hub. On Linux, host.docker.internal
//    needs the host-gateway mapping; Docker Desktop provides it already and accepts the flag.
const containerName = `anvia-${sandboxId}-${process.pid}`;
const container = spawn(
  "docker",
  [
    "run",
    "--rm",
    `--name=${containerName}`,
    "--add-host=host.docker.internal:host-gateway",
    `--env=ANVIA_CONTROL_URL=ws://host.docker.internal:${port}/daemon`,
    `--env=ANVIA_SANDBOX_TOKEN=${daemonToken}`,
    image,
  ],
  { stdio: ["ignore", "ignore", process.env.ANVIA_DEMO_VERBOSE ? "inherit" : "ignore"] },
);

let snapshots: ReturnType<typeof setInterval> | undefined;
const timers: Array<ReturnType<typeof setTimeout>> = [];
const cleanup = async () => {
  clearInterval(snapshots);
  for (const timer of timers) clearTimeout(timer);
  spawn("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  container.kill();
  await hub.close();
};
process.once("SIGINT", () => void cleanup().then(() => process.exit(130)));

try {
  const desktop = hub.desktop(sandboxId);
  const runtime = hub.runtime(sandboxId);

  // 3. Start the desktop and open a browser on it. (The hub waits for the daemon to connect.)
  console.log(`Waiting for the sandbox (image ${image})...`);
  const status = await desktop.start();
  console.log(`Desktop running at ${status.width}x${status.height}.`);
  await runtime.startProcess({
    command: "anvia-chromium",
    args: [
      "--window-position=0,0",
      `--window-size=${status.width},${status.height}`,
      "about:blank",
    ],
    env: { DISPLAY: status.display, HOME: "/home/node" },
  });

  // 4. Save a screenshot every few seconds so you can follow along.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  let frame = 0;
  const saveFrame = (name = String(frame++).padStart(3, "0")) =>
    desktop
      .screenshot()
      .then((shot) => writeFile(`${outDir}/${name}.png`, shot.png))
      .catch(() => undefined);
  await saveFrame();
  snapshots = setInterval(() => void saveFrame(), 3_000);

  // 5. Optionally act as the person who takes control, then hands it back.
  if (process.env.ANVIA_DEMO_TAKEOVER === "1") {
    timers.push(
      setTimeout(async () => {
        console.log("\n>>> A person takes control of the desktop for 20 seconds.\n");
        await desktop.takeover({ holder: "demo-human", leaseMs: 20_000 });
      }, 25_000),
      setTimeout(async () => {
        console.log("\n>>> The person hands control back.\n");
        await desktop.release({ holder: "demo-human" });
      }, 45_000),
    );
  }

  // 6. The agent: the desktop tools, and instructions on how to use them.
  const client = new AnthropicClient({ apiKey, baseUrl: process.env.ANTHROPIC_BASEURL });
  const agent = new Agent({
    id: "desktop-agent",
    model: client.completionModel({
      modelId: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    }),
    instructions: [
      "You operate a Linux desktop through screenshots and input tools.",
      "Take a screenshot before you act, and again after anything that changes the screen.",
      "Coordinates are pixels of the most recent screenshot, from its top-left corner.",
      "To open a URL in the browser: press ctrl+l, type the address, press Return, wait a few " +
        "seconds, then take a screenshot.",
      "If an input fails saying the desktop is controlled by someone else, a person has taken " +
        "control. Do not keep trying: wait with desktop_wait, then take a screenshot and try again.",
      "When you have the answer, reply with it plainly.",
    ].join("\n"),
    maxTurns: 40,
    tools: createDesktopTools({ sandbox: desktop }),
    lifecycle: {
      onToolStart({ toolName, input }) {
        console.log(
          `  → ${toolName}`,
          toolName === "desktop_screenshot" ? "" : JSON.stringify(input),
        );
      },
      onToolFinish(event) {
        if (!event.success) {
          const reason = event.error instanceof Error ? event.error.message : String(event.error);
          console.log(`  ✗ ${event.toolName} failed: ${reason}`);
        }
      },
    },
  });

  console.log(`\nTask: ${task}\n`);
  const response = await agent.generate({ prompt: task });
  if (response.type !== "response") throw new Error("Unexpected tool approval request.");
  console.log(`\nAnswer: ${response.output}`);
  await saveFrame("final");
  console.log(`Screenshots are in ./${outDir} (final.png is where the agent ended up).`);
} finally {
  await cleanup();
  process.exit(process.exitCode ?? 0);
}
