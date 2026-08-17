import type { GuardrailPolicy } from "../guardrails";
import { assertFiniteMinScore, assertPositiveSearchLimit } from "../internal/vector-search-options";
import type { AgentObservabilityOptions, AgentObserverMap } from "../observability";
import type { VectorSearchResult } from "../vector-store";
import type { AgentContextInput, AgentMemory } from "./types";
import {
  isVectorContext,
  type VectorContext,
  type VectorContextBaseOptions,
} from "./vector-context";

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
  let snapshot: AgentObservabilityOptions = {
    observers: Object.freeze(observers),
    errorPolicy,
  };
  if (observability.primaryTrace !== undefined) {
    snapshot = { ...snapshot, primaryTrace: observability.primaryTrace };
  }
  return Object.freeze(snapshot);
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
  let snapshot: AgentMemory = {
    store: memory.store,
    savePolicy: memory.savePolicy,
  };
  if (compaction !== undefined) {
    snapshot = { ...snapshot, compaction };
  }
  return Object.freeze(snapshot);
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
    let document: AgentContextInput<T> = {
      id: input.id,
      text: input.text,
    };
    if (input.additionalProps !== undefined) {
      document = {
        ...document,
        additionalProps: cloneFrozenPlainData(input.additionalProps),
      };
    }
    return Object.freeze(document);
  }
  const format = input.format;
  let shared: VectorContextBaseOptions<T> & {
    kind: "vector-context";
    store: VectorContext<T>["store"];
  } = {
    kind: "vector-context" as const,
    store: input.store,
    topK: input.topK,
  };
  if (input.minScore !== undefined) {
    shared = { ...shared, minScore: input.minScore };
  }
  if (input.filter !== undefined) {
    shared = { ...shared, filter: cloneFrozenPlainData(input.filter) };
  }
  if (input.retries !== undefined) {
    shared = { ...shared, retries: cloneFrozenPlainData(input.retries) };
  }
  if (format !== undefined) {
    shared = {
      ...shared,
      format: (result: VectorSearchResult<T>) => format.call(input, result),
    };
  }
  if (!("models" in input) || input.models === undefined) {
    return Object.freeze<VectorContext<T>>({ ...shared, store: input.store, model: input.model });
  }
  let context: VectorContext<T> = {
    ...shared,
    store: input.store,
    models: input.models,
  };
  if (input.fusion !== undefined) {
    context = { ...context, fusion: input.fusion };
  }
  return Object.freeze(context);
}

function snapshotGuardrailPolicy(policy: GuardrailPolicy): GuardrailPolicy {
  return Object.freeze({
    ...policy,
    input: Object.freeze([...policy.input]),
    output: Object.freeze([...policy.output]),
  }) as GuardrailPolicy;
}
