import type { MaybePromise } from "../internal/type-utils";
import { allow, inputActions, outputActions } from "./actions";
import { rewriteMessageText, textFromMessage } from "./message";
import type {
  GuardrailActionBase,
  GuardrailActionName,
  GuardrailAllow,
  GuardrailBlock,
  GuardrailBoundary,
  GuardrailDecisionRecord,
  GuardrailPolicy,
  InputGuardrailContext,
  InputGuardrailRunResult,
  OutputGuardrailContext,
  OutputGuardrailRunResult,
} from "./types";

export async function runInputGuardrails(
  policies: GuardrailPolicy[],
  context: InputGuardrailContext,
): Promise<InputGuardrailRunResult> {
  let prompt = context.prompt;
  let inputText = context.inputText;
  const decisions: GuardrailDecisionRecord[] = [];

  for (const policy of policies) {
    for (const guardrail of policy.input) {
      const currentContext = { ...context, prompt, inputText };
      const result = await runGuardrail(policy, guardrail.id, "input", () =>
        guardrail.check(currentContext, inputActions),
      );
      decisions.push(result.decision);

      if (policy.mode === "observe") {
        continue;
      }
      if (result.action.action === "block") {
        return {
          prompt,
          inputText,
          blocked: true,
          message: result.action.message,
          decisions,
        };
      }
      if (result.action.action === "rewrite") {
        if (result.action.prompt !== undefined) {
          prompt = result.action.prompt;
          inputText = textFromMessage(prompt);
        } else if (result.action.inputText !== undefined) {
          inputText = result.action.inputText;
          prompt = rewriteMessageText(prompt, inputText);
        }
      }
    }
  }

  return { prompt, inputText, blocked: false, decisions };
}

export async function runOutputGuardrails(
  policies: GuardrailPolicy[],
  context: OutputGuardrailContext,
): Promise<OutputGuardrailRunResult> {
  let outputText = context.outputText;
  const decisions: GuardrailDecisionRecord[] = [];

  for (const policy of policies) {
    for (const guardrail of policy.output) {
      const currentContext = { ...context, outputText };
      const result = await runGuardrail(policy, guardrail.id, "output", () =>
        guardrail.check(currentContext, outputActions),
      );
      decisions.push(result.decision);

      if (policy.mode === "observe") {
        continue;
      }
      if (result.action.action === "block") {
        return {
          outputText,
          blocked: true,
          message: result.action.message,
          decisions,
        };
      }
      if (result.action.action === "rewrite") {
        outputText = result.action.outputText;
      }
    }
  }

  return { outputText, blocked: false, decisions };
}

type RunGuardrailResult<TAction extends { action: GuardrailActionName }> = {
  action: TAction;
  decision: GuardrailDecisionRecord;
};

async function runGuardrail<TAction extends { action: GuardrailActionName } & GuardrailActionBase>(
  policy: GuardrailPolicy,
  guardrailId: string,
  boundary: GuardrailBoundary,
  run: () => MaybePromise<TAction | undefined>,
): Promise<RunGuardrailResult<TAction | GuardrailAllow>> {
  const startedAt = Date.now();
  try {
    const action = (await run()) ?? allow();
    return {
      action,
      decision: decisionRecord({
        policy,
        guardrailId,
        boundary,
        action,
        latencyMs: Date.now() - startedAt,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (policy.mode === "observe") {
      return {
        action: allow(),
        decision: {
          policyId: policy.id,
          guardrailId,
          boundary,
          mode: policy.mode,
          action: "error",
          applied: false,
          reason: message,
          latencyMs: Date.now() - startedAt,
        },
      };
    }
    throw error;
  }
}

function decisionRecord(args: {
  policy: GuardrailPolicy;
  guardrailId: string;
  boundary: GuardrailBoundary;
  action: GuardrailAllow | GuardrailBlock | ({ action: GuardrailActionName } & GuardrailActionBase);
  latencyMs: number;
}): GuardrailDecisionRecord {
  const applied = args.policy.mode === "enforce" && args.action.action !== "allow";
  const record: GuardrailDecisionRecord = {
    policyId: args.policy.id,
    guardrailId: args.guardrailId,
    boundary: args.boundary,
    mode: args.policy.mode,
    action: args.action.action,
    applied,
    latencyMs: args.latencyMs,
  };
  if (args.action.reason !== undefined) record.reason = args.action.reason;
  if ("message" in args.action && typeof args.action.message === "string") {
    record.message = args.action.message;
  }
  if (args.action.metadata !== undefined) record.metadata = args.action.metadata;
  return record;
}
