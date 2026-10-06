import { parseDurableGraphSubmission, parseDurableGraphListOptions } from "@anvia/durable/protocol";
import type { DurableHandlerOptions, DurableHttpAction } from "./durable";
import { durableEventsResponse, jsonResponse as json, listQuery, readJson } from "./durable-http";

/** Graph reads and mutations require access to every node they expose or affect. */
export async function handleDurableGraphRequest(
  options: DurableHandlerOptions,
  request: Request,
  basePath: string,
  maxBodyBytes: number,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const root = `${basePath}/graphs`;
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return undefined;
  const parts = url.pathname.slice(root.length).split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) {
    if (request.method === "GET") {
      const filter = parseDurableGraphListOptions(listQuery(url));
      if (filter.sessionId === undefined) throw new TypeError("Listing graphs requires sessionId.");
      if (!(await options.authorize(request, { action: "list", sessionId: filter.sessionId })))
        return json({ error: "Forbidden" }, 403);
      return json(await options.runtime.listGraphs(filter));
    }
    if (request.method === "POST") {
      const input = parseDurableGraphSubmission(await readJson(request, maxBodyBytes));
      for (const task of input.tasks) {
        if (
          !(await options.authorize(request, {
            action: "submit",
            sessionId: input.sessionId,
            taskId: task.id,
            agentId: task.agentId,
          }))
        )
          return json({ error: "Forbidden" }, 403);
      }
      const graph = await options.runtime.submitGraph(input);
      return json(await graph.snapshot(), 202);
    }
    return json({ error: "Method not allowed" }, 405);
  }
  if (
    parts.length > 2 ||
    (parts[1] !== undefined && parts[1] !== "events" && parts[1] !== "cancel")
  )
    return json({ error: "Not found" }, 404);
  const action: DurableHttpAction = parts[1] ?? "inspect";
  if (request.method !== (action === "cancel" ? "POST" : "GET"))
    return json({ error: "Method not allowed" }, 405);
  const graph = await options.runtime.getGraph(parts[0]!);
  const snapshot = await graph.snapshot();
  for (const node of snapshot.nodes) {
    if (
      !(await options.authorize(request, {
        action,
        sessionId: snapshot.sessionId,
        graphId: snapshot.id,
        runId: node.runId,
        taskId: node.id,
        agentId: node.agentId,
      }))
    )
      return json({ error: "Forbidden" }, 403);
  }
  if (action === "inspect") return json(snapshot);
  if (action === "events")
    return durableEventsResponse(request, snapshot.cursor, (options) => graph.stream(options));
  await graph.cancel();
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
