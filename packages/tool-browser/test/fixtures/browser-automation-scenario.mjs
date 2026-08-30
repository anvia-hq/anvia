import { DockerBrowserClient } from "../../dist/index.js";

const endpoint = new URL(requiredEnvironment("ANVIA_BROWSER_REPRO_ENDPOINT"));
const cycles = Number(process.env.ANVIA_BROWSER_REPRO_CYCLES ?? "3");
const lingerMs = Number(process.env.ANVIA_BROWSER_REPRO_LINGER_MS ?? "0");
const probeReadiness = process.env.ANVIA_BROWSER_REPRO_READINESS === "1";
const sandbox = fakeSandbox(endpoint);
const browserClient = new DockerBrowserClient({
  image: "browser-automation-reproduction",
  sandboxClient: {
    pullImage: async () => undefined,
    createSandbox: async () => sandbox,
    resumeSandbox: async () => sandbox,
  },
});
const browser = await browserClient.resumeBrowser({ id: sandbox.id });
const keepAlive = setInterval(() => undefined, 60_000);

try {
  if (probeReadiness) {
    await browser.waitForCapabilities({
      capabilities: ["automation"],
      timeoutMs: 5_000,
      abortSignal: new AbortController().signal,
    });
  }
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    const requestController = new AbortController();
    const connection = await browser.connect({
      timeoutMs: 5_000,
      scheduling: { mode: "per-tab", maxConcurrentTabs: 8, maxQueuedActions: 100 },
      abortSignal: requestController.signal,
    });
    await connection.disconnect();
    process.stdout.write(`${JSON.stringify({ cycle, connected: true })}\n`);
    if (lingerMs > 0) await new Promise((resolve) => setTimeout(resolve, lingerMs));
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify({ connected: false, error: summarizeError(error) })}\n`);
  process.exitCode = 1;
} finally {
  clearInterval(keepAlive);
  await browser.destroy().catch(() => undefined);
}

function fakeSandbox(endpointUrl) {
  return {
    id: "browser-automation-reproduction",
    state: "running",
    runtime: {
      publishedPorts: [
        {
          containerPort: 9222,
          host: endpointUrl.hostname,
          hostPort: Number(endpointUrl.port),
          protocol: "tcp",
        },
      ],
      waitForPort: async () => undefined,
      exec: async () => ({
        status: "exited",
        exitCode: 0,
        stdout: new TextEncoder().encode("1\n"),
        stderr: new Uint8Array(),
      }),
      startProcess: async () => ({ id: "browser-service" }),
    },
    inspector: () => ({}),
    stop: async () => undefined,
    destroy: async () => undefined,
  };
}

function summarizeError(value, depth = 0) {
  if (!(value instanceof Error) || depth >= 5) return { type: typeof value };
  return {
    name: value.name,
    code: typeof value.code === "string" ? value.code : undefined,
    phase: typeof value.phase === "string" ? value.phase : undefined,
    responseSummary: value.responseSummary,
    cause: summarizeError(value.cause, depth + 1),
  };
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined) throw new Error(`Missing ${name}.`);
  return value;
}
