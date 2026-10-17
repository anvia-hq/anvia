import { Console } from "node:console";
import { Writable } from "node:stream";
import { FileAcpSessionStore } from "../../dist/index.js";
import { serveStdio } from "../../dist/stdio.js";

const write = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
const { sessionFactory } = await import("./conformance-agent.mjs");
const connection = serveStdio({
  sessionFactory,
  sessionStore: new FileAcpSessionStore(process.argv[2]),
  editorTools: { terminal: true },
  output: new Writable({
    write(chunk, encoding, callback) {
      write(chunk, encoding, callback);
    },
  }),
});
await connection.closed;
