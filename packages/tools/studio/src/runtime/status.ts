import type { Hono } from "hono";
import type { StudioAgent, StudioPipeline, StudioStatusSummary } from "../types";
import {
  capabilityConfig,
  type ResolvedStores,
  runnerId,
  type StudioRuntimeOptions,
} from "./shared";

export function registerStatusRoutes(
  app: Hono,
  props: {
    options: StudioRuntimeOptions;
    agents: StudioAgent[];
    pipelines: StudioPipeline[];
    stores: ResolvedStores;
  },
): void {
  app.get("/status", async (c) => {
    const summary: StudioStatusSummary = {
      runner: {
        id: runnerId(props.options),
        ...(props.options.name === undefined ? {} : { name: props.options.name }),
        ...(props.options.version === undefined ? {} : { version: props.options.version }),
      },
      storage: {
        ...(props.stores.sessions?.kind === undefined
          ? {}
          : { sessions: props.stores.sessions.kind }),
        ...(props.stores.traces?.kind === undefined ? {} : { traces: props.stores.traces.kind }),
        ...(props.stores.pipelineLogs === undefined ? {} : { pipelineLogs: "available" }),
        ...(props.stores.pipelineRuns === undefined ? {} : { pipelineRuns: "available" }),
      },
      counts: {
        agents: props.agents.length,
        pipelines: props.pipelines.length,
        ...(props.stores.sessions === undefined
          ? {}
          : { sessions: (await props.stores.sessions.listSessions({ limit: 100 })).length }),
        ...(props.stores.traces?.listTraces === undefined
          ? {}
          : { traces: (await props.stores.traces.listTraces({ limit: 100 })).length }),
        ...(props.stores.pipelineRuns === undefined || props.pipelines.length === 0
          ? {}
          : {
              pipelineRuns: (
                await Promise.all(
                  props.pipelines.map((pipeline) =>
                    props.stores.pipelineRuns?.listPipelineRuns({
                      pipelineId: pipeline.id,
                      limit: 100,
                    }),
                  ),
                )
              ).reduce((sum, runs) => sum + (runs?.length ?? 0), 0),
            }),
      },
      capabilities: capabilityConfig(props.options, props.agents, props.pipelines, props.stores),
      generatedAt: new Date().toISOString(),
    };
    return c.json(summary);
  });
}
