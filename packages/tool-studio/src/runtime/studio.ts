import type { JsonObject } from "@anvia/core/completion";
import { Agent } from "@anvia/core/internal/agent";
import { Pipeline } from "@anvia/core/pipeline";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import { StudioTraceObserver } from "../traces/trace-observer";
import type {
  AnviaStudio,
  StudioAgent,
  StudioConfig,
  StudioOptions,
  StudioPipeline,
  StudioServeLifecycleOptions,
  StudioServeOptions,
  StudioSessionStore,
  StudioTarget,
  StudioTraceStore,
} from "../types";
import {
  isStudioUiEnabled,
  registerStudioUi,
  resolveStudioUiOptions,
  studioUiEntryPath,
} from "../ui/routes";
import { registerAgentRunRoute } from "./agent-runs";
import { cloneAgent } from "./agent-utils";
import { createApprovalRuntime, registerApprovalRoutes } from "./approvals";
import {
  agentConfig,
  agentRuntimeSummary,
  buildConfig,
  runnerId,
  unsupportedCapabilities,
} from "./config";
import { registerEvalRoutes } from "./evals";
import { errorResponse, unsupportedCapability } from "./http";
import { registerKnowledgeRoutes } from "./knowledge";
import { registerMcpRoutes } from "./mcps";
import { registerMemoryRoutes } from "./memory";
import { createStudioModelRegistry, registerModelRoutes } from "./models";
import {
  observeStores,
  registerObservabilityRoutes,
  StudioObservabilityHub,
} from "./observability";
import type { StudioRuntimeOptions } from "./options";
import { registerPipelineRoutes } from "./pipelines";
import { createQuestionRuntime, registerQuestionRoutes } from "./questions";
import { createStudioSandboxRegistry, registerSandboxRoutes } from "./sandboxes";
import { registerSessionRoutes } from "./sessions";
import { normalizeAgents, normalizePipelines, resolveStores } from "./shared";
import { registerStatusRoutes } from "./status";
import { registerToolRoutes } from "./tools";
import { registerTraceRoutes } from "./trace-routes";

type StudioApp = AnviaStudio & {
  readonly sessionStore?: StudioSessionStore;
  readonly traceStore?: StudioTraceStore;
};

export class Studio implements AnviaStudio {
  private readonly options: StudioRuntimeOptions;
  private studio: StudioApp;
  private server: ReturnType<typeof serve> | undefined;
  private sigintHandler: (() => void) | undefined;

  constructor(targets: StudioTarget[] = [], options: StudioOptions = {}) {
    this.options = studioOptionsFromTargets(targets, options);
    this.studio = createStudioApp(this.options);
  }

  get app(): Hono {
    return this.studio.app;
  }

  fetch(request: Request): Response | Promise<Response> {
    return this.studio.fetch(request);
  }

  config(): StudioConfig {
    return this.studio.config();
  }

  traceObserver(): StudioTraceObserver {
    return new StudioTraceObserver({
      store: () => this.studio.traceStore,
    });
  }

  start(serveOptions: StudioServeOptions = {}): this {
    this.close();
    this.studio = createStudioApp(this.options);

    const port = serveOptions.port ?? Number(process.env.RUNNER_PORT ?? 4021);
    const serverOptions: Parameters<typeof serve>[0] = {
      fetch: (request) => this.fetch(request),
      port,
    };
    if (serveOptions.hostname !== undefined) serverOptions.hostname = serveOptions.hostname;
    this.server = serve(serverOptions);

    const log = serveOptions.log ?? true;
    if (log) {
      const host = serveOptions.hostname ?? "localhost";
      this.logAddress(host, port);
    }

    if (serveOptions.handleSignals ?? true) {
      this.sigintHandler = () => {
        this.close();
        process.exit(0);
      };
      process.once("SIGINT", this.sigintHandler);
    }

    return this;
  }

  async serve(serveOptions: StudioServeLifecycleOptions = {}): Promise<void> {
    const { onShutdown, signal, ...startOptions } = serveOptions;

    try {
      this.start({ ...startOptions, log: false, handleSignals: false });
      const server = this.server;
      if (server === undefined) {
        throw new Error("Studio server did not start");
      }

      await waitForServerListening(server);

      if (startOptions.log ?? true) {
        const requestedPort = startOptions.port ?? Number(process.env.RUNNER_PORT ?? 4021);
        const address = server.address();
        const port = typeof address === "object" && address !== null ? address.port : requestedPort;
        this.logAddress(startOptions.hostname ?? "localhost", port);
      }

      await waitForShutdown(signal);
    } finally {
      this.close();
      await onShutdown?.();
    }
  }

  close(): void {
    if (this.sigintHandler !== undefined) {
      process.off("SIGINT", this.sigintHandler);
      this.sigintHandler = undefined;
    }
    this.server?.close();
    this.server = undefined;
    this.studio.close();
  }

