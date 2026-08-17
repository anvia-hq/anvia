import type { GuardrailPolicy } from "../guardrails";
import { assertFiniteMinScore, assertPositiveSearchLimit } from "../internal/vector-search-options";
import type { AgentObservabilityOptions, AgentObserverMap } from "../observability";
import type { VectorSearchResult } from "../vector-store";
import type { AgentContextInput, AgentMemory } from "./types";
import { isVectorContext, type VectorContext } from "./vector-context";

export function snapshotAgentContext<T>(
  inputs: readonly AgentContextInput<T>[] | undefined,
): readonly AgentContextInput<T>[] {
  const context = (inputs ?? []).map(snapshotContextInput);
  for (const input of context) {
    if (!isVectorContext(input)) continue;
    assertPositiveSearchLimit(input.topK);
    assertFiniteMinScore(input.minScore);
  }
  return Object.freeze(context);
}

export function snapshotAgentObservability(
  observability: AgentObservabilityOptions | undefined,
): AgentObservabilityOptions | undefined {
  if (observability === undefined) return undefined;
  const observers: Record<string, AgentObserverMap[string]> = {};
  for (const [name, observer] of Object.entries(observability.observers)) {
    if (name.trim().length === 0) {
      throw new TypeError("Agent observer names must not be empty.");
    }
    if (
      typeof observer !== "object" ||
      observer === null ||
      typeof observer.startRun !== "function"
    ) {
      throw new TypeError(`Agent observer "${name}" must implement startRun().`);
    }
    observers[name] = observer;
  }
  if (observability.primaryTrace !== undefined && !(observability.primaryTrace in observers)) {
    throw new TypeError(
      `Agent primaryTrace "${observability.primaryTrace}" must name a configured observer.`,
    );
  }
  const errorPolicy = observability.errorPolicy ?? "ignore";
  if (errorPolicy !== "ignore" && errorPolicy !== "throw") {
    throw new TypeError('Agent observability.errorPolicy must be "ignore" or "throw".');
  }
  return Object.freeze({
    observers: Object.freeze(observers),
    ...(observability.primaryTrace === undefined
      ? {}
      : { primaryTrace: observability.primaryTrace }),
    errorPolicy,
  });
}

export function snapshotGuardrailPolicies(
  policies: readonly GuardrailPolicy[] | undefined,
): readonly GuardrailPolicy[] {
  return Object.freeze((policies ?? []).map(snapshotGuardrailPolicy));
}

export function snapshotAgentMemory(memory: AgentMemory | undefined): AgentMemory | undefined {
  if (memory === undefined) {
    return undefined;
  }
  const compaction =
    memory.compaction === undefined
      ? undefined
      : Object.freeze({
          ...memory.compaction,
          trigger: Object.freeze({ ...memory.compaction.trigger }),
          retention: Object.freeze({ ...memory.compaction.retention }),
          conflictRetries:
            memory.compaction.conflictRetries === false
              ? false
              : Object.freeze({ ...memory.compaction.conflictRetries }),
        });
  return Object.freeze({
    store: memory.store,
    savePolicy: memory.savePolicy,
    ...(compaction === undefined ? {} : { compaction }),
  });
}

export function cloneFrozenPlainData<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneFrozenPlainData)) as T;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const clone = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneFrozenPlainData(item)]),
  );
  return Object.freeze(clone) as T;
}

function snapshotContextInput<T>(input: AgentContextInput<T>): AgentContextInput<T> {
  if (!isVectorContext(input)) {
    return Object.freeze({
      id: input.id,
      text: input.text,
      ...(input.additionalProps === undefined
        ? {}
        : { additionalProps: cloneFrozenPlainData(input.additionalProps) }),
    });
  }
  const format = input.format;
  const shared = {
    kind: "vector-context" as const,
    store: input.store,
    topK: input.topK,
    ...(input.minScore === undefined ? {} : { minScore: input.minScore }),
    ...(input.filter === undefined ? {} : { filter: cloneFrozenPlainData(input.filter) }),
    ...(input.retries === undefined ? {} : { retries: cloneFrozenPlainData(input.retries) }),
    ...(format === undefined
      ? {}
      : { format: (result: VectorSearchResult<T>) => format.call(input, result) }),
  };
  return Object.freeze<VectorContext<T>>(
    "models" in input && input.models !== undefined
      ? {
          ...shared,
          store: input.store,
          models: input.models,
          ...(input.fusion === undefined ? {} : { fusion: input.fusion }),
        }
      : { ...shared, store: input.store, model: input.model },
  );
}

function snapshotGuardrailPolicy(policy: GuardrailPolicy): GuardrailPolicy {
  return Object.freeze({
    ...policy,
    input: Object.freeze([...policy.input]),
    output: Object.freeze([...policy.output]),
  }) as GuardrailPolicy;
}
