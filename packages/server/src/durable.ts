import { handleDurableTaskRequest } from "./durable-task";
import {
  DurableConflictError,
  DurableNotFoundError,
  DurableLimitError,
  DurableStorageError,
  type DurableRuntime,
  type DurableTraceOptions,
} from "@anvia/durable";
import {
  parseDurableListOptions,
  parseDurableResolution,
  parseDurableResponse,
  parseDurableSteering,
  parseDurableSubmission,
} from "@anvia/durable/protocol";
import {
  durableEventsResponse,
  HttpInputError,
  jsonResponse,
  listQuery,
  readJson,
  rejectClientTrace,
} from "./durable-http";
import { handleDurableGraphRequest } from "./durable-graph";

export type DurableHttpAction =
  | "list"
  | "submit"
  | "inspect"
  | "events"
  | "respond"
  | "steer"
  | "resolve-tool"
  | "retry"
  | "cancel"
  | "signal"
  | "resolve-effect";
export type DurableAuthorization = {
  action: DurableHttpAction;
  sessionId: string;
  runId?: string;
  /** Effective agent; task submissions authorize each declared dependency separately. */
  agentId?: string;
  graphId?: string;
  taskId?: string;
  rootTaskId?: string;
  taskName?: string;
};
export type DurableHandlerOptions = {
  runtime: DurableRuntime;
  /** Authenticate and authorize every operation, including reads. Deny by returning false. */
  authorize: (request: Request, resource: DurableAuthorization) => boolean | Promise<boolean>;
  /**
   * Observer trace context for an authorized run or task submission, such as the authenticated
   * user ID. Clients cannot set trace context themselves. Requires @anvia/durable 0.11 or newer.
   */
  trace?: (
    request: Request,
    resource: DurableAuthorization,
  ) => DurableTraceOptions | undefined | Promise<DurableTraceOptions | undefined>;
  basePath?: string;
  maxBodyBytes?: number;
};

/** Seconds sent in `Retry-After` on capacity 429s. A conservative hint, not a guarantee. */
const CAPACITY_RETRY_AFTER_SECONDS = 1;

/**
 * Warning text when the HTTP body limit is below the runtime payload limit, so a request can be
 * rejected with 413 although the runtime would accept it. Returns `undefined` when the limits are
 * equal or larger, or when the payload limit is unknown (for example an older runtime).
 */
export function durableBodyLimitWarning(
  maxBodyBytes: number,
  maxPayloadBytes: number | undefined,
): string | undefined {
  if (maxPayloadBytes === undefined || maxBodyBytes >= maxPayloadBytes) return undefined;
  return (
    `Durable HTTP body limit (${maxBodyBytes} bytes) is below the runtime payload limit ` +
    `(${maxPayloadBytes} bytes). Requests between the two are rejected with 413 before the ` +
    `runtime sees them, so multimodal prompts may not fit. Pass a larger maxBodyBytes to ` +
    `createDurableHandler if the agent accepts images or documents.`
  );
}

/** Emits the startup warning once. Never throws: a logging or old-runtime problem must not block startup. */
function warnIfBodyLimitBelowPayloadLimit(runtime: DurableRuntime, maxBodyBytes: number): void {
  try {
    // Runtimes before `limits()` throw here; the payload limit is then unknown and nothing is warned.
    const maxPayloadBytes = runtime.limits().maxPayloadBytes;
    const message = durableBodyLimitWarning(maxBodyBytes, maxPayloadBytes);
    if (message !== undefined) console.warn(message);
  } catch {
    // Ignore: the warning is advisory.
  }
}

