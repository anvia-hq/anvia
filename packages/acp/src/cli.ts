#!/usr/bin/env node
import { runStdioServer } from "./launcher.js";

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.error("Usage: anvia-acp <agent-module>");
} else if (args.length !== 1 || !args[0] || args[0].startsWith("-")) {
  console.error("Usage: anvia-acp <agent-module>");
  process.exitCode = 1;
} else {
  await runStdioServer(args[0]);
}
