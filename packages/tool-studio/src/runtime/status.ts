import type { Hono } from "hono";
import type { StudioAgent, StudioPipeline, StudioStatusSummary } from "../types";
import { compact } from "./compact";
import {
  capabilityConfig,
  type ResolvedStores,
  runnerId,
  type StudioRuntimeOptions,
} from "./config";

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
        ...compact({ name: props.options.name, version: props.options.version }),
      },
      storage: {
        ...compact({
          sessions: props.stores.sessions?.kind,
          traces: props.stores.traces?.kind,
          pipelineLogs: props.stores.pipelineLogs !== undefined ? "available" as const : undefined,
          pipelineRuns: props.stores.pipelineRuns !== undefined ? "available" as const : undefined,
        }),
      },
      counts: {
        agents: props.agents.length,
        pipelines: props.pipelines.length,
        ...compact({
          sessions: props.stores.sessions !== undefined
            ? (await props.stores.sessions.listSessions({ limit: 100 })).length
            : undefined,
          traces: props.stores.traces?.listTraces !== undefined
            ? (await props.stores.traces.listTraces({ limit: 100 })).length
            : undefined,
          pipelineRuns: props.stores.pipelineRuns !== undefined && props.pipelines.length > 0
            ? (
                await Promise.all(
                  props.pipelines.map((pipeline) =>
                    props.stores.pipelineRuns?.listPipelineRuns({
                      pipelineId: pipeline.id,
                      limit: 100,
                    }),
                  ),
                )
              ).reduce((sum, runs) => sum + (runs?.length ?? 0), 0)
            : undefined,
        }),
      },
      capabilities: capabilityConfig(props.options, props.agents, props.pipelines, props.stores),
      generatedAt: new Date().toISOString(),
    };
    return c.json(summary);
  });
}
