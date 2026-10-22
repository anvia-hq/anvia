#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { SandboxDaemon } from "./daemon/index";

const usage = `anvia-sandbox-daemon

Runs inside a sandbox, dials out to a control plane, and executes sandbox operations locally.

Environment:
  ANVIA_CONTROL_URL        ws:// or wss:// URL of the hub (required)
  ANVIA_SANDBOX_TOKEN      Credential for the hub's authorize() (required)
  ANVIA_SANDBOX_WORKDIR    Workspace directory (default: current directory)
  ANVIA_SANDBOX_STATE_DIR  Operation dedup table (default: <tmpdir>/anvia-sandbox-daemon)
  ANVIA_SANDBOX_COMMAND_TIMEOUT_MS, ANVIA_SANDBOX_MAX_OUTPUT_BYTES,
  ANVIA_SANDBOX_MAX_FILE_BYTES, ANVIA_SANDBOX_MAX_PROCESSES   Optional limits
`;

function integer(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function main(): void {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(usage);
    return;
  }
  const controlUrl = process.env.ANVIA_CONTROL_URL;
  const token = process.env.ANVIA_SANDBOX_TOKEN;
  if (!controlUrl || !token) {
    process.stderr.write(`ANVIA_CONTROL_URL and ANVIA_SANDBOX_TOKEN are required.\n\n${usage}`);
    process.exitCode = 2;
    return;
  }

  const limits = {
    ...optional("commandTimeoutMs", integer("ANVIA_SANDBOX_COMMAND_TIMEOUT_MS")),
    ...optional("maxOutputBytes", integer("ANVIA_SANDBOX_MAX_OUTPUT_BYTES")),
    ...optional("maxFileBytes", integer("ANVIA_SANDBOX_MAX_FILE_BYTES")),
    ...optional("maxProcesses", integer("ANVIA_SANDBOX_MAX_PROCESSES")),
  };
  const daemon = new SandboxDaemon({
    controlUrl,
    token,
    workdir: path.resolve(process.env.ANVIA_SANDBOX_WORKDIR ?? process.cwd()),
    stateDir: path.resolve(
      process.env.ANVIA_SANDBOX_STATE_DIR ?? path.join(os.tmpdir(), "anvia-sandbox-daemon"),
    ),
    limits,
    onLog: (level, message) =>
      process.stderr.write(`[anvia-sandbox-daemon] ${level}: ${message}\n`),
  });
  daemon.start();

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      void daemon.stop().finally(() => process.exit(0));
    });
  }
}

function optional<K extends string>(key: K, value: number | undefined): { [P in K]?: number } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: number });
}

main();
