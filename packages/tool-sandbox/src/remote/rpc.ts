import { DockerSandboxError } from "../errors";
import { type CallOptions, LinkClosedError } from "./connection";
import {
  type MethodParams,
  type MethodResult,
  type SandboxMethod,
  mutatingMethods,
} from "./protocol";
import type { RemoteLinkSource } from "./runtime";

/** Link losses a call survives. Each retry waits for a reconnect of up to `connectTimeoutMs`. */
const maxAttempts = 3;

export interface RpcOptions extends CallOptions {
  /** A capability the daemon must advertise, and the error to raise when it does not. */
  require?: { capability: string; error: () => Error } | undefined;
  /**
   * Whether a call may be repeated after the link drops. By default reads and keyed mutations
   * are, and an unkeyed mutation is not, because it may already have run.
   */
  retry?: boolean | undefined;
}

/**
 * One request to the daemon, over whatever connection is live, riding out a reconnect where that is
 * safe. A mutation that may already have run is not repeated; it fails with `sandbox_unavailable`.
 */
export async function rpc<M extends SandboxMethod>(
  source: RemoteLinkSource,
  method: M,
  params: MethodParams<M>,
  options: RpcOptions = {},
): Promise<MethodResult<M>> {
  const keyed = options.operationId !== undefined;
  const mutating = mutatingMethods.has(method);
  const retryable = options.retry ?? (!mutating || keyed);
  let lastLoss: LinkClosedError | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const connection = await source.acquire(options.signal);
    if (options.require !== undefined && !connection.capabilities.has(options.require.capability)) {
      throw options.require.error();
    }
    try {
      return await connection.call(method, params, options);
    } catch (error) {
      if (!(error instanceof LinkClosedError)) throw error;
      lastLoss = error;
      if (!retryable) break;
    }
  }
  const hint = mutating && !keyed ? "; pass an operationId to make it safe to retry" : "";
  throw new DockerSandboxError(
    retryable
      ? "Sandbox connection kept dropping."
      : `Sandbox connection dropped during ${method}${hint}.`,
    "sandbox_unavailable",
    undefined,
    lastLoss === undefined ? undefined : { cause: lastLoss },
  );
}
