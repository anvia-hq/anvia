import type { JsonObject, JsonValue } from "@anvia/core/completion";
import type { PipelineRunEvent } from "@anvia/core/pipeline";
import type { Context, Hono } from "hono";
import type {
  AgentRunStreamEvent,
  StudioPipeline,
  StudioPipelineDetail,
  StudioPipelineLogStore,
  StudioPipelineReplayRequest,
  StudioPipelineRunRequest,
  StudioPipelineRunResponse,
  StudioPipelineRunSaveInput,
  StudioPipelineRunStore,
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
import { streamStudioJsonl } from "./streams";

export function registerPipelineRoutes(
  app: Hono,
  props: {
    pipelines: StudioPipeline[];
    pipelineMap: Map<string, StudioPipeline>;
    logStore?: StudioPipelineLogStore;
    runStore?: StudioPipelineRunStore;
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
    if (props.logStore === undefined) {
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

    const logs = await props.logStore.listPipelineLogs({
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

  app.get("/pipelines/:pipelineId/runs", async (c) => {
    const pipelineId = c.req.param("pipelineId");
    if (!props.pipelineMap.has(pipelineId)) {
      return errorResponse(c, 404, "not_found", "Pipeline not found");
    }
    if (props.runStore === undefined) {
      return errorResponse(
        c,
        501,
        "unsupported_capability",
        'Capability "pipelines.runs" is not implemented by this runner',
        { capability: "pipelines", operation: "runs" },
      );
    }

    const limit = parsePipelineLogLimit(c.req.query("limit"));
    if (limit === undefined) {
      return errorResponse(c, 400, "bad_request", "limit must be a positive integer");
    }

    const runs = await props.runStore.listPipelineRuns({ pipelineId, limit });
    return c.json({ runs });
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

    return executePipelineRun(c, props, pipeline, body);
  });

  app.post("/pipelines/:pipelineId/runs/:runId/replay", async (c) => {
    const pipeline = props.pipelineMap.get(c.req.param("pipelineId"));
    if (pipeline === undefined) {
      return errorResponse(c, 404, "not_found", "Pipeline not found");
    }
    if (props.runStore === undefined) {
      return errorResponse(
        c,
        501,
        "unsupported_capability",
        'Capability "pipelines.runs" is not implemented by this runner',
        { capability: "pipelines", operation: "runs" },
      );
    }

    const body = await parsePipelineReplayRequest(c);
    if ("error" in body) {
      return body.error;
    }

    const sourceRunId = c.req.param("runId");
    const runs = await props.runStore.listPipelineRuns({
      pipelineId: pipeline.id,
      limit: 1000,
    });
    const sourceRun = runs.find((run) => run.runId === sourceRunId);
    if (sourceRun === undefined) {
      return errorResponse(c, 404, "not_found", "Pipeline run not found");
    }
    if (sourceRun.status === "running") {
      return errorResponse(c, 409, "conflict", "Cannot replay a running pipeline run");
    }

    return executePipelineRun(c, props, pipeline, {
      input: sourceRun.input,
      ...(body.stream === undefined ? {} : { stream: body.stream }),
      metadata: replayMetadata(sourceRun.metadata, body.metadata, sourceRun.runId),
    });
  });
}

async function executePipelineRun(
  c: Context,
  props: {
    logStore?: StudioPipelineLogStore;
    runStore?: StudioPipelineRunStore;
  },
  pipeline: StudioPipeline,
  body: StudioPipelineRunRequest,
): Promise<Response> {
  const runId = globalThis.crypto.randomUUID();
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  await appendPipelineLog(
    props.logStore,
    pipelineRunReceivedLog({
      pipeline,
      runId,
      stream: body.stream === true,
      input: body.input,
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    }),
  );
  await savePipelineRun(props.runStore, {
    runId,
    pipelineId: pipeline.id,
    status: "running",
    input: body.input,
    ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    startedAt: startedAtIso,
  });

  if (body.stream === true) {
    return streamPipelineRun(c, {
      pipeline,
      runId,
      input: body.input,
      startedAt,
      startedAtIso,
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
      ...(props.logStore === undefined ? {} : { logStore: props.logStore }),
      ...(props.runStore === undefined ? {} : { runStore: props.runStore }),
    });
  }

  try {
    await appendPipelineLog(props.logStore, pipelineRunStartedLog(pipeline, runId));
    const output = await pipeline.pipeline.run(body.input, {
      observer: {
        async onEvent(event) {
          await appendPipelineLog(props.logStore, pipelineStageLog(pipeline.id, runId, event));
        },
      },
    });
    const jsonOutput = toJsonValue(output);
    const endedAt = Date.now();
    await savePipelineRun(props.runStore, {
      runId,
      pipelineId: pipeline.id,
      status: "success",
      input: body.input,
      output: jsonOutput,
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
      startedAt: startedAtIso,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
    });
    await appendPipelineLog(
      props.logStore,
      pipelineRunCompletedLog({
        pipelineId: pipeline.id,
        runId,
        durationMs: endedAt - startedAt,
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
    const endedAt = Date.now();
    await savePipelineRun(props.runStore, {
      runId,
      pipelineId: pipeline.id,
      status: "error",
      input: body.input,
      error: serializeError(error),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
      startedAt: startedAtIso,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
    });
    await appendPipelineLog(
      props.logStore,
      pipelineRunFailedLog(pipeline.id, runId, error, startedAt),
    );
    return errorResponse(c, 500, "internal_error", "Pipeline run failed", serializeError(error));
  }
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
  _c: Context,
  props: {
    pipeline: StudioPipeline;
    runId: string;
    input: JsonValue;
    startedAt: number;
    startedAtIso: string;
    metadata?: JsonObject;
    logStore?: StudioPipelineLogStore;
    runStore?: StudioPipelineRunStore;
  },
): Response {
  return streamStudioJsonl(pipelineRunEvents(props));
}

async function* pipelineRunEvents(props: {
  pipeline: StudioPipeline;
  runId: string;
  input: JsonValue;
  startedAt: number;
  startedAtIso: string;
  metadata?: JsonObject;
  logStore?: StudioPipelineLogStore;
  runStore?: StudioPipelineRunStore;
}): AsyncIterable<AgentRunStreamEvent> {
  yield* emitPipelineLog(props.logStore, pipelineRunStartedLog(props.pipeline, props.runId));

  const events = new AsyncEventQueue<AgentRunStreamEvent>();
  const run = props.pipeline.pipeline
    .run(props.input, {
      observer: {
        async onEvent(event: PipelineRunEvent) {
          const log = await appendPipelineLog(
            props.logStore,
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
      const endedAt = Date.now();
      await savePipelineRun(props.runStore, {
        runId: props.runId,
        pipelineId: props.pipeline.id,
        status: "success",
        input: props.input,
        output: jsonOutput,
        ...(props.metadata === undefined ? {} : { metadata: props.metadata }),
        startedAt: props.startedAtIso,
        endedAt: new Date(endedAt).toISOString(),
        durationMs: endedAt - props.startedAt,
      });
      const log = await appendPipelineLog(
        props.logStore,
        pipelineRunCompletedLog({
          pipelineId: props.pipeline.id,
          runId: props.runId,
          durationMs: endedAt - props.startedAt,
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
      const endedAt = Date.now();
      await savePipelineRun(props.runStore, {
        runId: props.runId,
        pipelineId: props.pipeline.id,
        status: "error",
        input: props.input,
        error: serializeError(error),
        ...(props.metadata === undefined ? {} : { metadata: props.metadata }),
        startedAt: props.startedAtIso,
        endedAt: new Date(endedAt).toISOString(),
        durationMs: endedAt - props.startedAt,
      });
      const log = await appendPipelineLog(
        props.logStore,
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

async function savePipelineRun(
  store: StudioPipelineRunStore | undefined,
  input: StudioPipelineRunSaveInput,
) {
  return store?.savePipelineRun(input);
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

async function parsePipelineReplayRequest(
  c: Context,
): Promise<StudioPipelineReplayRequest | { error: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be JSON") };
  }

  if (!isObject(body)) {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be an object") };
  }

  const request: StudioPipelineReplayRequest = {};
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

function replayMetadata(
  sourceMetadata: JsonObject | undefined,
  requestMetadata: JsonObject | undefined,
  sourceRunId: string,
): JsonObject {
  return {
    ...(sourceMetadata ?? {}),
    ...(requestMetadata ?? {}),
    replayOf: sourceRunId,
  };
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
