import { Readable, Writable } from "node:stream";
import { createAcpConnection } from "./connection.js";
import type { AcpConnection, AcpOptions } from "./types.js";

export type AcpStdioOptions = AcpOptions & {
  input?: Readable;
  output?: Writable;
};

/**
 * Serve ACP on Node streams (stdin/stdout by default). The caller owns logging and signals.
 * Use the dedicated launcher to redirect application logs before loading an agent module.
 */
export function serveStdio(options: AcpStdioOptions): AcpConnection {
  return createAcpConnection({
    ...options,
    input: Readable.toWeb(options.input ?? process.stdin),
    output: Writable.toWeb(options.output ?? process.stdout),
  });
}
