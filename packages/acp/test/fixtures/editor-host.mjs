import { Console } from "node:console";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { serveStdio } from "../../dist/stdio.js";

// Library hosts own logging policy. Keep protocol stdout separate before importing the factory.
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
const { sessionFactory } = await import("./conformance-agent.mjs");
const connection = serveStdio({
  sessionFactory,
  editorTools: { readTextFile: true, terminal: true },
  mcp: {
    stdio: true,
    authorizeServer: (server) =>
      server.type === "stdio" &&
      server.name === "waiting-mcp" &&
      server.command === process.execPath &&
      server.args.length === 1 &&
      server.args[0] === fileURLToPath(new URL("./mcp-server.mjs", import.meta.url)) &&
      Object.keys(server.env).every((name) => ["FIXTURE_LOG", "FIXTURE_MODE"].includes(name)),
  },
  output: new Writable({
    write(chunk, encoding, callback) {
      write(chunk, encoding, callback);
    },
  }),
});
await connection.closed;
