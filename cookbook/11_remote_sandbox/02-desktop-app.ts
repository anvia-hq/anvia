import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { RemoteSandboxHub, relayTicket } from "@anvia/sandbox/remote";
import { build } from "esbuild";
import {
  createDesktopAgent,
  defaultImage,
  defaultTask,
  failureMessage,
  sandboxId,
  startDesktopSandbox,
} from "./_support/desktop-sandbox";

// A web app where you watch an agent use a real Linux desktop, and can take over.
//
//   pnpm cookbook:remote-sandbox:image    # once
//   pnpm cookbook:remote-sandbox:02       # then open http://localhost:4030
//
// One Node server does everything:
//   - the hub, where the container's daemon connects (/daemon),
//   - the desktop relay, which the browser's noVNC viewer connects to (/desktop),
//   - the page, bundled with esbuild at startup (needs `pnpm --filter @anvia/react-ui build`),
//   - a small API: mint a ticket, run the agent, stop it, and stream what it does.
//
// The browser never gets a long-lived credential. Each connection of the viewer asks /api/ticket
// for a single-use ticket, and the hub only lets the viewer in if it can redeem one. In a real app
// that endpoint is where you check that the signed-in user may see this sandbox.

const port = Number(process.env.PORT ?? 4030);
const daemonToken = randomBytes(24).toString("base64url");

// ---- tickets: single use, short lived ----------------------------------------------------------
const tickets = new Map<string, number>();
const mintTicket = () => {
  const ticket = randomBytes(24).toString("base64url");
  tickets.set(ticket, Date.now() + 30_000);
  return ticket;
};
const redeemTicket = (ticket: string | undefined) => {
  const expires = ticket === undefined ? undefined : tickets.get(ticket);
  if (ticket !== undefined) tickets.delete(ticket);
  return expires !== undefined && expires > Date.now();
};

// ---- the hub ----------------------------------------------------------------------------------
const hub = new RemoteSandboxHub({
  authorize: (token) => (token === daemonToken ? { sandboxId } : null),
  authorizeDesktop: (request) =>
    redeemTicket(relayTicket(request)) ? { sandboxId, holder: "you" } : null,
  connectTimeoutMs: 120_000,
});

// ---- what the agent does, streamed to the page -------------------------------------------------
type AppEvent =
  | { type: "sandbox"; state: "starting" | "ready" | "failed"; message?: string }
  | { type: "status"; state: "idle" | "running" }
  | { type: "reset" }
  | { type: "tool"; name: string; input?: unknown }
  | { type: "tool-error"; name: string; message: string }
  | { type: "text"; text: string }
  | { type: "answer"; text: string }
  | { type: "error"; message: string }
  | { type: "stopped" };

let events: AppEvent[] = [{ type: "sandbox", state: "starting" }];
const listeners = new Set<ServerResponse>();
const emit = (event: AppEvent) => {
  // A new run clears the log, but not what the page needs to know about the sandbox: without that,
  // a page loaded after a run would wait for a sandbox that is long since ready. Everything else is
  // kept so a page that connects late catches up.
  events =
    event.type === "reset"
      ? [...events.filter((kept) => kept.type === "sandbox"), event]
      : [...events, event];
  for (const response of listeners) response.write(`data: ${JSON.stringify(event)}\n\n`);
};

let sandbox: Awaited<ReturnType<typeof startDesktopSandbox>> | undefined;
let current: AbortController | undefined;

