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

const outDir = "desktop-demo-out";
const task = process.env.ANVIA_DEMO_TASK ?? defaultTask;
const takeover = process.env.ANVIA_DEMO_TAKEOVER === "1";

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
    ...sandbox,
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
