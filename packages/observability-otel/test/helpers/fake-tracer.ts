import {
  type Attributes,
  type Context,
  type Span,
  type SpanOptions,
  type SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";

export class FakeTracer {
  readonly spans: FakeSpan[] = [];
  private nextId = 2;
  readonly tracer: Tracer = {
    startSpan: (name: string, options: SpanOptions = {}, parentContext?: Context) => {
      const parent = parentContext === undefined ? undefined : trace.getSpanContext(parentContext);
      const span = new FakeSpan(name, options, {
        traceId: parent?.traceId ?? this.nextTraceId(),
        spanId: this.nextSpanId(),
        traceFlags: parent?.traceFlags ?? 1,
      });
      span.parentSpanId = parent?.spanId;
      this.spans.push(span);
      return span.span;
    },
    startActiveSpan: () => {
      throw new Error("startActiveSpan is not used by this adapter");
    },
  } as Tracer;

  private nextTraceId(): string {
    const value = this.nextId++;
    return value.toString(16).padStart(32, "0");
  }

  private nextSpanId(): string {
    const value = this.nextId++;
    return value.toString(16).padStart(16, "0");
  }
}

export class FakeSpan {
  attributes: Attributes = {};
  events: Array<{ name: string; attributes?: unknown; timestamp?: unknown }> = [];
  exceptions: unknown[] = [];
  status: { code: SpanStatusCode; message?: string } | undefined;
  ended = false;
  parentSpanId: string | undefined;

  constructor(
    readonly name: string,
    readonly options: SpanOptions,
    readonly spanContextValue: ReturnType<Span["spanContext"]>,
  ) {
    Object.assign(this.attributes, options.attributes);
  }

  readonly span: Span = {
    spanContext: () => this.spanContextValue,
    setAttribute: (key, value) => {
      this.attributes[key] = value;
      return this.span;
    },
    setAttributes: (attributes) => {
      this.attributes = { ...this.attributes, ...attributes };
      return this.span;
    },
    addEvent: (name, attributes, timestamp) => {
      this.events.push({ name, attributes, timestamp });
      return this.span;
    },
    addLink: () => this.span,
    addLinks: () => this.span,
    setStatus: (status) => {
      this.status = status;
      return this.span;
    },
    updateName: () => this.span,
    end: () => {
      this.ended = true;
    },
    isRecording: () => true,
    recordException: (exception) => {
      this.exceptions.push(exception);
    },
  };
}
