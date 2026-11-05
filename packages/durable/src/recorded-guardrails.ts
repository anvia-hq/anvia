import type { GuardrailPolicy } from "@anvia/core/guardrails";
import { DurableRecoveryError } from "./errors.js";
import { errorMessage, json } from "./json.js";
import type { DurableAgentRegistration, DurableRunRecord, DurableStore } from "./types.js";

type Outcome = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * The agent's guardrail policies, with every check's outcome recorded before core applies it. The
 * record is an `effect` operation written before the check runs. A replayed check returns the
 * recorded outcome (or rethrows the recorded error) without running again. A check that was
 * started and never recorded, because the process stopped inside it, is not run again: the run
 * fails with a recovery error for an enforced policy, and an observe-mode policy records it as an
 * error decision, since observe mode never changes the outcome.
 *
 * Returns undefined when the registration does not declare its guardrails recorded.
 */
export function createRecordedGuardrails(
  store: DurableStore,
  run: DurableRunRecord,
  registration: DurableAgentRegistration,
): readonly GuardrailPolicy[] | undefined {
  if (registration.guardrails === undefined) return undefined;
  const policies = registration.agent.guardrails;
  if (policies.length === 0) return undefined;

  // Output checks run once per final response; a retry of the same turn gets a new key.
  const outputSlot = () =>
    store.transaction((tx) => {
      const current = tx.getRun(run.id);
      return `${current?.modelTurns ?? 0}:${current?.retries ?? 0}`;
    });

  async function record(
    policy: GuardrailPolicy,
    boundary: "input" | "output",
    slot: string,
    guardrailId: string,
    check: () => unknown,
  ): Promise<unknown> {
    const key = `${run.epoch}:guardrail:${boundary}:${slot}:${policy.id}:${guardrailId}`;
    const existing = store.transaction((tx) => tx.getOperation(run.id, key));
    if (existing?.status === "completed") {
      const outcome = existing.result as unknown as Outcome;
      if (outcome.ok) return outcome.result;
      throw new Error(outcome.error);
    }
    if (existing !== undefined) {
      throw new DurableRecoveryError(
        `Guardrail "${guardrailId}" was interrupted before its outcome was recorded; the outcome is unknown and the check is not run again.`,
        key,
      );
    }
    const identity = json({ boundary, slot, policyId: policy.id, guardrailId });
    store.transaction((tx) => {
      tx.putOperation(run.id, {
        key,
        kind: "effect",
        input: identity,
        status: "started",
        recovery: "manual",
      });
    });

    let outcome: Outcome;
    try {
      outcome = { ok: true, result: json((await check()) ?? null) };
    } catch (error) {
      outcome = { ok: false, error: errorMessage(error) };
    }
    store.transaction((tx) => {
      tx.putOperation(run.id, {
        key,
        kind: "effect",
        input: identity,
        status: "completed",
        recovery: "manual",
        result: json(outcome),
      });
    });
    if (outcome.ok) return outcome.result;
    throw new Error(outcome.error);
  }

  return policies.map((policy) => ({
    ...policy,
    input: policy.input.map((guardrail) => ({
      id: guardrail.id,
      check: (context, actions) =>
        record(policy, "input", "0", guardrail.id, () => guardrail.check(context, actions)),
    })),
    output: policy.output.map((guardrail) => ({
      id: guardrail.id,
      check: (context, actions) =>
        record(policy, "output", outputSlot(), guardrail.id, () =>
          guardrail.check(context, actions),
        ),
    })),
  })) as GuardrailPolicy[];
}
