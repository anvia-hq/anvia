import type { Hono } from "hono";
import type { StudioAgent, StudioPipeline, StudioStatusSummary } from "../types";
import { capabilityConfig, runnerId } from "./config";
import { errorResponse } from "./http";
import { MachineMonitor } from "./machine-monitor";
import type { ResolvedStores, StudioRuntimeOptions } from "./options";

export function registerStatusRoutes(
  app: Hono,
  props: {
    options: StudioRuntimeOptions;
    agents: StudioAgent[];
    pipelines: StudioPipeline[];
    stores: ResolvedStores;
    sandboxCount: number;
  },
): () => void {
  let machineMonitor: MachineMonitor | undefined;
  if (props.stores.machineMonitor !== undefined) {
    const monitorOptions: ConstructorParameters<typeof MachineMonitor>[0] = {
      runnerId: runnerId(props.options),
      store: props.stores.machineMonitor,
    };
    if (props.options.machineMonitor !== false && props.options.machineMonitor !== undefined) {
      monitorOptions.config = props.options.machineMonitor;
    }
    machineMonitor = new MachineMonitor(monitorOptions);
  }
  machineMonitor?.start();

  app.get("/status", async (c) => {
    const runner: StudioStatusSummary["runner"] = { id: runnerId(props.options) };
    if (props.options.name !== undefined) runner.name = props.options.name;
    if (props.options.version !== undefined) runner.version = props.options.version;

    const storage: StudioStatusSummary["storage"] = {};
    if (props.stores.sessions?.kind !== undefined) storage.sessions = props.stores.sessions.kind;
    if (props.stores.traces?.kind !== undefined) storage.traces = props.stores.traces.kind;
    if (props.stores.pipelineLogs !== undefined) storage.pipelineLogs = "available";
    if (props.stores.pipelineRuns !== undefined) storage.pipelineRuns = "available";
    if (props.stores.machineMonitor?.kind !== undefined) {
      storage.machineMonitor = props.stores.machineMonitor.kind;
    } else if (props.stores.machineMonitor !== undefined) {
      storage.machineMonitor = "available";
    }

    const counts: StudioStatusSummary["counts"] = {
      agents: props.agents.length,
      pipelines: props.pipelines.length,
    };
    if (props.sandboxCount > 0) counts.sandboxes = props.sandboxCount;
    if (props.stores.sessions !== undefined) {
      counts.sessions = (await props.stores.sessions.listSessions({ limit: 100 })).length;
    }
    if (props.stores.traces?.listTraces !== undefined) {
      counts.traces = (await props.stores.traces.listTraces({ limit: 100 })).length;
    }
    if (props.stores.pipelineRuns !== undefined && props.pipelines.length > 0) {
      counts.pipelineRuns = (
        await Promise.all(
          props.pipelines.map((pipeline) =>
            props.stores.pipelineRuns?.listPipelineRuns({
              pipelineId: pipeline.id,
              limit: 100,
            }),
          ),
        )
      ).reduce((sum, runs) => sum + (runs?.length ?? 0), 0);
    }

    const summary: StudioStatusSummary = {
      runner,
      storage,
      counts,
      capabilities: capabilityConfig(
        props.options,
        props.agents,
        props.pipelines,
        props.stores,
        props.sandboxCount,
      ),
      generatedAt: new Date().toISOString(),
    };
    if (machineMonitor !== undefined) summary.machine = await machineMonitor.summary();
    return c.json(summary);
  });

  app.get("/status/history", async (c) => {
    if (machineMonitor === undefined) {
      return errorResponse(c, 404, "not_found", "Machine monitor is disabled");
    }
    const range = c.req.query("range") ?? "7d";
    if (range !== "7d" && range !== "30d") {
      return errorResponse(c, 400, "bad_request", "range must be 7d or 30d");
    }
    try {
      return c.json(await machineMonitor.history(range));
    } catch (error) {
      if (error instanceof RangeError) {
        return errorResponse(c, 400, "bad_request", error.message);
      }
      throw error;
    }
  });

  return () => machineMonitor?.close();
}
