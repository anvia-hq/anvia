import { createInterface } from "node:readline";

// Disposable stdio MCP server; legacy negotiation deliberately exercises ACP's fallback.
// No filesystem, shell, network, credentials or transcript logging.
let calls = 0;
process.on("SIGTERM", () => process.exit(0));
createInterface({ input: process.stdin })
  .on("close", () => process.exit(0))
  .on("line", (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }
    if (request?.id === undefined) return;
    let result;
    if (request.method === "initialize") {
      result = {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "anvia-smoke", version: "1.0.0" },
      };
    } else if (request.method === "tools/list") {
      result = {
        tools: [
          {
            name: "smoke_ping",
            description: "Return a deterministic marker and process-local call count.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
      };
    } else if (request.method === "tools/call" && request.params?.name === "smoke_ping") {
      result = { content: [{ type: "text", text: `ACP_MCP_SMOKE_OK calls=${++calls}` }] };
    } else if (request.method === "ping") {
      result = {};
    }
    const response = { jsonrpc: "2.0", id: request.id };
    if (result) response.result = result;
    else response.error = { code: -32601, message: "Unsupported smoke method" };
    process.stdout.write(JSON.stringify(response) + "\n");
  });
