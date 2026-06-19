import {
  createHook,
  type HookAction,
  type PromptHook,
  type ToolCallHookAction,
} from "@anvia/core/agent";
import { type Message as CoreMessage, type JsonObject, Message } from "@anvia/core/completion";
import { Agent } from "@anvia/core/internal/agent";
import { Pipeline } from "@anvia/core/pipeline";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import { StudioTraceObserver } from "../traces/trace-observer";
import type {
  AgentRunStreamEvent,
  AnviaStudio,
  StudioAgent,
  StudioConfig,
  StudioOptions,
  StudioPipeline,
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
import { createApprovalRuntime, registerApprovalRoutes } from "./approvals";
import { compact } from "./compact";
import {
  agentConfig,
  agentRuntimeSummary,
  buildConfig,
  runnerId,
  type StudioRuntimeOptions,
  unsupportedCapabilities,
} from "./config";
import { registerEvalRoutes } from "./evals";
import { errorResponse, serializeError, unsupportedCapability } from "./http";
import { registerKnowledgeRoutes } from "./knowledge";
import { registerMcpRoutes } from "./mcps";
import { registerMemoryRoutes } from "./memory";
import {
  createStudioModelRegistry,
  ModelSelectionError,
  registerModelRoutes,
  resolveStudioModel,
  STUDIO_MODEL_METADATA_KEY,
  sessionModelRef,
} from "./models";
import {
  observeStores,
  registerObservabilityRoutes,
  StudioObservabilityHub,
} from "./observability";
import { registerPipelineRoutes } from "./pipelines";
import { createQuestionRuntime, registerQuestionRoutes } from "./questions";
import {
  AsyncEventQueue,
  mergeRunAndApprovalEvents,
  optionalTitle,
  parseRunRequest,
  persistStreamingSessionTranscript,
  streamAgentRunEvents,
  traceForRun,
  transcriptFromMessages,
} from "./runs";
import {
  appendSessionLog,
  memoryLoadedLog,
  memorySavedLog,
  runCompletedLog,
  runFailedLog,
  runReceivedLog,
  runStartedLog,
  streamSessionRunLogs,
} from "./session-logs";
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
    this.server = serve({
      fetch: (request) => this.fetch(request),
      ...compact({ hostname: serveOptions.hostname }),
      port,
    });

    const log = serveOptions.log ?? true;
    if (log) {
      const host = serveOptions.hostname ?? "localhost";
      if (isStudioUiEnabled(this.options.ui)) {
        const uiPath = studioUiEntryPath(resolveStudioUiOptions(this.options.ui));
        console.log(`Studio UI: http://${host}:${port}${uiPath}`);
      } else {
        console.log(`Studio API: http://${host}:${port}`);
      }
    }

    this.sigintHandler = () => {
      this.close();
      process.exit(0);
    };
    process.once("SIGINT", this.sigintHandler);

    return this;
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
  return {
    agents: inferStudioAgents(agents, options.quickPrompts ?? {}),
    pipelines: inferStudioPipelines(pipelines),
    evals: options.evals ?? [],
    ...compact({ models: options.models }),
    ...compact({ stores: options.stores }),
    ...compact({ ui: options.ui }),
  };
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
    return {
      id,
      pipeline,
      ...compact({ name: pipeline.name }),
      ...compact({ description: pipeline.description }),
      ...compact({ metadata: pipeline.metadata }),
    };
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
  return {
    ...compact({ defaultMaxTurns: agent.defaultMaxTurns }),
    staticContextCount: agent.staticContext.length,
    dynamicContextCount: agent.dynamicContexts.length,
    dynamicToolCount: agent.dynamicTools.length,
    hasOutputSchema: agent.outputSchema !== undefined,
    hasHook: agent.hook !== undefined,
    observerCount: agent.observers.length,
    approvalToolCount: agent.toolSet.values().filter((tool) => tool.approval !== undefined).length,
  };
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

  app.get("/config", (c) => c.json(buildConfig(options, agents, pipelines, stores)));
  registerStatusRoutes(app, { options, agents, pipelines, stores });

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
  registerApprovalRoutes(app, approvalRuntime);
  registerQuestionRoutes(app, questionRuntime);
  registerObservabilityRoutes(app, observabilityHub);
  registerEvalRoutes(app, {
    evals: options.evals,
    evalMap,
  });
  registerKnowledgeRoutes(app, {
    agents,
    ...compact({ traceStore: stores.traces }),
  });
  registerPipelineRoutes(app, {
    pipelines,
    pipelineMap,
    ...compact({ logStore: stores.pipelineLogs }),
    ...compact({ runStore: stores.pipelineRuns }),
  });

  app.post("/agents/:agentId/runs", async (c) => {
    const agentId = c.req.param("agentId");
    const agent = agentMap.get(agentId);
    if (agent === undefined) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }

    const body = await parseRunRequest(c);
    if ("error" in body) {
      return body.error;
    }

    if (body.sessionId !== undefined && stores.sessions === undefined) {
      return unsupportedCapability(c, "sessions");
    }

    const session =
      body.sessionId === undefined ? undefined : await stores.sessions?.getSession(body.sessionId);
    if (body.sessionId !== undefined && session === undefined) {
      return errorResponse(c, 404, "not_found", "Session not found");
    }
    if (session !== undefined && session.agentId !== agentId) {
      return errorResponse(c, 400, "bad_request", "Session belongs to another agent");
    }

    let selectedModel: ReturnType<typeof resolveStudioModel>;
    try {
      selectedModel = resolveStudioModel(modelRegistry, {
        agent,
        request: body,
        sessionMetadata: session?.metadata,
      });
    } catch (error) {
      if (error instanceof ModelSelectionError) {
        return errorResponse(c, 400, "bad_request", error.message);
      }
      throw error;
    }
    const runAgent =
      selectedModel.model === undefined
        ? agent.agent
        : cloneAgent(agent.agent, { model: selectedModel.model });

    const runId = globalThis.crypto.randomUUID();
    const runStartedAt = Date.now();
    if (session !== undefined) {
      await appendSessionLog(
        stores.sessions,
        runReceivedLog({
          sessionId: session.id,
          runId,
          agentId,
          message: body.message,
          stream: body.stream === true,
          ...compact({ maxTurns: body.maxTurns }),
          ...compact({ toolConcurrency: body.toolConcurrency }),
          hasTrace: body.trace !== undefined,
          ...(body.metadata === undefined && selectedModel.ref === undefined
            ? {}
            : {
                metadata: {
                  ...(body.metadata ?? {}),
                  ...(selectedModel.ref === undefined
                    ? {}
                    : { [STUDIO_MODEL_METADATA_KEY]: selectedModel.ref }),
                },
              }),
        }),
      );
    }
    if (session !== undefined && selectedModel.ref !== undefined) {
      for (const warning of selectedModel.warnings) {
        await appendSessionLog(stores.sessions, {
          sessionId: session.id,
          runId,
          level: "warn",
          category: "model",
          event: "model.warning",
          message: typeof warning.message === "string" ? warning.message : "Model warning",
          metadata: warning,
        });
      }
      if (sessionModelRef(session.metadata) !== selectedModel.ref) {
        await stores.sessions?.updateSessionMetadata?.(session.id, {
          ...(session.metadata ?? {}),
          [STUDIO_MODEL_METADATA_KEY]: selectedModel.ref,
        });
      }
    }
    const memoryMetadata = {
      agentId,
      ...(body.metadata ?? {}),
      ...(selectedModel.ref === undefined
        ? {}
        : { [STUDIO_MODEL_METADATA_KEY]: selectedModel.ref }),
      studioRunId: runId,
    };
    const promptMessage = normalizePromptMessage(body.message);
    const sessionStore = stores.sessions;
    const shouldPersistSessionMessages =
      session !== undefined &&
      sessionStore !== undefined &&
      !usesStoreAsAgentMemory(runAgent, sessionStore);
    if (shouldPersistSessionMessages) {
      await sessionStore.append({
        context: { sessionId: session.id, metadata: memoryMetadata },
        runId,
        turn: 1,
        messages: [promptMessage],
      });
    }
    const request =
      session !== undefined
        ? runAgent.memory === undefined
          ? runAgent.prompt([...session.messages, promptMessage])
          : runAgent.session(session.id, { metadata: memoryMetadata }).prompt(body.message)
        : runAgent.prompt(
            body.history !== undefined ? [...body.history, promptMessage] : body.message,
          );
    if (body.maxTurns !== undefined) {
      request.maxTurns(body.maxTurns);
    }
    if (body.toolConcurrency !== undefined) {
      request.withToolConcurrency(body.toolConcurrency);
    }
    if (body.trace !== undefined) {
      request.withTrace(traceForRun(body.trace, agentId, session));
    } else if (session !== undefined) {
      request.withTrace(traceForRun(undefined, agentId, session));
    }

    if (body.stream === true) {
      const runtimeEvents = new AsyncEventQueue<AgentRunStreamEvent>();
      request.approvals(
        approvalRuntime.createApprovals({
          runId,
          agentId,
          ...compact({ sessionId: session?.id }),
          ...compact({ metadata: body.metadata }),
          emit: (event) => runtimeEvents.push(event),
        }),
      );
      const effectiveHook = composeHooks(
        runAgent.hook,
        questionRuntime.createHook({
          runId,
          agentId,
          ...compact({ sessionId: session?.id }),
          ...compact({ metadata: body.metadata }),
          emit: (event) => runtimeEvents.push(event),
        }),
      );
      if (effectiveHook !== undefined) {
        request.requestHook(effectiveHook);
      }
      const runStream = mergeRunAndApprovalEvents(request.stream(), runtimeEvents);
      const stream =
        session === undefined || sessionStore === undefined
          ? runStream
          : persistStreamingSessionTranscript({
              stream: streamSessionRunLogs({
                stream: runStream,
                store: sessionStore,
                session,
                runId,
                startedAt: runStartedAt,
              }),
              store: sessionStore,
              session,
              message: body.message,
              runId,
              persistGeneratedMessages: shouldPersistSessionMessages,
            });
      return streamAgentRunEvents(c, stream);
    }

    try {
      if (session !== undefined) {
        await appendSessionLog(sessionStore, runStartedLog(session, runId));
        await appendSessionLog(sessionStore, memoryLoadedLog(session, runId));
      }
      const effectiveHook = composeHooks(
        runAgent.hook,
        questionRuntime.createHook({
          runId,
          agentId,
          ...compact({ sessionId: session?.id }),
          ...compact({ metadata: body.metadata }),
        }),
      );
      request.approvals(
        approvalRuntime.createApprovals({
          runId,
          agentId,
          ...compact({ sessionId: session?.id }),
          ...compact({ metadata: body.metadata }),
        }),
      );
      if (effectiveHook !== undefined) {
        request.requestHook(effectiveHook);
      }
      const response = await request.send();
      if (session !== undefined && sessionStore !== undefined) {
        if (shouldPersistSessionMessages) {
          const generatedMessages = response.messages.slice(1);
          if (generatedMessages.length > 0) {
            await sessionStore.append({
              context: { sessionId: session.id, metadata: memoryMetadata },
              runId,
              turn: 1,
              messages: generatedMessages,
            });
          }
        }
        await sessionStore.saveSessionRunTranscript({
          id: session.id,
          runId,
          ...optionalTitle(body.message),
          transcript: transcriptFromMessages(response.messages),
          status: "success",
        });
        await appendSessionLog(
          sessionStore,
          runCompletedLog({
            sessionId: session.id,
            runId,
            durationMs: Date.now() - runStartedAt,
            usage: response.usage,
            output: response.output,
            messageCount: response.messages.length,
          }),
        );
        await appendSessionLog(
          sessionStore,
          memorySavedLog({
            sessionId: session.id,
            runId,
            messageCount: response.messages.length,
          }),
        );
      }
      return c.json(response);
    } catch (error) {
      if (session !== undefined && sessionStore !== undefined) {
        const messages = await sessionStore.load({
          sessionId: session.id,
          metadata: memoryMetadata,
        });
        await sessionStore.saveSessionRunTranscript({
          id: session.id,
          runId,
          ...optionalTitle(body.message),
          transcript: transcriptFromMessages(messages.slice(session.messageCount)),
          status: "error",
          error: serializeError(error),
        });
        await appendSessionLog(sessionStore, runFailedLog(session.id, runId, error, runStartedAt));
      }
      return errorResponse(c, 500, "internal_error", "Agent run failed", serializeError(error));
    }
  });

  if (stores.sessions !== undefined) {
    registerMemoryRoutes(app, {
      sessionStore: stores.sessions,
    });
    registerSessionRoutes(app, {
      agentMap,
      sessionStore: stores.sessions,
      ...compact({ traceStore: stores.traces }),
    });
  }

  if (stores.traces !== undefined) {
    registerTraceRoutes(app, stores.traces);
  }

  for (const capability of unsupportedCapabilities(stores)) {
    app.all(`/${capability}`, (c) => unsupportedCapability(c, capability));
    app.all(`/${capability}/*`, (c) => unsupportedCapability(c, capability));
  }

  return {
    app,
    fetch(request: Request): Response | Promise<Response> {
      return app.fetch(request);
    },
    config(): StudioConfig {
      return buildConfig(options, agents, pipelines, stores);
    },
    close() {},
    ...compact({ sessionStore: stores.sessions }),
    ...compact({ traceStore: stores.traces }),
  };
}

