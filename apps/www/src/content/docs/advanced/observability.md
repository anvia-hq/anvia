---
title: Observability
description: Observe runs, generations, tool calls, and trace metadata.
section: advanced
sidebar:
  group: Quality and operations
  order: 50
---

Observability gives you evidence for what happened during an agent run: prompt input, model generations, tool calls, usage, errors, trace metadata, and returned trace ids.

Use observers for runtime telemetry. Use product logs and audit records for product accountability. They should link to each other through stable ids, but they are not the same storage system.

## Attach An Observer

```ts
import { AgentBuilder } from "@anvia/core";
import { createObserver } from "@anvia/core/observability";

const observer = createObserver({
  startRun(args) {
    runtimeLog.info({
      traceName: args.trace?.name,
      agentName: args.agentName,
      maxTurns: args.maxTurns,
    });

    return {
      startGeneration({ turn, modelInfo }) {
        const startedAt = Date.now();

        return {
          end({ response, firstDeltaMs }) {
            runtimeLog.info({
              turn,
              provider: modelInfo?.provider,
              usage: response.usage,
              firstDeltaMs,
              durationMs: Date.now() - startedAt,
            });
          },
          error({ error }) {
            runtimeLog.error({ turn, error }, "generation failed");
          },
        };
      },
      startTool({ toolName, internalCallId }) {
        const startedAt = Date.now();

        return {
          end({ skipped }) {
            runtimeLog.info({
              toolName,
              internalCallId,
              skipped,
              durationMs: Date.now() - startedAt,
            });
          },
          error({ error }) {
            runtimeLog.error({ toolName, internalCallId, error }, "tool failed");
          },
        };
      },
      end({ output, usage }) {
        runtimeLog.info({ usage, outputLength: output.length }, "run completed");
      },
      error({ error, usage }) {
        runtimeLog.error({ error, usage }, "run failed");
      },
    };
  },
});

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly.")
  .observe(observer)
  .build();
```

Observers are attached to the agent. Trace details are attached to the request.

## Trace Metadata

Use `.withTrace(...)` at the runner boundary:

```ts
const request = agent
  .session(conversationId, {
    userId: user.id,
    metadata: { tenantId: user.tenantId },
  })
  .prompt(message)
  .withTrace({
    name: "support-chat",
    userId: user.id,
    sessionId: conversationId,
    tags: ["support", channel],
    version: config.promptVersion,
    metadata: {
      tenantId: user.tenantId,
      conversationId,
      channel,
    },
  });

const response = await request.send();

runtimeLog.info({
  traceId: response.trace?.traceId,
  observationId: response.trace?.observationId,
  conversationId,
});
```

Trace metadata should connect systems. Keep it small and safe: ids, workflow names, version strings, channels, feature flags, and tenant ids when allowed.

Do not put secrets, full customer records, raw documents, or unbounded objects in trace metadata.

## Observer Lifecycle

An observer can see three nested levels:

- run observers for the whole agent request
- generation observers for each model turn
- tool observers for each tool call

Streaming runs can also call generation `update(...)` for deltas and tool `streamEvent(...)` for tool stream events. Non-streaming runs do not call generation updates.

## Observer Arguments

Observer callback argument types are exported from `@anvia/core/observability` for integrations:

- `AgentRunStartArgs`, `AgentRunEndArgs`, and `AgentRunErrorArgs` cover the whole agent request, including prompt, history, trace options, max turns, final output, usage, and messages.
- `AgentGenerationStartArgs`, `AgentGenerationEndArgs`, `AgentGenerationErrorArgs`, and `AgentGenerationUpdateArgs` cover each model turn, including the provider-neutral request, optional provider trace request, model info, response, deltas, and timing.
- `AgentToolStartArgs`, `AgentToolEndArgs`, `AgentToolErrorArgs`, and `AgentToolStreamEventArgs` cover tool execution, including tool names, raw args, call ids, metadata, results, skipped state, and streamed child events.

Use these types when writing an adapter to OpenTelemetry, Langfuse, product logs, or an internal tracing system. Keep the adapter tolerant of optional fields because providers and runtime paths do not all expose the same metadata.

## Strict Mode

Observer failures are swallowed by default so telemetry does not take down the product path. Enable strict behavior only where telemetry must be part of the test or job contract:

```ts
const response = await agent
  .prompt("Run the smoke test.")
  .withTrace({
    name: "support-smoke-test",
    failOnObserverError: true,
  })
  .send();
```

You can also pass `failOnObserverError` when registering an observer with `.observe(...)`.

## Flush And Shutdown

Long-lived observer integrations may buffer data:

```ts
await observer.flush?.();
await observer.shutdown?.();
```

Flush before process exit when pending trace data matters. Shutdown during application shutdown for integrations with background resources.

## Observability Versus Event Store

Use observers for traces, usage, external telemetry, and dashboards. Use the event store for persisted runtime stream events by run id. Use memory for future prompts. Use product audit tables for sensitive product decisions.

These systems can share ids, but each has a different retention policy and access model.
