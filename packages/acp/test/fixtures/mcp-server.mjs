import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

function log(value) {
  appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ pid: process.pid, ...value }) + "\n");
}
log({
  event: "start",
  cwd: process.cwd(),
  args: process.argv.slice(2),
  supplied: process.env.FIXTURE_VALUE,
  inheritedSecret: process.env.ACP_TEST_PROVIDER_SECRET ?? null,
});
process.on("exit", () => log({ event: "exit" }));
process.on("SIGTERM", () => process.exit(0));
createInterface({ input: process.stdin })
  .on("close", () => process.exit(0))
  .on("line", (line) => {
    const request = JSON.parse(line);
    log({ event: request.method });
    if (request.id === undefined) return;
    let result;
    if (request.method === "server/discover") {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "Legacy fixture" },
        }) + "\n",
      );
      return;
    }
    if (request.method === "initialize") {
      if (process.env.FIXTURE_MODE === "initialize-fail") {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32603, message: "Private initialization failure" },
          }) + "\n",
        );
        return;
      }
      result = {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    } else if (request.method === "tools/list") {
      if (process.env.FIXTURE_MODE === "hang") return;
      if (process.env.FIXTURE_MODE === "fail") {
        setTimeout(
          () =>
            process.stdout.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: request.id,
                error: { code: -32603, message: "private fixture failure" },
              }) + "\n",
            ),
          150,
        );
        return;
      }
      const tool = {
        name: "echo",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      };
      result = { tools: process.env.FIXTURE_MODE === "duplicate" ? [tool, tool] : [tool] };
    } else if (request.method === "tools/call") {
      result = { content: [{ type: "text", text: "fixture result" }] };
    } else {
      result = {};
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  });
