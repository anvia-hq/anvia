---
title: Production Readiness
description: The pattern checklist for deploying agent workflows safely.
section: examples
sidebar:
  group: Quality and Operations
  order: 4
---

Production readiness checks whether the application boundary is strong enough for real users, data, and side effects.

## Scenario

The support agent is moving from internal testing to public customer traffic.

## Checklist Example

```ts
export const supportReadiness = {
  runner: {
    validatesInput: true,
    mapsKnownFailures: true,
    hasDirectTests: true,
  },
  tools: {
    scopedByTenant: true,
    enforcePermissions: true,
    validateOutputs: true,
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
  },
  operations: {
    timeoutMs: 30_000,
    maxTurns: 4,
    evalSuite: "support-smoke",
  },
};
```

Use the checklist to block launch, not as documentation after launch.

## Failure Modes

- Launch checklist is not tied to a concrete runner.
- Side-effect tools have no idempotency story.
- Timeouts and turn limits are left at development defaults.
- No one can replay or debug a bad answer.

## Next Patterns

- [Guarded Side Effects](/docs/examples/guarded-side-effects)
- [Observability Loop](/docs/examples/observability-loop)
- [Support Agent](/docs/examples/support-agent)
