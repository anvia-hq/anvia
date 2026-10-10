import type { JsonValue } from "@anvia/core/completion";
import { DurableRunError } from "../errors.js";
import type { DurableStreamOptions } from "../run.js";
import { delay } from "../wait.js";
import type { TaskScheduler } from "./scheduler.js";
import { terminal } from "./state.js";
import type { TaskEvent } from "./types.js";
import type { DurableStore } from "../types.js";

/** Typed output is available for submitted definitions; reacquired IDs return JSON. */
export class DurableTaskHandle<R = JsonValue> {
  constructor(
    readonly id: string,
    private readonly scheduler: TaskScheduler,
    private readonly store: DurableStore,
    private readonly assertOpen: () => void,
  ) {}

  async snapshot(options: { operations?: boolean } = {}) {
    this.assertOpen();
    return this.scheduler.snapshot(this.id, options);
  }
  async graph() {
    this.assertOpen();
    return this.scheduler.graph(this.id);
  }
  /** Optional identity fence for callers authorizing a captured ownership tree. */
  async cancel(options: { expectedTreeIds?: readonly string[] } = {}): Promise<void> {
    this.assertOpen();
    this.scheduler.cancel(this.id, options.expectedTreeIds);
  }
  async retry(): Promise<void> {
    this.assertOpen();
    this.scheduler.retry(this.id);
  }
  async resolveEffect(key: string, value: JsonValue): Promise<void> {
    this.assertOpen();
    this.scheduler.resolveEffect(this.id, key, value);
  }
  async signal(name: string, requestId: string, value: JsonValue): Promise<void> {
    this.assertOpen();
    this.scheduler.signal(this.id, name, requestId, value);
  }

  async result(options: { abortSignal?: AbortSignal } = {}): Promise<R> {
    while (true) {
      options.abortSignal?.throwIfAborted();
      const { task } = await this.snapshot();
      if (terminal(task)) {
        const outcome = task.outcome!;
        if (outcome.status === "completed") return outcome.output as R;
        throw new DurableRunError(task.id, outcome.status, outcome.error);
      }
      await delay(options.abortSignal);
    }
  }

  /** Streams the entire owned tree, including children created after attachment. */
  async *stream(options: DurableStreamOptions = {}): AsyncIterable<TaskEvent> {
    let cursor = options.after ?? 0;
    const initial = await this.snapshot();
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > initial.cursor)
      throw new TypeError("Invalid task event cursor.");
    while (true) {
      this.assertOpen();
      options.abortSignal?.throwIfAborted();
      const events = this.store.taskEvents(initial.task.rootId, cursor, 100);
      for (const event of events) {
        options.abortSignal?.throwIfAborted();
        if (event.type !== "submitted" && event.type !== "status")
          throw new Error("Invalid task event type.");
        cursor = event.sequence;
        yield {
          rootId: initial.task.rootId,
          sequence: event.sequence,
          taskId: event.runId,
          createdAt: event.createdAt,
          type: event.type,
          data: event.data,
        };
      }
      if (events.length > 0) continue;
      if (terminal(this.scheduler.snapshot(initial.task.rootId).task)) return;
      await delay(options.abortSignal);
    }
  }
}
