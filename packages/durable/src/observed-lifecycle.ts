import type { AgentLifecycle } from "@anvia/core/agent";
import { lifecycleSnapshot } from "@anvia/core/internal/agent";
import { errorMessage, json } from "./json.js";
import type { DurableAgentRegistration, DurableRunRecord, DurableStore } from "./types.js";

type Hook = keyof AgentLifecycle;

/**
 * The agent's observational lifecycle hooks, each gated by a record. The record is committed before
 * the hook runs, and a later attempt that finds it (completed, or still `started` after a crash)
 * skips the hook, so a hook runs at most once per step and is never repeated on replay.
 *
 * Each event is a snapshot, deep-frozen before the hook sees it, so a hook cannot change the
 * request or the outcome. A hook that throws is recorded and does not fail the run.
 *
 * Returns undefined when the registration does not declare its hooks observational or has none.
 */
export function createObservedLifecycle(
  store: DurableStore,
  run: DurableRunRecord,
  registration: DurableAgentRegistration,
): AgentLifecycle<unknown, unknown> | undefined {
  if (registration.lifecycle === undefined) return undefined;
  const hooks = registration.agent.lifecycle as AgentLifecycle<unknown, unknown> | undefined;
  if (hooks === undefined) return undefined;

  // Model turns alone repeat when a failed run is retried, so a retry count is part of the key.
  const failureSlot = async () =>
    store.transaction(async (tx) => {
      const current = await tx.getRun(run.id);
      return `${current?.modelTurns ?? 0}:${current?.retries ?? 0}`;
    });

  async function observe<Event>(
    hook: Hook,
    step: number | string,
    toolCallId: string | undefined,
    event: Event,
    call: (snapshot: Event) => unknown,
  ): Promise<void> {
    if (hooks![hook] === undefined) return;
    const key = `${run.epoch}:lifecycle:${hook}:${step}:${toolCallId ?? ""}`;
    const claimed = await store.transaction(async (tx) => {
      if ((await tx.getOperation(run.id, key)) !== undefined) return false;
      await tx.putOperation(run.id, {
        key,
        kind: "effect",
        input: json({ hook, step, toolCallId: toolCallId ?? null }),
        status: "started",
        recovery: "manual",
      });
      return true;
    });
    if (!claimed) return;

    let result: { failed: false } | { failed: true; error: string } = { failed: false };
    try {
      await call(deepFreeze(lifecycleSnapshot(event)));
    } catch (error) {
      result = { failed: true, error: errorMessage(error) };
    }
    await store.transaction(async (tx) =>
      tx.putOperation(run.id, {
        key,
        kind: "effect",
        input: json({ hook, step, toolCallId: toolCallId ?? null }),
        status: "completed",
        recovery: "manual",
        result: json(result),
      }),
    );
  }

  return {
    onStart: (event) => observe("onStart", 0, undefined, event, (e) => hooks.onStart?.(e)),
    onStepFinish: (event) =>
      observe("onStepFinish", event.step, undefined, event, (e) => hooks.onStepFinish?.(e)),
    onToolStart: (event) =>
      observe("onToolStart", event.step, event.toolCallId, event, (e) => hooks.onToolStart?.(e)),
    onToolFinish: (event) =>
      observe("onToolFinish", event.step, event.toolCallId, event, (e) => hooks.onToolFinish?.(e)),
    // The model-turn count and retry count tell a later failure apart from an earlier one.
    onFinish: async (event) =>
      observe("onFinish", await failureSlot(), undefined, event, (e) => hooks.onFinish?.(e)),
    onError: async (event) =>
      observe("onError", await failureSlot(), undefined, event, (e) => hooks.onError?.(e)),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
