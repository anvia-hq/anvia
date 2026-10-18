import { Console } from "node:console";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import type { AcpConnection, AcpOptions, AcpSessionFactory } from "./types.js";

/** Optional `acpOptions` export from the trusted agent module. Other settings use defaults. */
export type AcpLauncherOptions = Pick<AcpOptions, "mcp">;

class StartupError extends Error {}

/**
 * Run a trusted local agent module as a process-owned ACP stdio server.
 * Redirects console/stdout before loading application code, owns signals, and exits the process
 * after cleanup (with a five-second shutdown deadline). Embedded hosts should use serveStdio.
 * Importing this entrypoint has no process side effects.
 */
export async function runStdioServer(modulePath: string): Promise<void> {
  const protocolWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  const output = new Writable({
    write(chunk, encoding, callback) {
      protocolWrite(chunk, encoding, callback);
    },
  });

  let connection: AcpConnection | undefined;
  let exiting: Promise<void> | undefined;
  function exit(code: number): Promise<void> {
    if (exiting) return exiting;
    // Start the deadline before awaiting user disposers or uncooperative tools.
    setTimeout(() => process.exit(code), 5_000);
    exiting = (async () => {
      await connection?.close().catch(() => undefined);
      await new Promise<void>((resolve) => output.end(resolve));
      await new Promise<void>((resolve) => process.stderr.write("", () => resolve()));
      process.exit(code);
    })();
    return exiting;
  }

  // Async module initialization can own handles too. Signals must work before it completes.
  const shutdown = () => void exit(0);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdin.once("end", shutdown);
  process.stdin.once("error", shutdown);
  process.stdout.on("error", shutdown);
  output.on("error", shutdown);
  try {
    const { serveStdio } = await import("./stdio.js");
    const options = await loadAgentModule(modulePath);
    if (exiting) return await exiting;
    connection = serveStdio({ ...options, output });
    await connection.closed;
  } catch (error) {
    if (!exiting) {
      // Never print raw import/provider errors, even when they carry an apparently useful code.
      console.error(
        `anvia-acp: ${error instanceof StartupError ? error.message : "startup failed; check the agent module and its configuration."}`,
      );
    }
    await exit(1);
  }
  await exit(0);
}

/** Load a trusted local ESM module. Factory evaluation belongs to session/new, not startup. */
async function loadAgentModule(
  modulePath: string,
): Promise<Pick<AcpOptions, "sessionFactory" | "mcp">> {
  const path = resolve(modulePath);
  try {
    if (!(await stat(path)).isFile()) throw new Error();
  } catch {
    throw new StartupError(
      "cannot read the agent module; provide a path to an existing local file.",
    );
  }
  const { Agent } = await import("@anvia/core/agent");
  let module: Record<string, unknown>;
  try {
    module = await import(pathToFileURL(path).href);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ERR_UNKNOWN_FILE_EXTENSION") {
      throw new StartupError(
        "cannot load this module's file type. For TypeScript, use Node 22.19.0+ with native type stripping enabled, or compile to JavaScript.",
      );
    }
    if (code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX") {
      throw new StartupError(
        "TypeScript syntax is not supported by native type stripping; use erasable types or compile to JavaScript.",
      );
    }
    throw new StartupError("startup failed; check the agent module and its configuration.");
  }
  // Only trusted module code can supply host MCP policy; never take it from client metadata.
  const mcp = (module.acpOptions as AcpLauncherOptions | undefined)?.mcp ?? {};
  if (typeof module.sessionFactory === "function") {
    return { sessionFactory: module.sessionFactory as AcpSessionFactory, mcp };
  }
  if (typeof module.default === "function") {
    return { sessionFactory: module.default as AcpSessionFactory, mcp };
  }
  const agent = module.default ?? module.agent;
  if (!(agent instanceof Agent)) {
    throw new StartupError(
      "expected a named sessionFactory, a default factory, or a named/default Anvia Agent export.",
    );
  }

  // A singleton must never share mutable agent state across sessions.
  let claimed = false;
  const sessionFactory: AcpSessionFactory = () => {
    if (claimed) {
      throw new Error("An exported Agent supports one session; export a sessionFactory instead.");
    }
    claimed = true;
    return { agent };
  };
  return { sessionFactory, mcp };
}
