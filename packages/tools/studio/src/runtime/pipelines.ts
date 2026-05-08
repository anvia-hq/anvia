import type { JsonValue, PipelineRunEvent } from "@anvia/core";
import type { Context, Hono } from "hono";
import { stream as streamResponse } from "hono/streaming";
import type {
  AgentRunStreamEvent,
  StudioPipeline,
  StudioPipelineDetail,
  StudioPipelineLogStore,
  StudioPipelineRunRequest,
  StudioPipelineRunResponse,
} from "../types";
import {
  appendPipelineLog,
  emitPipelineLog,
  pipelineRunCompletedLog,
  pipelineRunFailedLog,
  pipelineRunReceivedLog,
  pipelineRunStartedLog,
  pipelineStageLog,
} from "./pipeline-logs";
import { AsyncEventQueue } from "./runs";
import { errorResponse, isJsonObject, isObject, pipelineConfig, serializeError } from "./shared";

export function registerPipelineRoutes(
  app: Hono,
  props: {
    pipelines: StudioPipeline[];
    pipelineMap: Map<string, StudioPipeline>;
    store?: StudioPipelineLogStore;
  },
): void {
  app.get("/pipelines", (c) =>
    c.json({
      pipelines: props.pipelines.map(pipelineConfig),
    }),
  );

  app.get("/pipelines/:pipelineId", (c) => {
    const pipeline = props.pipelineMap.get(c.req.param("pipelineId"));
    if (pipeline === undefined) {
      return errorResponse(c, 404, "not_found", "Pipeline not found");
    }
    return c.json(pipelineDetail(pipeline));
  });

  app.get("/pipelines/:pipelineId/logs", async (c) => {
    const pipelineId = c.req.param("pipelineId");
    if (!props.pipelineMap.has(pipelineId)) {
      return errorResponse(c, 404, "not_found", "Pipeline not found");
    }
    if (props.store === undefined) {
      return errorResponse(
        c,
        501,
        "unsupported_capability",
        'Capability "pipelines.logs" is not implemented by this runner',
        { capability: "pipelines", operation: "logs" },
      );
    }

    const limit = parsePipelineLogLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }
    const after = parsePipelineLogAfter(c.req.query("after"));
    if (after === false) {
      return errorResponse(c, 400, "bad_request", "after must be a non-negative integer");
    }

    const logs = await props.store.listPipelineLogs({
      pipelineId,
      limit,
      ...(after === undefined ? {} : { after }),
    });
    const last = logs.at(-1);
    return c.json({
      logs,
      ...(logs.length === limit && last !== undefined ? { nextCursor: last.sequence } : {}),
    });
  });

  app.post("/pipelines/:pipelineId/runs", async (c) => {
    const pipeline = props.pipelineMap.get(c.req.param("pipelineId"));
    if (pipeline === undefined) {
      return errorResponse(c, 404, "not_found", "Pipeline not found");
    }

    const body = await parsePipelineRunRequest(c);
    if ("error" in body) {
      return body.error;
    }

    const runId = globalThis.crypto.randomUUID();
    const startedAt = Date.now();
    await appendPipelineLog(
      props.store,
      pipelineRunReceivedLog({
        pipeline,
        runId,
        stream: body.stream === true,
        input: body.input,
        ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
      }),
    );

    if (body.stream === true) {
      return streamPipelineRun(c, {
        pipeline,
        runId,
        input: body.input,
        startedAt,
        ...(props.store === undefined ? {} : { store: props.store }),
      });
    }

    try {
      await appendPipelineLog(props.store, pipelineRunStartedLog(pipeline, runId));
      const output = await pipeline.pipeline.run(body.input, {
        observer: {
          async onEvent(event) {
            await appendPipelineLog(props.store, pipelineStageLog(pipeline.id, runId, event));
          },
        },
      });
      const jsonOutput = toJsonValue(output);
      await appendPipelineLog(
        props.store,
        pipelineRunCompletedLog({
          pipelineId: pipeline.id,
          runId,
          durationMs: Date.now() - startedAt,
          output: jsonOutput,
        }),
      );
      const response: StudioPipelineRunResponse = {
        runId,
        pipelineId: pipeline.id,
        output: jsonOutput,
      };
      return c.json(response);
    } catch (error) {
      await appendPipelineLog(
        props.store,
        pipelineRunFailedLog(pipeline.id, runId, error, startedAt),
      );
      return errorResponse(c, 500, "internal_error", "Pipeline run failed", serializeError(error));
    }
  });
}