/** Fetch-compatible routes. The application owns runtime startup, shutdown, and authentication. */
export function createDurableHandler(
  options: DurableHandlerOptions,
): (request: Request) => Promise<Response> {
  const basePath = options.basePath ?? "/durable";
  if (!basePath.startsWith("/") || basePath.endsWith("/") || /[?#]/.test(basePath))
    throw new TypeError("basePath must be an absolute path without a trailing slash.");
  if (typeof options.authorize !== "function")
    throw new TypeError("Durable routes require authorize.");
  const maxBodyBytes = options.maxBodyBytes ?? 65_536;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1)
    throw new TypeError("Invalid body limit.");
  const runtime = options.runtime;
  warnIfBodyLimitBelowPayloadLimit(runtime, maxBodyBytes);
  const json = jsonResponse;
  const denied = () => json({ error: "Forbidden" }, 403);

  return async (request) => {
    try {
      const url = new URL(request.url);
      const taskResponse = await handleDurableTaskRequest(options, request, basePath, maxBodyBytes);
      if (taskResponse !== undefined) return taskResponse;
      const graphResponse = await handleDurableGraphRequest(
        options,
        request,
        basePath,
        maxBodyBytes,
      );
      if (graphResponse !== undefined) return graphResponse;
      if (url.pathname !== `${basePath}/runs` && !url.pathname.startsWith(`${basePath}/runs/`))
        return json({ error: "Not found" }, 404);
      const parts = url.pathname
        .slice(`${basePath}/runs`.length)
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      if (parts.length === 0) {
        if (request.method === "GET") {
          const filter = parseDurableListOptions(listQuery(url));
          if (filter.sessionId === undefined) throw new TypeError("Listing requires sessionId.");
          if (!(await options.authorize(request, { action: "list", sessionId: filter.sessionId })))
            return denied();
          const page = await runtime.listRuns(filter);
          for (const run of page.runs)
            if (
              !(await options.authorize(request, { action: "list", ...runtime.runScope(run.id) }))
            )
              return denied();
          return json(page);
        }
        if (request.method === "POST") {
          const body = await readJson(request, maxBodyBytes);
          rejectClientTrace(body);
          const { enqueue, ...submission } = parseDurableSubmission(body);
          const resource: DurableAuthorization = {
            action: "submit",
            sessionId: submission.sessionId,
            agentId: submission.agentId,
          };
          if (!(await options.authorize(request, resource))) return denied();
          const trace = await options.trace?.(request, resource);
          const run = await runtime.submit(
            trace === undefined ? submission : { ...submission, trace },
            enqueue === undefined ? {} : { enqueue },
          );
          return json(await run.snapshot(), 202);
        }
        return json({ error: "Method not allowed" }, 405);
      }
      const id = parts[0]!;
      const suffix = parts[1];
      if (
        parts.length > 2 ||
        (suffix !== undefined &&
          !["events", "steer", "respond", "resolve-tool", "retry", "cancel"].includes(suffix))
      )
        return json({ error: "Not found" }, 404);
      const action: DurableHttpAction =
        suffix === undefined ? "inspect" : (suffix as DurableHttpAction);
      const method = action === "inspect" || action === "events" ? "GET" : "POST";
      if (request.method !== method) return json({ error: "Method not allowed" }, 405);
      const run = await runtime.getRun(id);
      const snapshot = await run.snapshot();
      if (!(await options.authorize(request, { action, ...runtime.runScope(id) }))) return denied();
      if (action === "inspect") return json(snapshot);
      if (action === "events")
        return durableEventsResponse(request, snapshot.cursor, (options) => run.stream(options));
      if (action === "steer") {
        const body = parseDurableSteering(await readJson(request, maxBodyBytes));
        return json(
          await run.steer(
            body.input,
            body.requestId === undefined ? {} : { requestId: body.requestId },
          ),
          202,
        );
      }
      if (action === "respond") {
        const body = parseDurableResponse(await readJson(request, maxBodyBytes));
        await run.respond(body.interactionId, body.response);
      } else if (action === "resolve-tool") {
        const body = parseDurableResolution(await readJson(request, maxBodyBytes));
        await run.resolveTool(body.operationId, body.output);
      } else if (action === "retry") {
        await run.retry();
      } else if (action === "cancel") {
        await run.cancel();
      }
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof HttpInputError)
        return json({ error: error.message, ...error.details }, error.status);
      if (error instanceof DurableNotFoundError)
        return json({ error: "Durable resource not found" }, 404);
      // A payload limit can never succeed for the same request; capacity may clear later.
      if (error instanceof DurableLimitError) {
        const body: { error: string; code: string; field?: string } = {
          error: error.message,
          code: error.code,
        };
        if (error.field !== undefined) body.field = error.field;
        if (error.code === "payload_too_large") return json(body, 413);
        return json(body, 429, { "retry-after": String(CAPACITY_RETRY_AFTER_SECONDS) });
      }
      if (error instanceof DurableStorageError)
        return json({ error: "Durable runtime unavailable" }, 503);
      if (error instanceof DurableConflictError) return json({ error: error.message }, 409);
      if (error instanceof TypeError || error instanceof SyntaxError || error instanceof URIError)
        return json({ error: "Invalid durable request" }, 400);
      return json({ error: "Durable request failed" }, 500);
    }
  };
}
