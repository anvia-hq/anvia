import type { AgentHook } from "@anvia/core/internal/agent";
import { DurableRecoveryError } from "./errors.js";
import { errorMessage, json } from "./json.js";
import type { DurableAgentRegistration, DurableRunRecord, DurableStore } from "./types.js";

/** The hooks durable can record: the ones whose action steers or stops a run. */
export const RECORDED_HOOKS = ["onRunStart", "onCompletionCall", "onToolCall"] as const;
export type RecordedHookName = (typeof RECORDED_HOOKS)[number];

type Outcome = { ok: true; action: unknown } | { ok: false; error: string; retries: number };

/** Names the recorded control hooks the registration's hook defines. */
export function recordedHookNames(registration: DurableAgentRegistration): RecordedHookName[] {
  const hook = registration.hooks?.hook;
  if (hook === undefined) return [];
  return RECORDED_HOOKS.filter((name) => typeof hook[name] === "function");
}

/**
 * The registration's control hook, with every decision recorded before core applies it. The record
 * is an `effect` operation written before the hook runs. A replayed call returns the recorded
 * action without calling the hook again. A hook that was started and never recorded, because the
 * process stopped inside it, is not run again: the run fails with a recovery error and goes to
 * `needs_attention`. A hook that throws is recorded as an error and fails the run, since carrying
 * on could skip a block or an approval the hook meant to apply; `retry()` runs it once more under a
 * new key, and a decision that was recorded stays as it was.
 *
 * Calls are keyed by their position in the epoch (a run replays its calls in the same order), and
 * the tool call id for a tool hook. Core runs tools one at a time while a hook is active.
 *
 * Returns undefined when the registration declares no hooks.
 */
export function createRecordedHooks(
  store: DurableStore,
  run: DurableRunRecord,
  registration: DurableAgentRegistration,
): AgentHook | undefined {
  const hook = registration.hooks?.hook;
  if (hook === undefined) return undefined;
  const sequence: Record<string, number> = {};

  async function record(
    name: RecordedHookName,
    toolCallId: string | undefined,
    call: () => unknown,
  ): Promise<unknown> {
    const position = (sequence[name] = (sequence[name] ?? -1) + 1);
    const base = `${run.epoch}:hook:${name}:${position}:${toolCallId ?? ""}`;
    const retries = await store.transaction(async (tx) => (await tx.getRun(run.id))?.retries ?? 0);
    // An errored hook is run again after retry() under the next key; a recorded action is final.
    let key = base;
    let existing = await store.transaction(async (tx) => tx.getOperation(run.id, key));
    for (let attempt = 1; existing?.status === "completed"; attempt++) {
      const previous = existing.result as unknown as Outcome;
      if (previous.ok || previous.retries >= retries) break;
      key = `${base}:attempt${attempt}`;
      existing = await store.transaction(async (tx) => tx.getOperation(run.id, key));
    }
    if (existing?.status === "completed") {
      const outcome = existing.result as unknown as Outcome;
      if (outcome.ok) return outcome.action ?? undefined;
      throw new Error(outcome.error);
    }
    if (existing !== undefined)
      throw new DurableRecoveryError(
        `Hook "${name}" was interrupted before its decision was recorded; the decision is unknown and the hook is not run again.`,
        key,
      );
    const identity = json({ hook: name, position, toolCallId: toolCallId ?? null });
    await store.transaction(async (tx) => {
      await tx.putOperation(run.id, {
        key,
        kind: "effect",
        input: identity,
        status: "started",
        recovery: "manual",
      });
    });
    let outcome: Outcome;
    try {
      outcome = { ok: true, action: json((await call()) ?? null) };
    } catch (error) {
      outcome = { ok: false, error: errorMessage(error), retries };
    }
    await store.transaction(async (tx) => {
      await tx.putOperation(run.id, {
        key,
        kind: "effect",
        input: identity,
        status: "completed",
        recovery: "manual",
        result: json(outcome),
      });
    });
    if (outcome.ok) return outcome.action ?? undefined;
    throw new Error(outcome.error);
  }

  const recorded: AgentHook = {};
  if (typeof hook.onRunStart === "function")
    recorded.onRunStart = (args) =>
      record("onRunStart", undefined, () => hook.onRunStart!(args)) as ReturnType<
        NonNullable<AgentHook["onRunStart"]>
      >;
  if (typeof hook.onCompletionCall === "function")
    recorded.onCompletionCall = (args) =>
      record("onCompletionCall", undefined, () => hook.onCompletionCall!(args)) as ReturnType<
        NonNullable<AgentHook["onCompletionCall"]>
      >;
  if (typeof hook.onToolCall === "function")
    recorded.onToolCall = (args) =>
      record("onToolCall", args.toolCallId, () => hook.onToolCall!(args)) as ReturnType<
        NonNullable<AgentHook["onToolCall"]>
      >;
  return recorded;
}
