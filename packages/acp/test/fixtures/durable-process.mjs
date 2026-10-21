// Offline crash fixture. IPC is test control; stdout remains protocol-only.
import { Agent } from "@anvia/core/agent";
import { Usage } from "@anvia/core/completion";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DurableRuntime } from "../../../durable/dist/index.js";
import { SqliteDurableStore } from "../../../durable/dist/sqlite.js";
import { FileAcpSessionStore } from "../../dist/index.js";
import { createDurableSessionBinding } from "../../dist/durable.js";
import { serveStdio } from "../../dist/stdio.js";

const [dir, mode, phase] = process.argv.slice(2);
const receipt = join(dir, "receipt.txt");
const response = (choice) => ({ choice, usage: Usage.empty(), rawResponse: {} });
const wait = () => new Promise(() => {});
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore(join(dir, "runtime.sqlite")),
});
const binding = createDurableSessionBinding(runtime, {
  version: "1",
  toolRecovery: mode === "idempotent" ? { write: "idempotent" } : {},
  agent: new Agent({
    id: "process-fixture",
    retries: false,
    model: {
      provider: "fixture",
      modelId: "offline",
      capabilities: {
        streaming: false,
        tools: true,
        toolChoice: true,
        imageInput: false,
        documentInput: false,
        outputSchema: false,
        reasoning: false,
      },
      async completion(request) {
        if (request.chatHistory.some((m) => m.role === "tool")) {
          if (phase === "start" && mode === "completed") {
            process.send({ checkpoint: true });
            await wait();
          }
          return response([{ type: "text", text: "done" }]);
        }
        return response([
          { type: "tool-call", toolName: "write", toolCallId: "write-1", input: {} },
        ]);
      },
    },
    tools: [
      {
        name: "write",
        requiresApproval: mode === "approval",
        definition: () => ({ name: "write", description: "Write", parameters: { type: "object" } }),
        async call(_input, context) {
          await appendFile(join(dir, "attempts.txt"), context.operationId + "\n");
          // Simulate a service that deduplicates the stable operation ID across a crash.
          if (mode === "idempotent") {
            const recorded = await readFile(receipt, "utf8").catch((error) => {
              if (error.code === "ENOENT") return "";
              throw error;
            });
            if (recorded.trim() === context.operationId) return "receipt";
          }
          await appendFile(receipt, context.operationId + "\n");
          if (phase === "start" && (mode === "ambiguous" || mode === "idempotent")) {
            process.send({ checkpoint: true });
            await wait();
          }
          return "receipt";
        },
      },
    ],
  }),
});
await runtime.resume();
// Reconciliation is a privileged host operation, never an ACP permission grant.
process.on("message", async (message) => {
  if (message !== "reconcile") return;
  const { runs } = await runtime.listRuns();
  const run = await runtime.getRun(runs[0].id);
  const snapshot = await run.snapshot();
  const lines = (await readFile(receipt, "utf8")).trim().split("\n");
  if (lines.length !== 1 || !snapshot.run.blockedOperation)
    throw new Error("Invalid fixture receipt");
  await run.resolveTool(snapshot.run.blockedOperation, { type: "text", value: "receipt" });
  process.send({ reconciled: true });
});
const connection = serveStdio({
  sessionFactory: () => binding,
  sessionStore: new FileAcpSessionStore(join(dir, "sessions.json")),
});
await connection.closed;
await runtime.close();
process.disconnect();
