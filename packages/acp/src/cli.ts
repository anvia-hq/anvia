#!/usr/bin/env node
import { Console } from "node:console";
import { Writable } from "node:stream";

// Reserve the original stdout writer before importing any application/provider code.
const protocolWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });

const output = new Writable({
  write(chunk, encoding, callback) {
    protocolWrite(chunk, encoding, callback);
  },
});

// The launcher owns this process, including handles created by imported provider modules.
// Drain output on shutdown, but do not let an unread pipe keep the process alive forever.
let exiting = false;
async function exit(code: number): Promise<void> {
  if (exiting) return;
  exiting = true;
  setTimeout(() => process.exit(code), 5_000).unref();
  await new Promise<void>((resolve) => output.end(() => resolve()));
  await new Promise<void>((resolve) => process.stderr.write("", () => resolve()));
  process.exit(code);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.error("Usage: anvia-acp <agent-module.mjs>");
    return;
  }
  if (args.length !== 1 || !args[0] || args[0].startsWith("-")) {
    console.error("Usage: anvia-acp <agent-module.mjs>");
    process.exitCode = 1;
    return;
  }

  // Install shutdown handlers before module loading, which can have async initialization.
  let connection: import("./types.js").AcpConnection | undefined;
  const shutdown = () => {
    void connection?.close();
    void exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  const outputError = () => void connection?.close();
  process.stdout.on("error", outputError);
  try {
    const { loadSessionFactory } = await import("./launcher.js");
    const { serveStdio } = await import("./stdio.js");
    const sessionFactory = await loadSessionFactory(args[0]);
    connection = serveStdio({ sessionFactory, output });
    await connection.closed;
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    // Keep the stdout error listener until process exit, including the final output drain.
  }
}

try {
  await main();
  await exit(Number(process.exitCode ?? 0));
} catch {
  // Import/provider errors may contain credentials or prompts. Never print the raw cause.
  console.error("anvia-acp: startup failed; check the agent module and its configuration.");
  await exit(1);
}
