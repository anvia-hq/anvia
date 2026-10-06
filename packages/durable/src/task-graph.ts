import type { DurableRuntime } from "./runtime.js";
import type { DurableStreamOptions } from "./run.js";
import type { DurableGraphEvent, DurableGraphSnapshot } from "./graph-types.js";
import { delay } from "./wait.js";

/** A persisted static DAG. Each node is an ordinary durable agent run in an isolated session. */
export class DurableTaskGraph {
  constructor(
    readonly id: string,
    private readonly runtime: DurableRuntime,
  ) {}
  async snapshot(): Promise<DurableGraphSnapshot> {
    return this.runtime.graphSnapshot(this.id);
  }
  async cancel(): Promise<void> {
    this.runtime.cancelGraph(this.id);
  }
  async *stream(options: DurableStreamOptions = {}): AsyncIterable<DurableGraphEvent> {
    let cursor = options.after ?? 0;
    const initial = await this.snapshot();
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > initial.cursor)
      throw new TypeError("Invalid graph event cursor.");
    const taskIds = new Map(initial.nodes.map((node) => [node.runId, node.id]));
    while (true) {
      options.abortSignal?.throwIfAborted();
      const events = this.runtime.graphEvents(this.id, cursor);
      for (const event of events) {
        options.abortSignal?.throwIfAborted();
        const taskId = taskIds.get(event.runId);
        if (taskId === undefined) throw new Error("Graph event belongs to an unknown task.");
        cursor = event.sequence;
        yield { ...event, graphId: this.id, taskId };
      }
      if (events.length > 0) continue;
      const snapshot = await this.snapshot();
      if (snapshot.status === "completed" || snapshot.status === "cancelled") return;
      await delay(options.abortSignal);
    }
  }
}
