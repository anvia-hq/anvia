---
title: Readiness checklist
description: Review production requirements before shipping an agent.
section: advanced
sidebar:
  group: Quality and operations
  order: 55
---

Use this checklist before an agent handles real users, private data, side effects, or production support workflows.

The goal is not to make every workflow heavy. The goal is to make ownership clear before the model is in the path.

## Runtime Boundary

Ready means:

- routes call named runners instead of embedding all prompt logic inline
- stable agent ids are used for traces, sessions, Studio, and evals
- provider clients and secrets stay server-side
- request-scoped user, tenant, feature flags, services, and transactions are explicit
- every agent has a default turn limit
- known errors are mapped at the runner boundary

## Tools And Actions

Ready means:

- every tool has input validation
- important tool outputs are typed or validated
- data-bearing tools check actor and tenant scope
- side-effect tools use service-layer transactions or idempotency
- sensitive actions have audit records
- approval workflows cover accepted, rejected, and timeout paths
- high-risk tools are tested without a provider call

## Context, Retrieval, And Memory

Ready means:

- instructions hold durable behavior
- request facts are loaded by the runner, not hidden in the user prompt
- retrieval filters enforce tenant and access boundaries
- retrieval quality is tested with representative prompts
- memory is configured through `.memory(...)` and `.session(...)` when conversations are durable
- event store is not treated as conversation memory
- retention policy exists for memory, traces, event records, and audit logs

## Streaming And UI

Ready means:

- browser streams receive only product-safe events
- private tool arguments, tool results, reasoning, and provider metadata are filtered out
- final events and error events have a defined UI behavior
- proxies and hosting platforms do not buffer streams that need live output
- cancellation behavior is clear when users close the connection

## Observability

Ready means:

- every workflow uses stable trace names
- trace metadata contains safe correlation ids
- `traceId` is logged with product events where debugging needs it
- usage is captured for cost and regression analysis
- observers flush or shutdown during application shutdown
- Studio or another internal surface can inspect local runs safely

## Testing And Evals

Ready means:

- tools, services, filters, and runners have fake-based tests
- provider smoke tests cover configured model capabilities
- eval cases cover known prompts and regressions
- retrieval tests cover missing, ambiguous, and permission-sensitive context
- approval and guardrail tests cover denied paths
- eval results are reviewed before prompt, model, retrieval, or tool changes ship

## Deployment And Rollback

Ready means:

- model ids and provider config are versioned
- prompt or instruction versions are visible in traces
- tool catalogs and dynamic indexes are built at explicit boundaries
- queues own long-running or retried workflows
- side-effect retries are safe or disabled
- rollout can return to a previous model, prompt, or tool catalog
- deployment checks fail fast for missing credentials or unavailable required services

## Final Smoke Test

Before launch, run one safe workflow end to end:

- construct the real runner with production-like config
- use sandbox or read-only services
- attach observer and trace metadata
- use a prompt that should not trigger risky tools
- verify output, usage, trace id, and product response mapping

For tool workflows, add one read-only tool smoke test. For side-effect workflows, run only against sandbox services with explicit idempotency and audit records.
