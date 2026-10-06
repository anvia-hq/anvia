import { delay } from "./wait.js";
import type { AgentOutcome } from "@anvia/core/agent";
import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import type { ToolResultOutput } from "@anvia/core/completion";
import { DurableRunError } from "./errors.js";
import type { DurableRuntime } from "./runtime.js";
import type { DurableEvent, DurableSnapshot } from "./types.js";

export type DurableStreamOptions = { after?: number; abortSignal?: AbortSignal };

/** An identity and subscription handle. Closing a subscription never cancels execution. */
export class DurableRun {
  constructor(
    readonly id: string,
    private readonly runtime: DurableRuntime,
  ) {}

  async snapshot(): Promise<DurableSnapshot> {
    return this.runtime.snapshot(this.id);
  }

  async *stream(options: DurableStreamOptions = {}): AsyncIterable<DurableEvent> {
    let cursor = options.after ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError("Invalid event cursor.");
    if (cursor > (await this.snapshot()).cursor)
      throw new TypeError("Event cursor is ahead of the store.");
    while (true) {
      options.abortSignal?.throwIfAborted();
      const events = this.runtime.events(this.id, cursor);
      for (const event of events) {
        options.abortSignal?.throwIfAborted();
        cursor = event.sequence;
        yield event;
      }
      if (events.length > 0) continue;
      const { run } = await this.snapshot();
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled")
        return;
      await delay(options.abortSignal);
    }
  }

  async result(options: { abortSignal?: AbortSignal } = {}): Promise<AgentOutcome<unknown>> {
    while (true) {
      options.abortSignal?.throwIfAborted();
      // Settle from the observed state: another caller may retry before the next snapshot.
      const { run } = await this.snapshot();
      if (run.status === "failed" || run.status === "cancelled") {
        throw new DurableRunError(run.id, run.status, run.error ?? run.status);
      }
      if (run.status === "completed") {
        if (run.outcome === undefined) throw new Error("Completed durable run has no outcome.");
        return run.outcome;
      }
      // Cancelling a wait only detaches this subscriber.
      await delay(options.abortSignal);
    }
  }

  async respond(interactionId: string, response: AgentInteractionResponse): Promise<void> {
    this.runtime.respond(this.id, interactionId, response);
  }

  async resolveTool(operationId: string, output: ToolResultOutput): Promise<void> {
    this.runtime.resolveTool(this.id, operationId, output);
  }

  async retry(): Promise<void> {
    this.runtime.retry(this.id);
  }

  async cancel(): Promise<void> {
    this.runtime.cancel(this.id);
  }
}