  private logAddress(host: string, port: number): void {
    if (isStudioUiEnabled(this.options.ui)) {
      const uiPath = studioUiEntryPath(resolveStudioUiOptions(this.options.ui));
      console.log(`Studio UI: http://${host}:${port}${uiPath}`);
    } else {
      console.log(`Studio API: http://${host}:${port}`);
    }
  }
}

type StudioServer = ReturnType<typeof serve>;

function waitForServerListening(server: StudioServer): Promise<void> {
  if (server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    server.once("listening", onListening);
    server.once("error", onError);
  });
}

function waitForShutdown(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const useRawInput = process.stdin.isTTY === true;
    const wasRaw = process.stdin.isRaw;
    const wasFlowing = process.stdin.readableFlowing;

    const cleanup = () => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      signal?.removeEventListener("abort", finish);
      if (useRawInput) {
        process.stdin.off("data", onInput);
        if (!wasRaw && process.stdin.isRaw) process.stdin.setRawMode(false);
        if (wasFlowing !== true) process.stdin.pause();
      }
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const onInput = (chunk: Buffer | string) => {
      const interrupted = typeof chunk === "string" ? chunk.includes("\u0003") : chunk.includes(3);
      if (interrupted) finish();
    };

    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    signal?.addEventListener("abort", finish, { once: true });
    if (useRawInput) {
      if (!wasRaw) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", onInput);
    }
  });
}

function studioOptionsFromTargets(
  targets: StudioTarget[],
  options: StudioOptions,
): StudioRuntimeOptions {
  const agents = targets.filter((target): target is Agent => target instanceof Agent);
  const pipelines = targets.filter(
    // biome-ignore lint/suspicious/noExplicitAny: Studio accepts heterogeneous user pipelines.
    (target): target is Pipeline<any, any> => target instanceof Pipeline,
  );
  const runtimeOptions: StudioRuntimeOptions = {
    agents: inferStudioAgents(agents, options.quickPrompts ?? {}),
    pipelines: inferStudioPipelines(pipelines),
    evals: options.evals ?? [],
  };
  if (options.models !== undefined) runtimeOptions.models = options.models;
  if (options.stores !== undefined) runtimeOptions.stores = options.stores;
  if (options.ui !== undefined) runtimeOptions.ui = options.ui;
  return runtimeOptions;
}

function inferStudioAgents(agents: Agent[], quickPrompts: Record<string, string[]>): StudioAgent[] {
  const ids = new Set<string>();
  return agents.map((agent) => {
    const id = uniqueAgentId(agent.id, ids);
    return {
      id,
      agent,
      quickPrompts: quickPrompts[id] ?? [],
      metadata: agentMetadata(agent),
    };
  });
}

// biome-ignore lint/suspicious/noExplicitAny: Studio accepts heterogeneous user pipelines.
function inferStudioPipelines(pipelines: Array<Pipeline<any, any>>): StudioPipeline[] {
  const ids = new Set<string>();
  return pipelines.map((pipeline) => {
    const id = uniqueAgentId(pipeline.id || "pipeline", ids);
    const studioPipeline: StudioPipeline = {
      id,
      pipeline,
    };
    if (pipeline.name !== undefined) studioPipeline.name = pipeline.name;
    if (pipeline.description !== undefined) studioPipeline.description = pipeline.description;
    if (pipeline.metadata !== undefined) studioPipeline.metadata = pipeline.metadata;
    return studioPipeline;
  });
}

