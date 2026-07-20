import { type JsonObject, type JsonValue, Usage } from "@anvia/core/completion";
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
import { pipelineConfig } from "./config";
import { serializeError } from "./errors";
import { errorResponse } from "./http";
import { toJsonValue } from "./json";
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
import { streamStudioJsonl } from "./streams";
import { isJsonObject, isJsonValue, isObject } from "./type-guards";

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

    const listInput: Parameters<typeof props.logStore.listPipelineLogs>[0] = {
      pipelineId,
      limit,
    };
    if (after !== undefined) listInput.after = after;
    const logs = await props.logStore.listPipelineLogs(listInput);
    const last = logs.at(-1);
    const response: { logs: typeof logs; nextCursor?: number } = { logs };
    if (logs.length === limit && last !== undefined) response.nextCursor = last.sequence;
    return c.json(response);
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
    const sourceRun = await props.runStore.getPipelineRun({
      pipelineId: pipeline.id,
      runId: sourceRunId,
    });
    if (sourceRun === undefined) {
      return errorResponse(c, 404, "not_found", "Pipeline run not found");
    }
    if (sourceRun.status === "running") {
      return errorResponse(c, 409, "conflict", "Cannot replay a running pipeline run");
    }

    const replayRequest: StudioPipelineRunRequest = {
      input: sourceRun.input,
      metadata: replayMetadata(sourceRun.metadata, body.metadata, sourceRun.runId),
    };
    if (body.stream !== undefined) replayRequest.stream = body.stream;
    return executePipelineRun(c, props, pipeline, replayRequest);
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
  const receivedInput: Parameters<typeof pipelineRunReceivedLog>[0] = {
    pipeline,
    runId,
    stream: body.stream === true,
    input: body.input,
  };
  if (body.metadata !== undefined) receivedInput.metadata = body.metadata;
  await appendPipelineLog(props.logStore, pipelineRunReceivedLog(receivedInput));
  const runningRecord: StudioPipelineRunSaveInput = {
    runId,
    pipelineId: pipeline.id,
    status: "running",
    input: body.input,
    startedAt: startedAtIso,
  };
  if (body.metadata !== undefined) runningRecord.metadata = body.metadata;
  await savePipelineRun(props.runStore, runningRecord);

  if (body.stream === true) {
    const streamOptions: Parameters<typeof streamPipelineRun>[1] = {
      pipeline,
      runId,
      input: body.input,
      startedAt,
      startedAtIso,
    };
    if (body.metadata !== undefined) streamOptions.metadata = body.metadata;
    if (props.logStore !== undefined) streamOptions.logStore = props.logStore;
    if (props.runStore !== undefined) streamOptions.runStore = props.runStore;
    return streamPipelineRun(c, streamOptions);
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
    const successRecord: StudioPipelineRunSaveInput = {
      runId,
      pipelineId: pipeline.id,
      status: "success",
      input: body.input,
      output: jsonOutput,
      startedAt: startedAtIso,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
    };
    if (body.metadata !== undefined) successRecord.metadata = body.metadata;
    await savePipelineRun(props.runStore, successRecord);
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
    const errorRecord: StudioPipelineRunSaveInput = {
      runId,
      pipelineId: pipeline.id,
      status: "error",
      input: body.input,
      error: serializeError(error),
      startedAt: startedAtIso,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
    };
    if (body.metadata !== undefined) errorRecord.metadata = body.metadata;
    await savePipelineRun(props.runStore, errorRecord);
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
      const successRecord: StudioPipelineRunSaveInput = {
        runId: props.runId,
        pipelineId: props.pipeline.id,
        status: "success",
        input: props.input,
        output: jsonOutput,
        startedAt: props.startedAtIso,
        endedAt: new Date(endedAt).toISOString(),
        durationMs: endedAt - props.startedAt,
      };
      if (props.metadata !== undefined) successRecord.metadata = props.metadata;
      await savePipelineRun(props.runStore, successRecord);
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
      const errorRecord: StudioPipelineRunSaveInput = {
        runId: props.runId,
        pipelineId: props.pipeline.id,
        status: "error",
        input: props.input,
        error: serializeError(error),
        startedAt: props.startedAtIso,
        endedAt: new Date(endedAt).toISOString(),
        durationMs: endedAt - props.startedAt,
      };
      if (props.metadata !== undefined) errorRecord.metadata = props.metadata;
      await savePipelineRun(props.runStore, errorRecord);
      const log = await appendPipelineLog(
        props.logStore,
        pipelineRunFailedLog(props.pipeline.id, props.runId, error, props.startedAt),
      );
      if (log !== undefined) {
        events.push({ type: "pipeline_log", log });
      }
      events.push({ type: "error", error: serializeError(error), usage: Usage.empty() });
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
  const metadata: JsonObject = {};
  Object.assign(metadata, sourceMetadata, requestMetadata);
  metadata.replayOf = sourceRunId;
  return metadata;
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
