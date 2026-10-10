import { expect } from "vitest";
import type { JsonObject } from "@anvia/core/completion";
import type { DurableRuntime } from "../src/index.js";

/** model_started retains the original embedded request, exactly as in the 0.6 journal.
 * Compare serialized bytes, including key order, rather than just semantic equality.
 */
export function expectJournalRequests(runtime: DurableRuntime, id: string): void {
  let cursor = 0;
  const requests = new Map<string, string>();
  while (true) {
    const events = runtime.events(id, cursor);
    if (events.length === 0) break;
    for (const event of events) {
      if (event.type === "model_started") {
        const data = event.data as JsonObject;
        requests.set(String(data.operationId), JSON.stringify((data.input as JsonObject).request));
      }
      cursor = event.sequence;
    }
  }
  const models = runtime.snapshot(id).operations.filter((op) => op.kind === "model");
  expect(models.length).toBeGreaterThan(0);
  for (const model of models) {
    expect(requests.has(model.key)).toBe(true);
    expect(JSON.stringify(runtime.operationRequest(id, model.key))).toBe(requests.get(model.key));
  }
}
