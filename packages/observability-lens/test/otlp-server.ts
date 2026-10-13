import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type CapturedOtlpRequest = {
  url: string;
  authorization: string | undefined;
  body: string;
};

/** A span as Lens receives it over OTLP/HTTP JSON. */
export type ExportedSpan = {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  startTimeUnixNano: bigint;
  /** OTLP status code: 0 unset, 1 ok, 2 error. */
  statusCode: number;
  attributes: Record<string, unknown>;
};

export async function startOtlpServer(): Promise<{
  baseUrl: string;
  bodies(): string;
  requests(): readonly CapturedOtlpRequest[];
  spans(): ExportedSpan[];
  close(): Promise<void>;
}> {
  const received: CapturedOtlpRequest[] = [];
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      received.push({
        url: incoming.url ?? "",
        authorization: incoming.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
    });
  });
  const listening = new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await listening;
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    bodies: () => received.map((request) => request.body).join("\n"),
    requests: () => received,
    spans: () =>
      received
        .filter((request) => request.url === "/api/public/otel/v1/traces")
        .flatMap((request) => parseTraceExport(request.body)),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

type OtlpAnyValue = {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: number | string;
  doubleValue?: number;
  arrayValue?: { values?: OtlpAnyValue[] };
};

type OtlpTraceExport = {
  resourceSpans?: Array<{
    scopeSpans?: Array<{
      spans?: Array<{
        traceId: string;
        spanId: string;
        parentSpanId?: string;
        name: string;
        startTimeUnixNano: number | string;
        status?: { code?: number };
        attributes?: Array<{ key: string; value: OtlpAnyValue }>;
      }>;
    }>;
  }>;
};

function parseTraceExport(body: string): ExportedSpan[] {
  const payload = JSON.parse(body) as OtlpTraceExport;
  return (payload.resourceSpans ?? []).flatMap((resource) =>
    (resource.scopeSpans ?? []).flatMap((scope) =>
      (scope.spans ?? []).map((span) => ({
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId ?? "",
        name: span.name,
        startTimeUnixNano: BigInt(span.startTimeUnixNano),
        statusCode: span.status?.code ?? 0,
        attributes: Object.fromEntries(
          (span.attributes ?? []).map((attribute) => [attribute.key, anyValue(attribute.value)]),
        ),
      })),
    ),
  );
}

function anyValue(value: OtlpAnyValue): unknown {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.arrayValue !== undefined) return (value.arrayValue.values ?? []).map(anyValue);
  return undefined;
}
