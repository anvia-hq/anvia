# Observability

Studio's own surfaces (realtime log stream, trace browser, status dashboard)
cover development. Production-like auditing needs the observability packages:

- `@anvia/langfuse` — tracing, eval reporting, scoring, prompt/dataset helpers.
- `@anvia/otel` — OpenTelemetry adapters.
- `@anvia/lens` — native Lens integration (see the cookbook's lens-native example).

## Rules

- Close observability clients in Studio's `onShutdown` — they are caller-owned
  resources and outlive runs:

```ts
await new Studio([agent]).serve({
  port: 4021,
  shutdownTimeoutMs: 30_000,
  onShutdown: async () => {
    await Promise.all([lens.close(), langfuse.close(), otelSdk.shutdown()]); // otelSdk is your OTel SDK instance, not an Anvia export
  },
});
```

- Redact before export: `createPiiRedactor` ships with both `@anvia/langfuse`
  and `@anvia/lens`. Wrap exporters with it so customer data never reaches
  trace payloads in the first place.
- For application logs alongside traces, `@anvia/logger` provides
  `createConsoleLogger`, `createPinoLogger`, and `createLoggerObserver`.
- Report evals to observability (Langfuse eval reporting, trace refs via
  `resolveEvalTraceRef`) when runs must be auditable — see the `anvia-evals`
  skill's `references/running.md`.
- Never commit keys, private prompts, customer data, or trace payloads. Read
  credentials from the environment at the boundary, same as provider keys.
