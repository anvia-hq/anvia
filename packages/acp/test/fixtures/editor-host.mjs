import { Console } from "node:console";
import { Writable } from "node:stream";
import { serveStdio } from "../../dist/stdio.js";

// Library hosts own logging policy. Keep protocol stdout separate before importing the factory.
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
const { sessionFactory } = await import("./conformance-agent.mjs");
const connection = serveStdio({
  sessionFactory,
  editorTools: { readTextFile: true, terminal: true },
  output: new Writable({
    write(chunk, encoding, callback) {
      write(chunk, encoding, callback);
    },
  }),
});
await connection.closed;
