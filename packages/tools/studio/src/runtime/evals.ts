import { runEvalSuite } from "@anvia/core";
import type { Context, Hono } from "hono";
import type { StudioEvalRunRequest, StudioEvalRunResponse, StudioEvalSuite } from "../types";
import { toJsonValue } from "./json";
import { errorResponse, evalConfig, isJsonObject, isObject, isPositiveInteger } from "./shared";

export function registerEvalRoutes(
  app: Hono,
  props: {
    evals: StudioEvalSuite[];
    evalMap: Map<string, StudioEvalSuite>;
  },
): void {
  app.get("/evals", (c) =>
    c.json({
      evals: props.evals.map(evalConfig),
    }),
  );

  app.get("/evals/:evalId", (c) => {
    const suite = props.evalMap.get(c.req.param("evalId"));
    if (suite === undefined) {
      return errorResponse(c, 404, "not_found", "Eval suite not found");
    }
    return c.json(evalConfig(suite));
  });

  app.post("/evals/:evalId/runs", async (c) => {
    const suite = props.evalMap.get(c.req.param("evalId"));
    if (suite === undefined) {
      return errorResponse(c, 404, "not_found", "Eval suite not found");
    }

    const body = await parseEvalRunRequest(c);
    if ("error" in body) {
      return body.error;
    }

    const runId = globalThis.crypto.randomUUID();
    const startedAt = Date.now();
    const result = await runEvalSuite({
      ...suite,
      ...(body.concurrency === undefined ? {} : { concurrency: body.concurrency }),
    });
    const endedAt = Date.now();
    const jsonResult = toJsonValue(result);
    const response: StudioEvalRunResponse = {
      runId,
      suiteId: suite.id ?? suite.name,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
      result: isJsonObject(jsonResult) ? jsonResult : { value: jsonResult },
    };
    return c.json(response);
  });
}

async function parseEvalRunRequest(
  c: Context,
): Promise<StudioEvalRunRequest | { error: Response }> {
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  if (!isObject(body)) {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be an object") };
  }

  const request: StudioEvalRunRequest = {};
  if ("concurrency" in body) {
    if (!isPositiveInteger(body.concurrency)) {
      return {
        error: errorResponse(c, 400, "bad_request", "concurrency must be a positive integer"),
      };
    }
    request.concurrency = body.concurrency;
  }
  return request;
}
