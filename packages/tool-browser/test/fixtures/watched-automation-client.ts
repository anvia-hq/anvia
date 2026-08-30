import type { ChildProcess } from "node:child_process";
import { AutomationWorkerClient, spawnAutomationWorker } from "../../src/automation-client";

const workerUrl = new URL("./successful-automation-worker.mjs", import.meta.url);
const children: ChildProcess[] = [];

for (let cycle = 0; cycle < 3; cycle += 1) {
  const controller = new AbortController();
  const client = await AutomationWorkerClient.connect({
    endpointUrl: "http://127.0.0.1:9222",
    timeoutMs: 2_000,
    abortSignal: controller.signal,
    workerFactory: () => {
      const child = spawnAutomationWorker(workerUrl);
      children.push(child);
      return child;
    },
  });
  await client.disconnect({ abortSignal: controller.signal });
}

const cleaned = children.every(
  (child) =>
    (child.exitCode !== null || child.signalCode !== null) &&
    child.listenerCount("message") === 0 &&
    child.listenerCount("error") === 0 &&
    child.listenerCount("exit") === 0 &&
    (child.stderr?.listenerCount("data") ?? 0) === 0 &&
    (child.stderr?.listenerCount("error") ?? 0) === 0,
);

process.stdout.write(`${JSON.stringify({ automationWorkerRegression: true, cleaned })}\n`);
if (!cleaned) process.exitCode = 1;
