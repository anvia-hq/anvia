import type {
  GuardrailPolicy,
  GuardrailPolicyInput,
  GuardrailPolicyOptions,
  InputGuardrail,
  OutputGuardrail,
} from "./types";

export function defineGuardrailPolicy(options: GuardrailPolicyOptions): GuardrailPolicy {
  return {
    id: options.id,
    mode: options.mode ?? "enforce",
    input: options.input ?? [],
    output: options.output ?? [],
  };
}

export function defineInputGuardrail(guardrail: InputGuardrail): InputGuardrail {
  return guardrail;
}

export function defineOutputGuardrail(guardrail: OutputGuardrail): OutputGuardrail {
  return guardrail;
}

export function normalizeGuardrailPolicies(
  policies: GuardrailPolicyInput | undefined,
): GuardrailPolicy[] {
  if (policies === undefined) {
    return [];
  }
  return Array.isArray(policies) ? policies : [policies];
}

export function appendGuardrailPolicies(
  current: GuardrailPolicy[],
  next: GuardrailPolicyInput,
): GuardrailPolicy[] {
  return [...current, ...normalizeGuardrailPolicies(next)];
}

export function hasEnforcedOutputGuardrails(policies: GuardrailPolicy[]): boolean {
  return policies.some((policy) => policy.mode === "enforce" && policy.output.length > 0);
}
