import type { Hono } from "hono";
import type { StudioAgent, StudioPipeline, StudioStatusSummary } from "../types";
import { capabilityConfig, runnerId } from "./config";
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
): void {
  app.get("/status", async (c) => {
    const runner: StudioStatusSummary["runner"] = { id: runnerId(props.options) };
    if (props.options.name !== undefined) runner.name = props.options.name;
    if (props.options.version !== undefined) runner.version = props.options.version;

    const storage: StudioStatusSummary["storage"] = {};
    if (props.stores.sessions?.kind !== undefined) storage.sessions = props.stores.sessions.kind;
    if (props.stores.traces?.kind !== undefined) storage.traces = props.stores.traces.kind;
    if (props.stores.pipelineLogs !== undefined) storage.pipelineLogs = "available";
    if (props.stores.pipelineRuns !== undefined) storage.pipelineRuns = "available";

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
    return c.json(summary);
  });
}
