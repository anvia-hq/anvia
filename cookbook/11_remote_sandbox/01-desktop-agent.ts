import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { RemoteSandboxHub } from "@anvia/sandbox/remote";
import {
  createDesktopAgent,
  defaultImage,
  defaultTask,
  failureMessage,
  sandboxId,
  startDesktopSandbox,
} from "./_support/desktop-sandbox";

// An agent that drives a real Linux desktop in a container, through screenshots and input tools.
//
// The container runs the reference image (pnpm cookbook:remote-sandbox:image). Its daemon dials
// OUT to the hub below, so the container needs no published ports. Nothing graphical starts until
// the agent first looks at the screen. For the same thing in a browser, where you can watch the
// desktop and take over, see 02-desktop-app.ts.
//
// Set ANVIA_DEMO_TAKEOVER=1 to have a "person" take control for 15 seconds as the agent starts its
// second action: its inputs fail (the error says who holds control), it waits, and carries on once
// control is handed back.
//
// Screenshots are saved to ./desktop-demo-out as it goes (and one at the end), so you can watch.

const outDir = "desktop-demo-out";
const task = process.env.ANVIA_DEMO_TASK ?? defaultTask; // Not argv: scripts get a dotenv arg there.
const takeover = process.env.ANVIA_DEMO_TAKEOVER === "1";

// The hub: where the sandbox's daemon connects. It authorizes the daemon by token.
const daemonToken = randomBytes(24).toString("base64url");
const hub = new RemoteSandboxHub({
  authorize: (token) => (token === daemonToken ? { sandboxId } : null),
  connectTimeoutMs: 120_000,
});
const { port } = await hub.listen({ host: "0.0.0.0", path: "/daemon" });

let snapshots: ReturnType<typeof setInterval> | undefined;
const timers: Array<ReturnType<typeof setTimeout>> = [];
let stopSandbox = async () => {};
const cleanup = async () => {
  clearInterval(snapshots);
  for (const timer of timers) clearTimeout(timer);
  await stopSandbox();
  await hub.close();
};
process.once("SIGINT", () => void cleanup().then(() => process.exit(130)));

try {
  console.log(`Waiting for the sandbox (image ${defaultImage})...`);
  const sandbox = await startDesktopSandbox({ hub, hubPort: port, daemonToken });
  stopSandbox = sandbox.stop;
  const { desktop } = sandbox;
  const status = await desktop.status();
  console.log(`Desktop running at ${status.width}x${status.height}.`);

  // Save a screenshot every few seconds so you can follow along.
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

  // Optionally act as the person who takes control, then hands it back. This happens as the agent
  // starts its second action, so the lock lands in the middle of the task however fast the model is.
  let toolCalls = 0;
  const personTakesControl = async () => {
    console.log("\n>>> A person takes control of the desktop for 15 seconds.\n");
    await desktop.takeover({ holder: "demo-human", leaseMs: 30_000 });
    timers.push(
      setTimeout(() => {
        console.log("\n>>> The person hands control back.\n");
        void desktop.release({ holder: "demo-human" });
      }, 15_000),
    );
  };

  const agent = createDesktopAgent({
    desktop,
    lifecycle: {
      async onToolStart({ toolName, input }) {
        console.log(
          `  → ${toolName}`,
          toolName === "desktop_screenshot" ? "" : JSON.stringify(input),
        );
        if (takeover && (toolCalls += 1) === 2) await personTakesControl();
      },
      onToolFinish(event) {
        if (!event.success)
          console.log(`  ✗ ${event.toolName} failed: ${failureMessage(event.error)}`);
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
