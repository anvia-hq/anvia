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

function respond(message) {
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
          name: "bun-stdio-fixture",
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
  if (message.method === "tools/call") {
    return {
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "private",
      content: [{ type: "text", text: `echo:${String(message.params?.arguments?.text ?? "")}` }],
    };
  }
  return {};
}
