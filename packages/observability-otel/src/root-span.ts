import {
  context,
  diag,
  ROOT_CONTEXT,
  type Span,
  type SpanOptions,
  TraceFlags,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import { isValidSpanId, isValidTraceId } from "./helpers.js";

/** Structurally matches the OpenTelemetry SDK `IdGenerator`, so no SDK dependency is required. */
export type OtelIdGenerator = {
  generateTraceId(): string;
  generateSpanId(): string;
};

type PendingTraceId = { traceId: string | undefined };

// Shared through globalThis so duplicate installed copies of this package agree on the request.
const pendingKey = Symbol.for("@anvia/otel.pending-root-trace-id");
const globals = globalThis as { [pendingKey]?: PendingTraceId };
const pending: PendingTraceId = (globals[pendingKey] ??= { traceId: undefined });

let warnedUnsupportedTracer = false;

/**
 * An SDK ID generator that lets Anvia start a root span inside a caller-supplied trace ID.
 *
 * OpenTelemetry can only place a span in an existing trace by giving it a parent, so a run that
 * supplies `trace.traceId` without `parentObservationId` would otherwise point at a parent that
 * never exists. Install this on the tracer provider (`new NodeTracerProvider({ idGenerator })`)
 * to keep such runs as real roots of the supplied trace. Every other ID comes from `base`.
 */
export function createAnviaIdGenerator(base: OtelIdGenerator = randomIdGenerator): OtelIdGenerator {
  return {
    generateTraceId() {
      const requested = pending.traceId;
      // Consumed once, so nothing started later in the same call stack inherits it.
      pending.traceId = undefined;
      return requested ?? base.generateTraceId();
    },
    generateSpanId() {
      return base.generateSpanId();
    },
  };
}

/**
 * Starts the root span of an agent or pipeline run.
 *
 * - With a valid `parentObservationId`, the span joins that parent in the supplied trace.
 * - With only a valid `traceId`, the span is a parentless root of that trace when the tracer uses
 *   {@link createAnviaIdGenerator}; other tracers produce a root in a trace of their own choosing.
 * - Without a valid `traceId`, the span follows the active context like any other span.
 */
export function startRootSpan(
  tracer: Tracer,
  name: string,
  options: SpanOptions,
  traceId: string | undefined,
  parentObservationId: string | undefined,
): Span {
  if (!isValidTraceId(traceId)) {
    return tracer.startSpan(name, options, context.active());
  }
  if (isValidSpanId(parentObservationId)) {
    const parent = trace.setSpanContext(ROOT_CONTEXT, {
      traceId,
      spanId: parentObservationId,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
    return tracer.startSpan(name, options, parent);
  }
  // startSpan is synchronous, so no other run can observe the pending ID between set and clear.
  pending.traceId = traceId;
  let span: Span;
  try {
    span = tracer.startSpan(name, { ...options, root: true }, ROOT_CONTEXT);
  } finally {
    pending.traceId = undefined;
  }
  if (span.isRecording() && span.spanContext().traceId !== traceId) {
    warnUnsupportedTracer();
  }
  return span;
}

function warnUnsupportedTracer(): void {
  if (warnedUnsupportedTracer) return;
  warnedUnsupportedTracer = true;
  diag.warn(
    "@anvia/otel: the tracer provider ignored a supplied trace ID, so runs that share one " +
      "(such as durable run attempts) are exported as separate traces. Configure the provider " +
      "with createAnviaIdGenerator() to keep them in one trace.",
  );
}

const randomIdGenerator: OtelIdGenerator = {
  generateTraceId: () => randomHex(16),
  generateSpanId: () => randomHex(8),
};

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  do {
    crypto.getRandomValues(values);
  } while (values.every((value) => value === 0));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}
