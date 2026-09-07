import { writeFileSync } from "node:fs";

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim() === "") continue;
    respond(JSON.parse(line));
  }
});

process.on("SIGTERM", () => {
  const exitMarkerPath = process.env.MCP_SLOW_EXIT;
  if (exitMarkerPath) writeFileSync(exitMarkerPath, "");
  process.exit(143);
});

function respond(message) {
  if (message.method === "tools/call") {
    const receiptPath = process.env.MCP_SLOW_RECEIPT;
    if (receiptPath) writeFileSync(receiptPath, JSON.stringify({ pid: process.pid }));
    setTimeout(() => {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            resultType: "complete",
            ttlMs: 0,
            cacheScope: "private",
            content: [{ type: "text", text: "slow-echo" }],
          },
        })}\n`,
      );
    }, 10_000);
    return;
  }

  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: resultFor(message) })}\n`,
  );
}

function resultFor(message) {
  if (message.method === "server/discover") {
    return {
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {} },
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "bun-stdio-slow-fixture",
          version: "1.0.0",
        },
      },
    };
  }
  if (message.method === "tools/list") {
    return {
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "public",
      tools: [
        {
          name: "echo",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
      ],
    };
  }
  return {};
}