function uniqueAgentId(baseId: string, ids: Set<string>): string {
  let id = baseId;
  let suffix = 2;
  while (ids.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  ids.add(id);
  return id;
}

function agentMetadata(agent: Agent): JsonObject {
  const metadata: JsonObject = {
    staticContextCount: agent.staticContext.length,
    dynamicContextCount: agent.dynamicContexts.length,
    dynamicToolCount: agent.dynamicTools.length,
    hasOutputSchema: agent.outputSchema !== undefined,
    hasHook: agent.hook !== undefined,
    observerCount: agent.observers.length,
    approvalToolCount: agent.toolSet.values().filter((tool) => tool.approval !== undefined).length,
  };
  if (agent.defaultMaxTurns !== undefined) metadata.defaultMaxTurns = agent.defaultMaxTurns;
  return metadata;
}

function createStudioApp(options: StudioRuntimeOptions): StudioApp {
  const observabilityHub = new StudioObservabilityHub();
  const stores = observeStores(resolveStores(options), observabilityHub);
  const agents = normalizeAgents(options.agents).map((agent) =>
    withStudioTraceObserver(agent, stores.traces),
  );
  const modelRegistry = createStudioModelRegistry(options.models);
  const pipelines = normalizePipelines(options.pipelines);
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
  const pipelineMap = new Map(pipelines.map((pipeline) => [pipeline.id, pipeline]));
  const evalMap = new Map(options.evals.map((suite) => [suite.id ?? suite.name, suite]));
  const approvalRuntime = createApprovalRuntime();
  const questionRuntime = createQuestionRuntime();
  const sandboxRegistry = createStudioSandboxRegistry(agents);
  const app = new HonoApp();
  const uiOptions = isStudioUiEnabled(options.ui) ? resolveStudioUiOptions(options.ui) : undefined;

  if (uiOptions !== undefined && !uiOptions.protectShell) {
    registerStudioUi(app, uiOptions);
  }

  if (uiOptions?.protectShell) {
    registerStudioUi(app, uiOptions);
  }

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      runner: {
        id: runnerId(options),
        name: options.name,
        version: options.version,
      },
    }),
  );

  app.get("/config", (c) =>
    c.json(buildConfig(options, agents, pipelines, stores, sandboxRegistry.size)),
  );
  registerStatusRoutes(app, {
    options,
    agents,
    pipelines,
    stores,
    sandboxCount: sandboxRegistry.size,
  });

  app.get("/agents", (c) => c.json({ agents: agents.map(agentConfig) }));

  app.get("/agents/:agentId", (c) => {
    const agent = agentMap.get(c.req.param("agentId"));
    if (agent === undefined) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }

    return c.json(agentConfig(agent));
  });

  app.get("/agents/:agentId/runtime", (c) => {
    const agent = agentMap.get(c.req.param("agentId"));
    if (agent === undefined) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }

    return c.json(agentRuntimeSummary(agent));
  });

  registerModelRoutes(app, { registry: modelRegistry, agentMap });
  registerMcpRoutes(app, { agentMap });
  registerToolRoutes(app, { agentMap });
  registerSandboxRoutes(app, sandboxRegistry);
  registerApprovalRoutes(app, approvalRuntime);
  registerQuestionRoutes(app, questionRuntime);
  registerObservabilityRoutes(app, observabilityHub);
  registerEvalRoutes(app, {
    evals: options.evals,
    evalMap,
  });
  const knowledgeOptions: Parameters<typeof registerKnowledgeRoutes>[1] = { agents };
  if (stores.traces !== undefined) knowledgeOptions.traceStore = stores.traces;
  registerKnowledgeRoutes(app, knowledgeOptions);
  const pipelineOptions: Parameters<typeof registerPipelineRoutes>[1] = {
    pipelines,
    pipelineMap,
  };
  if (stores.pipelineLogs !== undefined) pipelineOptions.logStore = stores.pipelineLogs;
  if (stores.pipelineRuns !== undefined) pipelineOptions.runStore = stores.pipelineRuns;
  registerPipelineRoutes(app, pipelineOptions);

  registerAgentRunRoute(app, {
    agentMap,
    stores,
    modelRegistry,
    approvalRuntime,
    questionRuntime,
  });

  if (stores.sessions !== undefined) {
    registerMemoryRoutes(app, {
      sessionStore: stores.sessions,
    });
    const sessionOptions: Parameters<typeof registerSessionRoutes>[1] = {
      agentMap,
      sessionStore: stores.sessions,
    };
    if (stores.traces !== undefined) sessionOptions.traceStore = stores.traces;
    registerSessionRoutes(app, sessionOptions);
  }

  if (stores.traces !== undefined) {
    registerTraceRoutes(app, stores.traces);
  }

  for (const capability of unsupportedCapabilities(stores)) {
    app.all(`/${capability}`, (c) => unsupportedCapability(c, capability));
    app.all(`/${capability}/*`, (c) => unsupportedCapability(c, capability));
  }

  const studio: StudioApp = {
    app,
    fetch(request: Request): Response | Promise<Response> {
      return app.fetch(request);
    },
    config(): StudioConfig {
      return buildConfig(options, agents, pipelines, stores, sandboxRegistry.size);
    },
    close() {},
  };
  if (stores.sessions !== undefined) Object.assign(studio, { sessionStore: stores.sessions });
  if (stores.traces !== undefined) Object.assign(studio, { traceStore: stores.traces });
  return studio;
}

function withStudioTraceObserver(
  studioAgent: StudioAgent,
  traceStore: StudioTraceStore | undefined,
): StudioAgent {
  if (traceStore === undefined || hasStudioTraceObserver(studioAgent.agent)) {
    return studioAgent;
  }

  return {
    ...studioAgent,
    agent: cloneAgent(studioAgent.agent, {
      observers: [
        ...studioAgent.agent.observers,
        { observer: new StudioTraceObserver({ store: traceStore }) },
      ],
    }),
  };
}

function hasStudioTraceObserver(agent: Agent): boolean {
  return agent.observers.some(
    (registration) => registration.observer instanceof StudioTraceObserver,
  );
}
