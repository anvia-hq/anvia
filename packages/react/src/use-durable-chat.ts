import type { AgentSteerInput } from "@anvia/core/agent";
import type { ToolResultOutput } from "@anvia/core/completion";
import { useMemo, useSyncExternalStore } from "react";
import type { AnyClientTransport, UseChatOptions, UseChatResult } from "./types";
import { useChat } from "./use-chat";

/**
 * What `useDurableChat` needs from a durable chat transport. `createDurableChatTransport` from
 * `@anvia/client/durable-chat` returns a transport with this controller. It is declared here so
 * `@anvia/react` does not depend on `@anvia/durable` types.
 */
export type DurableChatControls = {
  readonly activeRunId: string | undefined;
  readonly status: string | undefined;
  subscribe(listener: () => void): () => void;
  steer(input: AgentSteerInput, runId?: string): Promise<void>;
  cancel(runId?: string): Promise<void>;
  retry(runId?: string): Promise<void>;
  resolveTool(operationId: string, output: ToolResultOutput, runId?: string): Promise<void>;
  resolveMemoryWrite(
    operationKey: string,
    resolution: "applied" | "discarded",
    runId?: string,
  ): Promise<void>;
};

export type DurableChatTransportLike = AnyClientTransport & {
  readonly controller: DurableChatControls;
};

export type UseDurableChatOptions<Transport extends DurableChatTransportLike> =
  UseChatOptions<Transport>;

/** The durable run behind the chat. Controls act on the run the chat last submitted or resumed. */
export type DurableChatRun = {
  /** Undefined before the first send or resume. */
  id: string | undefined;
  /**
   * Durable status of the run, for example `queued`, `running`, `waiting`, `retry_wait` or
   * `needs_attention`. `useChat().status` only says whether a stream is open.
   */
  status: string | undefined;
  steer(input: AgentSteerInput): Promise<void>;
  /** Cancels the run. `stop()` on the chat only detaches from its stream. */
  cancel(): Promise<void>;
  retry(): Promise<void>;
  resolveTool(operationId: string, output: ToolResultOutput): Promise<void>;
  resolveMemoryWrite(operationKey: string, resolution: "applied" | "discarded"): Promise<void>;
};

export type UseDurableChatResult<Transport extends DurableChatTransportLike> =
  UseChatResult<Transport> & { run: DurableChatRun };

/**
 * `useChat` over a durable chat transport, plus the run's durable status and controls.
 *
 * Create the transport once (module scope, or `useMemo`/`useState` keyed on agent and session):
 * it remembers the active run, so a transport recreated on every render loses it. Set
 * `resume: { key }` to reattach to a run that outlived the page after a reload.
 */
export function useDurableChat<Transport extends DurableChatTransportLike>(
  options: UseDurableChatOptions<Transport>,
): UseDurableChatResult<Transport> {
  const chat = useChat(options);
  const controller = options.transport.controller;
  const id = useSyncExternalStore(
    controller.subscribe,
    () => controller.activeRunId,
    () => undefined,
  );
  const status = useSyncExternalStore(
    controller.subscribe,
    () => controller.status,
    () => undefined,
  );
  const run = useMemo<DurableChatRun>(
    () => ({
      id,
      status,
      steer: (input) => controller.steer(input),
      cancel: () => controller.cancel(),
      retry: () => controller.retry(),
      resolveTool: (operationId, output) => controller.resolveTool(operationId, output),
      resolveMemoryWrite: (operationKey, resolution) =>
        controller.resolveMemoryWrite(operationKey, resolution),
    }),
    [controller, id, status],
  );
  return { ...chat, run };
}
