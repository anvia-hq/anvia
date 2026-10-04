#!/usr/bin/env node
import { runCli } from "./cli/run";

try {
  runCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
