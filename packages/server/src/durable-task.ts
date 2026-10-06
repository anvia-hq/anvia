import {
  parseTaskSubmission,
  parseTaskListOptions,
  parseTaskSignal,
  parseTaskResolution,
} from "@anvia/durable/protocol";
import type { TaskRecord } from "@anvia/durable";
import type { DurableHandlerOptions, DurableHttpAction } from "./durable";
import {
  durableEventsResponse,
  HttpInputError,
  jsonResponse,
  listQuery,
  readJson,
} from "./durable-http";

export async function handleDurableTaskRequest(
  options: DurableHandlerOptions,
  request: Request,
  base: string,
  maxBytes: number,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = `${base}/tasks`;
  if (url.pathname !== path && !url.pathname.startsWith(`${path}/`)) return undefined;
  const parts = url.pathname.slice(path.length).split("/").filter(Boolean).map(decodeURIComponent);
  const runtime = options.runtime;
  const authorize = async (task: TaskRecord, action: DurableHttpAction) => {
    const agent =
      task.agentRunId === undefined ? undefined : runtime.runScope(task.agentRunId).agentId;
    if (
      !(await options.authorize(request, {
        action,
        sessionId: task.sessionId,
        taskId: task.id,
        rootTaskId: task.rootId,
        taskName: task.name,
        ...(agent === undefined ? {} : { agentId: agent, runId: task.agentRunId! }),
      }))
    )
      throw new HttpInputError(403, "Forbidden");
  };
  if (parts.length === 0) {
    if (request.method === "POST") {
      const input = parseTaskSubmission(await readJson(request, maxBytes));
      if (
        !(await options.authorize(request, {
          action: "submit",
          sessionId: input.sessionId,
          taskName: input.name,
        }))
      )
        throw new HttpInputError(403, "Forbidden");
      return jsonResponse(await (await runtime.submitRegisteredTask(input)).snapshot(), 202);
    }
    if (request.method === "GET") {
      const filter = parseTaskListOptions(listQuery(url));
      if (filter.sessionId === undefined) throw new TypeError("Listing requires sessionId.");
      if (!(await options.authorize(request, { action: "list", sessionId: filter.sessionId })))
        throw new HttpInputError(403, "Forbidden");
      const page = await runtime.listTasks(filter);
      for (const task of page.tasks) await authorize(task, "list");
      return jsonResponse(page);
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const suffix = parts[1];
  if (
    parts.length > 2 ||
    (suffix !== undefined &&
      !["graph", "events", "signal", "resolve-effect", "retry", "cancel"].includes(suffix))
  )
    return jsonResponse({ error: "Not found" }, 404);
  const action =
    suffix === undefined || suffix === "graph" ? "inspect" : (suffix as DurableHttpAction);
  if (request.method !== (["inspect", "events"].includes(action) ? "GET" : "POST"))
    return jsonResponse({ error: "Method not allowed" }, 405);
  const handle = await runtime.getTask(parts[0]!);
  const snapshot = await handle.snapshot();
  await authorize(snapshot.task, action);
  if (suffix === undefined) return jsonResponse(snapshot);
  if (suffix === "graph" || suffix === "events" || suffix === "cancel") {
    const graph = await handle.graph();
    for (const task of graph.nodes) await authorize(task, action);
    if (suffix === "graph") return jsonResponse(graph);
    if (suffix === "cancel") {
      await handle.cancel({ expectedTreeIds: graph.nodes.map((task) => task.id) });
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }
    if (suffix === "events")
      return durableEventsResponse(request, graph.cursor, async function* (streamOptions) {
        for await (const event of handle.stream(streamOptions)) {
          // Children may be created after attachment; authorize each record before exposing its event.
          const task = (await (await runtime.getTask(event.taskId)).snapshot()).task;
          await authorize(task, "events");
          yield event;
        }
      });
  }
  if (suffix === "signal") {
    const body = parseTaskSignal(await readJson(request, maxBytes));
    await handle.signal(body.name, body.requestId, body.value);
  } else if (suffix === "resolve-effect") {
    const body = parseTaskResolution(await readJson(request, maxBytes));
    await handle.resolveEffect(body.key, body.value);
  } else if (suffix === "retry") await handle.retry();
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
