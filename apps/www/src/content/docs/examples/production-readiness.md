---
title: Production Readiness
description: A checklist pattern for deploying agent workflows safely.
section: examples
sidebar:
  group: Quality and Operations
  order: 4
---

Production readiness checks whether the application boundary is strong enough for real users, real data, and real side effects. Use the checklist to block launch, not as documentation after launch.

## Scenario

The support agent is moving from internal testing to public customer traffic.

## Checklist Example

```ts
export const supportReadiness = {
  runner: {
    validatesInput: true,
    mapsKnownFailures: true,
    hasDirectTests: true,
    storesProductResult: true,
  },
  models: {
    defaultModel: "gpt-5.5",
    providerSmokeTests: ["streaming", "tools", "dynamic-context"],
    capabilityChecksBeforePromptBuild: true,
  },
  retrieval: {
    filtersByTenant: true,
    filtersByVisibility: true,
    logsEvidenceIds: true,
    ingestionRefreshOwner: "support-knowledge-worker",
  },
  tools: {
    scopedByTenant: true,
    enforcePermissions: true,
    validateOutputs: true,
    returnSafeDenials: true,
  },
  sideEffects: {
    idempotencyKeys: true,
    approvalForRestrictedWrites: true,
    auditRecords: true,
  },
  observability: {
    traceName: "support-chat",
    includesUserAndTenant: true,
    storesRuntimeEvents: true,
    linksEvalResults: true,
  },
  operations: {
    timeoutMs: 30_000,
    maxTurns: 4,
    evalSuite: "support-regression",
    rollbackOwner: "support-platform",
  },
};
```

## Launch Gate

```ts
export function assertReady(checklist: typeof supportReadiness) {
  const blockers = [
    !checklist.runner.hasDirectTests && "runner tests missing",
    !checklist.retrieval.filtersByTenant && "tenant retrieval filter missing",
    !checklist.tools.enforcePermissions && "tool permissions missing",
    !checklist.sideEffects.idempotencyKeys && "idempotency missing",
    !checklist.observability.includesUserAndTenant && "trace metadata incomplete",
  ].filter(Boolean);

  if (blockers.length > 0) {
    throw new Error(`Support agent is not launch-ready: ${blockers.join(", ")}`);
  }
}
```

## Failure Modes

- Launch checklist is not tied to a concrete runner.
- Side-effect tools have no idempotency story.
- Timeouts and turn limits are left at development defaults.
- No one can replay or debug a bad answer.
- Retrieval and tool permissions are checked only through prompt wording.

## Next Patterns

- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Observability Loop](/docs/examples/observability-loop)
- [Support Agent](/docs/examples/support-agent)
