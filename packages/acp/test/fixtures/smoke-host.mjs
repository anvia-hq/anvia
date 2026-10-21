import { Console } from "node:console";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { serveStdio } from "../../dist/stdio.js";

const write = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
const { sessionFactory } = await import("../../examples/editor-smoke-agent.mjs");
const connection = serveStdio({
  sessionFactory,
  mcp: {
    stdio: true,
    authorizeServer: (server) =>
      server.type === "stdio" &&
      server.name === "anvia-smoke" &&
      server.command === process.execPath &&
      server.args.length === 1 &&
      server.args[0] ===
        fileURLToPath(new URL("../../examples/editor-smoke-mcp.mjs", import.meta.url)) &&
      Object.keys(server.env).length === 0,
  },
  output: new Writable({
    write(chunk, encoding, callback) {
      write(chunk, encoding, callback);
    },
  }),
});
await connection.closed;