function pipelineDetail(pipeline: StudioPipeline): StudioPipelineDetail {
  const graph = pipeline.pipeline.graph();
  graph.id = pipeline.id;
  return {
    ...pipelineConfig(pipeline),
    graph,
  };
}

function streamPipelineRun(
  c: Context,
  props: {
    pipeline: StudioPipeline;
    runId: string;
    input: JsonValue;
    startedAt: number;
    store?: StudioPipelineLogStore;
  },
): Response {
  c.header("content-type", "application/x-ndjson; charset=utf-8");
  c.header("cache-control", "no-cache, no-transform");
  c.header("connection", "keep-alive");
  c.header("transfer-encoding", "chunked");
  c.header("x-accel-buffering", "no");

  return streamResponse(
    c,
    async (stream) => {
      for await (const event of pipelineRunEvents(props)) {
        await stream.write(`${JSON.stringify(event)}\n`);
      }
    },
    async (error, stream) => {
      await stream.write(`${JSON.stringify({ type: "error", error: serializeError(error) })}\n`);
    },
  );
}

async function* pipelineRunEvents(props: {
  pipeline: StudioPipeline;
  runId: string;
  input: JsonValue;
  startedAt: number;
  store?: StudioPipelineLogStore;
}): AsyncIterable<AgentRunStreamEvent> {
  yield* emitPipelineLog(props.store, pipelineRunStartedLog(props.pipeline, props.runId));

  const events = new AsyncEventQueue<AgentRunStreamEvent>();
  const run = props.pipeline.pipeline
    .run(props.input, {
      observer: {
        async onEvent(event: PipelineRunEvent) {
          const log = await appendPipelineLog(
            props.store,
            pipelineStageLog(props.pipeline.id, props.runId, event),
          );
          if (log !== undefined) {
            events.push({ type: "pipeline_log", log });
          }
        },
      },
    })
    .then(async (output) => {
      const jsonOutput = toJsonValue(output);
      const log = await appendPipelineLog(
        props.store,
        pipelineRunCompletedLog({
          pipelineId: props.pipeline.id,
          runId: props.runId,
          durationMs: Date.now() - props.startedAt,
          output: jsonOutput,
        }),
      );
      if (log !== undefined) {
        events.push({ type: "pipeline_log", log });
      }
      events.push({
        type: "pipeline_final",
        runId: props.runId,
        pipelineId: props.pipeline.id,
        output: jsonOutput,
      });
    })
    .catch(async (error) => {
      const log = await appendPipelineLog(
        props.store,
        pipelineRunFailedLog(props.pipeline.id, props.runId, error, props.startedAt),
      );
      if (log !== undefined) {
        events.push({ type: "pipeline_log", log });
      }
      events.push({ type: "error", error: serializeError(error) } as AgentRunStreamEvent);
    })
    .finally(() => events.close());

  try {
    while (true) {
      const next = await events.next();
      if (next.done === true) {
        break;
      }
      yield next.value;
    }
  } finally {
    await run;
  }
}

async function parsePipelineRunRequest(
  c: Context,
): Promise<StudioPipelineRunRequest | { error: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be JSON") };
  }

  if (!isObject(body)) {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be an object") };
  }
  if (!("input" in body) || !isJsonValue(body.input)) {
    return { error: errorResponse(c, 400, "bad_request", "input must be JSON-compatible") };
  }

  const request: StudioPipelineRunRequest = {
    input: body.input,
  };
  if ("stream" in body) {
    if (typeof body.stream !== "boolean") {
      return { error: errorResponse(c, 400, "bad_request", "stream must be a boolean") };
    }
    request.stream = body.stream;
  }
  if ("metadata" in body) {
    if (!isJsonObject(body.metadata)) {
      return { error: errorResponse(c, 400, "bad_request", "metadata must be an object") };
    }
    request.metadata = body.metadata;
  }
  return request;
}

function parsePipelineLogLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return 200;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    return undefined;
  }
  return Math.min(limit, 1000);
}

function parsePipelineLogAfter(value: string | undefined): number | undefined | false {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const after = Number(value);
  if (!Number.isInteger(after) || after < 0) {
    return false;
  }
  return after;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return Number.isFinite(value) || typeof value !== "number";
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isObject(value)) {
    return Object.values(value).every((item) => item === undefined || isJsonValue(item));
  }
  return false;
}

function toJsonValue(value: unknown): JsonValue {
  if (isJsonValue(value)) {
    return value;
  }
  if (value === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(JSON.stringify(value)) as unknown;
    return isJsonValue(parsed) ? parsed : String(value);
  } catch {
    return String(value);
  }
}