async function run(task: string): Promise<void> {
  if (sandbox === undefined) throw new Error("The sandbox is not ready yet.");
  const controller = new AbortController();
  current = controller;
  emit({ type: "reset" });
  emit({ type: "status", state: "running" });
  const agent = createDesktopAgent({
    ...sandbox,
    lifecycle: {
      onToolStart({ toolName, input }) {
        emit({
          type: "tool",
          name: toolName,
          input: toolName === "desktop_screenshot" ? undefined : input,
        });
      },
      onToolFinish(event) {
        if (!event.success) {
          emit({ type: "tool-error", name: event.toolName, message: failureMessage(event.error) });
        }
      },
      onStepFinish({ response }) {
        // Narration before a tool call. The last step's text is the answer, which has its own event.
        if (!response.choice.some((part) => part.type === "tool-call")) return;
        for (const part of response.choice) {
          if (part.type === "text" && part.text.trim() !== "")
            emit({ type: "text", text: part.text });
        }
      },
    },
  });
  try {
    const response = await agent.generate({ prompt: task, abortSignal: controller.signal });
    if (response.type === "response") emit({ type: "answer", text: response.output });
  } catch (error) {
    if (controller.signal.aborted) emit({ type: "stopped" });
    else emit({ type: "error", message: failureMessage(error) });
  } finally {
    current = undefined;
    emit({ type: "status", state: "idle" });
  }
}

// ---- the page ---------------------------------------------------------------------------------
const bundle = await build({
  entryPoints: [new URL("./_support/desktop-app/client.tsx", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  jsx: "automatic",
  write: false,
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"development"' },
});
const script = bundle.outputFiles[0]?.text ?? "";
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Anvia desktop agent</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0"><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;

const readJson = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  let body = "";
  for await (const chunk of request) body += chunk;
  try {
    return body === "" ? {} : (JSON.parse(body) as Record<string, unknown>);
  } catch {
    return {};
  }
};
const json = (response: ServerResponse, status: number, value: unknown) =>
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && path === "/") {
    response.writeHead(200, { "content-type": "text/html" }).end(html);
  } else if (request.method === "GET" && path === "/app.js") {
    response.writeHead(200, { "content-type": "text/javascript" }).end(script);
  } else if (request.method === "GET" && path === "/api/config") {
    json(response, 200, { task: process.env.ANVIA_DEMO_TASK ?? defaultTask });
  } else if (request.method === "POST" && path === "/api/ticket") {
    json(response, 200, { ticket: mintTicket() });
  } else if (request.method === "GET" && path === "/api/events") {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
    listeners.add(response);
    request.on("close", () => listeners.delete(response));
  } else if (request.method === "POST" && path === "/api/run") {
    const { task } = await readJson(request);
    if (sandbox === undefined)
      return json(response, 409, { error: "The sandbox is not ready yet." });
    if (current !== undefined)
      return json(response, 409, { error: "The agent is already running." });
    if (typeof task !== "string" || task.trim() === "")
      return json(response, 400, { error: "Give it a task." });
    void run(task);
    json(response, 202, { ok: true });
  } else if (request.method === "POST" && path === "/api/stop") {
    current?.abort();
    json(response, 200, { ok: true });
  } else {
    response.writeHead(404).end();
  }
});

// The container's daemon and the browser's viewer both upgrade to WebSockets on this one port.
server.on("upgrade", (request, socket, head) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/daemon") hub.handleUpgrade(request, socket, head);
  else if (path === "/desktop") hub.handleDesktopUpgrade(request, socket, head);
  else socket.destroy();
});
await new Promise<void>((resolve) => server.listen(port, "0.0.0.0", resolve));
console.log(`Open http://localhost:${port}  (starting the sandbox from image ${defaultImage}...)`);

let stopSandbox = async () => {};
const shutdown = async () => {
  current?.abort();
  for (const response of listeners) response.end();
  await stopSandbox();
  await hub.close();
  server.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  sandbox = await startDesktopSandbox({ hub, hubPort: port, daemonToken });
  stopSandbox = sandbox.stop;
  emit({ type: "sandbox", state: "ready" });
  emit({ type: "status", state: "idle" });
  console.log("Sandbox ready. Give the agent a task in the page, and try taking over.");
} catch (error) {
  emit({ type: "sandbox", state: "failed", message: failureMessage(error) });
  console.error(`The sandbox did not start: ${failureMessage(error)}`);
}
