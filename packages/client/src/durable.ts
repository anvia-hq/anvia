import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import type { ToolResultOutput } from "@anvia/core/completion";
import {
  parseDurableEvent,
  parseDurableGraphSnapshot,
  parseDurableGraphEvent,
  parseDurableGraphPage,
  type DurableGraphSubmission,
  type DurableGraphSnapshot,
  type DurableGraphListOptions,
  type DurableGraphPage,
  type DurableGraphEvent,
  parseDurableRunPage,
  parseDurableSnapshot,
  type DurableEvent,
  type DurableListOptions,
  type DurableRunPage,
  type DurableSnapshot,
  type DurableSubmission,
  type DurableSubmitOptions,
} from "@anvia/durable/protocol";
import { readSseStream } from "./transport/streams";

export type DurableRequestOptions = { abortSignal?: AbortSignal };
export type DurableClientOptions = {
  /** Absolute HTTP(S) URL matching the server handler's basePath. */
  endpoint: string;
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
};
export class DurableHttpError extends Error {
  constructor(readonly status: number) {
    super(`Durable request failed with HTTP ${status}.`);
    this.name = "DurableHttpError";
  }
}

/** Browser-safe HTTP client. Reconnect explicitly using a snapshot or last applied event cursor. */
export class DurableClient {
  private readonly endpoint: string;
  constructor(private readonly options: DurableClientOptions) {
    const endpoint = new URL(options.endpoint);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.username ||
      endpoint.password
    )
      throw new TypeError(
        "endpoint must be an HTTP(S) base URL without credentials, query, or fragment.",
      );
    this.endpoint = endpoint.href.replace(/\/$/, "");
  }

  async submitGraph(
    submission: DurableGraphSubmission,
    options: DurableRequestOptions = {},
  ): Promise<DurableGraphSnapshot> {
    return parseDurableGraphSnapshot(
      await (await this.request("/graphs", "POST", submission, options)).json(),
    );
  }
  async graphSnapshot(
    graphId: string,
    options: DurableRequestOptions = {},
  ): Promise<DurableGraphSnapshot> {
    const snapshot = parseDurableGraphSnapshot(
      await (await this.request(this.graphPath(graphId), "GET", undefined, options)).json(),
    );
    if (snapshot.id !== graphId) throw new TypeError("Snapshot belongs to another graph.");
    return snapshot;
  }
  async listGraphs(
    filter: DurableGraphListOptions & { sessionId: string },
    options: DurableRequestOptions = {},
  ): Promise<DurableGraphPage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filter))
      if (value !== undefined) query.set(key, String(value));
    return parseDurableGraphPage(
      await (await this.request(`/graphs?${query}`, "GET", undefined, options)).json(),
    );
  }
  async cancelGraph(graphId: string, options: DurableRequestOptions = {}): Promise<void> {
    await this.request(`${this.graphPath(graphId)}/cancel`, "POST", undefined, options);
  }
  async *streamGraph(
    graphId: string,
    options: DurableRequestOptions & { after?: number } = {},
  ): AsyncIterable<DurableGraphEvent> {
    let cursor = options.after ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError("Invalid graph cursor.");
    const response = await this.request(
      `${this.graphPath(graphId)}/events?after=${cursor}`,
      "GET",
      undefined,
      options,
    );
    if (
      !response.headers.get("content-type")?.startsWith("text/event-stream") ||
      response.body === null
    )
      throw new TypeError("Expected a graph SSE response.");
    for await (const value of readSseStream<unknown>(response.body)) {
      options.abortSignal?.throwIfAborted();
      const event = parseDurableGraphEvent(value);
      if (event.graphId !== graphId || event.sequence <= cursor)
        throw new TypeError("Invalid graph event order or ID.");
      cursor = event.sequence;
      yield event;
    }
  }

  async submit(
    submission: DurableSubmission,
    options: DurableSubmitOptions & DurableRequestOptions = {},
  ): Promise<DurableSnapshot> {
    return parseDurableSnapshot(
      await (
        await this.request(
          "/runs",
          "POST",
          { ...submission, ...(options.enqueue === undefined ? {} : { enqueue: options.enqueue }) },
          options,
        )
      ).json(),
    );
  }
  async listRuns(
    filter: DurableListOptions & { sessionId: string },
    options: DurableRequestOptions = {},
  ): Promise<DurableRunPage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filter))
      if (value !== undefined) query.set(key, String(value));
    return parseDurableRunPage(
      await (await this.request(`/runs?${query}`, "GET", undefined, options)).json(),
    );
  }
  async snapshot(runId: string, options: DurableRequestOptions = {}): Promise<DurableSnapshot> {
    const snapshot = parseDurableSnapshot(
      await (await this.request(this.path(runId), "GET", undefined, options)).json(),
    );
    if (snapshot.run.id !== runId) throw new TypeError("Durable snapshot belongs to another run.");
    return snapshot;
  }
  async *stream(
    runId: string,
    options: DurableRequestOptions & { after?: number } = {},
  ): AsyncIterable<DurableEvent> {
    let cursor = options.after ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError("Invalid event cursor.");
    const response = await this.request(
      `${this.path(runId)}/events?after=${cursor}`,
      "GET",
      undefined,
      options,
    );
    if (
      !response.headers.get("content-type")?.startsWith("text/event-stream") ||
      response.body === null
    )
      throw new TypeError("Expected a durable SSE response.");
    for await (const value of readSseStream<unknown>(response.body)) {
      options.abortSignal?.throwIfAborted();
      const event = parseDurableEvent(value);
      if (event.runId !== runId || event.sequence <= cursor)
        throw new TypeError("Invalid durable event order or run ID.");
      cursor = event.sequence;
      yield event;
    }
  }
  async respond(
    runId: string,
    interactionId: string,
    response: AgentInteractionResponse,
    options: DurableRequestOptions = {},
  ): Promise<void> {
    await this.request(`${this.path(runId)}/respond`, "POST", { interactionId, response }, options);
  }
  async resolveTool(
    runId: string,
    operationId: string,
    output: ToolResultOutput,
    options: DurableRequestOptions = {},
  ): Promise<void> {
    await this.request(
      `${this.path(runId)}/resolve-tool`,
      "POST",
      { operationId, output },
      options,
    );
  }
  async retry(runId: string, options: DurableRequestOptions = {}): Promise<void> {
    await this.request(`${this.path(runId)}/retry`, "POST", undefined, options);
  }
  async cancel(runId: string, options: DurableRequestOptions = {}): Promise<void> {
    await this.request(`${this.path(runId)}/cancel`, "POST", undefined, options);
  }

  private graphPath(id: string): string {
    if (id.trim().length === 0 || id === "." || id === "..")
      throw new TypeError("Invalid graphId.");
    return `/graphs/${encodeURIComponent(id)}`;
  }
  private path(id: string): string {
    if (id.trim().length === 0) throw new TypeError("runId must not be empty.");
    return `/runs/${encodeURIComponent(id)}`;
  }
  private async request(
    path: string,
    method: string,
    body: unknown,
    options: DurableRequestOptions,
  ): Promise<Response> {
    options.abortSignal?.throwIfAborted();
    const supplied =
      typeof this.options.headers === "function"
        ? await this.options.headers()
        : this.options.headers;
    const headers = new Headers(supplied);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await (this.options.fetch ?? globalThis.fetch)(`${this.endpoint}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(options.abortSignal === undefined ? {} : { signal: options.abortSignal }),
      ...(this.options.credentials === undefined ? {} : { credentials: this.options.credentials }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DurableHttpError(response.status);
    }
    return response;
  }
}
