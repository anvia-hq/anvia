import { delay } from "./wait.js";
import type { AgentOutcome, AgentSteerInput, AgentSteerReceipt } from "@anvia/core/agent";
import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import type { ToolResultOutput } from "@anvia/core/completion";
import { DurableBlockedError, DurableRunError } from "./errors.js";
import type { DurableRunClient, DurableRunReader } from "./client.js";
import type {
  DurableEvent,
  DurableSnapshot,
  DurableRunSummary,
  DurableSteerOptions,
  MemoryWriteResolution,
} from "./types.js";

export type DurableStreamOptions = { after?: number; abortSignal?: AbortSignal };

export type DurableResultOptions = {
  abortSignal?: AbortSignal;
  /**
   * What to do when the run is `needs_attention`. `"wait"` (default) keeps waiting for an operator
   * to settle it; `"throw"` rejects with `DurableBlockedError` so a caller without an operator
   * path does not hang.
   */
  onBlocked?: "wait" | "throw";
};

/**
 * A read-only identity and subscription handle. Closing a subscription never cancels execution.
 * `DurableRun` adds the mutations; a `DurableObserver` hands out views without them.
 */
export class DurableRunView<Output = unknown> {
  constructor(
    readonly id: string,
    protected readonly reader: DurableRunReader,
  ) {}

  async snapshot(options: { operations?: boolean } = {}): Promise<DurableSnapshot> {
    return this.reader.snapshot(this.id, options);
  }

  async status(): Promise<DurableRunSummary> {
    return this.reader.status(this.id);
  }

  async *stream(options: DurableStreamOptions = {}): AsyncIterable<DurableEvent> {
    let cursor = options.after ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError("Invalid event cursor.");
    if (cursor > (await this.snapshot({ operations: false })).cursor)
      throw new TypeError("Event cursor is ahead of the store.");
    while (true) {
      options.abortSignal?.throwIfAborted();
      // Read the status first: a terminal status is committed with its last event, so events read
      // after it are complete. Reading in the other order could miss a final event.
      const run = await this.status();
      const events = await this.reader.events(this.id, cursor);
      for (const event of events) {
        options.abortSignal?.throwIfAborted();
        cursor = event.sequence;
        yield event;
      }
      if (events.length > 0) continue;
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled")
        return;
      await delay(options.abortSignal);
    }
  }

  async result(options: DurableResultOptions = {}): Promise<AgentOutcome<Output>> {
    if (
      options.onBlocked !== undefined &&
      options.onBlocked !== "wait" &&
      options.onBlocked !== "throw"
    )
      throw new TypeError('onBlocked must be "wait" or "throw".');
    while (true) {
      options.abortSignal?.throwIfAborted();
      // Settle from the observed state: another caller may retry before the next snapshot.
      const run = await this.status();
      if (run.status === "failed" || run.status === "cancelled") {
        throw new DurableRunError(run.id, run.status, run.error ?? run.status);
      }
      if (run.status === "needs_attention" && options.onBlocked === "throw") {
        throw new DurableBlockedError(
          run.id,
          run.blockedOperation,
          run.error ?? "Run needs attention.",
        );
      }
      if (run.status === "completed") {
        const { outcome } = await this.reader.run(this.id);
        if (outcome === undefined) throw new Error("Completed durable run has no outcome.");
        // The registration's agent produced this outcome, so its output matches `Output`.
        return outcome as AgentOutcome<Output>;
      }
      // Cancelling a wait only detaches this subscriber.
      await delay(options.abortSignal);
    }
  }
}

/** An identity and subscription handle. Closing a subscription never cancels execution. */
export class DurableRun<Output = unknown> extends DurableRunView<Output> {
  constructor(
    id: string,
    private readonly client: DurableRunClient,
  ) {
    super(id, client);
  }

  async steer(
    input: AgentSteerInput,
    options: DurableSteerOptions = {},
  ): Promise<AgentSteerReceipt> {
    return this.client.steer(this.id, input, options);
  }

  async respond(interactionId: string, response: AgentInteractionResponse): Promise<void> {
    await this.client.respond(this.id, interactionId, response);
  }

  async resolveTool(operationId: string, output: ToolResultOutput): Promise<void> {
    await this.client.resolveTool(this.id, operationId, output);
  }

  async resolveMemoryWrite(operationKey: string, resolution: MemoryWriteResolution): Promise<void> {
    await this.client.resolveMemoryWrite(this.id, operationKey, resolution);
  }

  async retry(): Promise<void> {
    await this.client.retry(this.id);
  }

  async cancel(): Promise<void> {
    await this.client.cancel(this.id);
  }
}