function normalizePromptMessage(message: string | CoreMessage): CoreMessage {
  return typeof message === "string" ? Message.user(message) : message;
}

function usesStoreAsAgentMemory(agent: Agent, store: StudioSessionStore): boolean {
  return agent.memory?.store === store;
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

function cloneAgent(
  agent: Agent,
  overrides: Partial<ConstructorParameters<typeof Agent>[0]> = {},
): Agent {
  return new Agent({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    model: agent.model,
    instructions: agent.instructions,
    staticContext: agent.staticContext,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    additionalParams: agent.additionalParams,
    toolSet: agent.toolSet,
    toolChoice: agent.toolChoice,
    defaultMaxTurns: agent.defaultMaxTurns,
    hook: agent.hook,
    outputSchema: agent.outputSchema,
    observers: agent.observers,
    dynamicContexts: agent.dynamicContexts,
    dynamicTools: agent.dynamicTools,
    memory: agent.memory,
    ...overrides,
  });
}

function hasStudioTraceObserver(agent: Agent): boolean {
  return agent.observers.some(
    (registration) => registration.observer instanceof StudioTraceObserver,
  );
}

function composeHooks(
  first: PromptHook | undefined,
  second: PromptHook | undefined,
): PromptHook | undefined {
  if (first === undefined) {
    return second;
  }
  if (second === undefined) {
    return first;
  }

  return createHook({
    async onCompletionCall(args): Promise<HookAction | undefined> {
      const firstAction = await first.onCompletionCall?.(args);
      return firstAction?.type === "terminate"
        ? firstAction
        : ((await second.onCompletionCall?.(args)) ?? undefined);
    },
    async onCompletionResponse(args): Promise<HookAction | undefined> {
      const firstAction = await first.onCompletionResponse?.(args);
      return firstAction?.type === "terminate"
        ? firstAction
        : ((await second.onCompletionResponse?.(args)) ?? undefined);
    },
    async onToolCall(args): Promise<ToolCallHookAction | undefined> {
      const firstAction = await first.onToolCall?.(args);
      if (
        firstAction?.type === "skip" ||
        firstAction?.type === "terminate" ||
        firstAction?.type === "approval_request"
      ) {
        return firstAction;
      }
      const secondAction = await second.onToolCall?.(args);
      return secondAction ?? firstAction ?? undefined;
    },
    async onToolResult(args): Promise<HookAction | undefined> {
      const firstAction = await first.onToolResult?.(args);
      return firstAction?.type === "terminate"
        ? firstAction
        : ((await second.onToolResult?.(args)) ?? undefined);
    },
  });
}
