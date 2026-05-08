import {
  Agent,
  type Message as CoreMessage,
  createHook,
  type HookAction,
  type JsonObject,
  Message,
  type PromptHook,
  resolveMemoryOptions,
  type ToolCallHookAction,
} from "@anvia/core";
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
  StudioServeOptions,
  StudioSessionStore,
  StudioTraceStore,
} from "../types";
import {
  isStudioUiEnabled,
  registerStudioUi,
  resolveStudioUiOptions,
  studioUiEntryPath,
} from "../ui/routes";
import {
  createApprovalRuntime,
  registerApprovalRoutes,
  type StudioApprovalHook,
} from "./approvals";
import { registerKnowledgeRoutes } from "./knowledge";
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
import { registerSessionRoutes } from "./sessions";
import {
  agentConfig,
  buildConfig,
  errorResponse,
  normalizeAgents,
  resolveStores,
  runnerId,
  type StudioRuntimeOptions,
  serializeError,
  unsupportedCapabilities,
  unsupportedCapability,
} from "./shared";
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

  constructor(agents: Agent[] = [], options: StudioOptions = {}) {
    this.options = studioOptionsFromAgents(agents, options);
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
      ...(serveOptions.hostname === undefined ? {} : { hostname: serveOptions.hostname }),
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

function studioOptionsFromAgents(agents: Agent[], options: StudioOptions): StudioRuntimeOptions {
  return {
    agents: inferStudioAgents(agents, options.quickPrompts ?? {}),
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
    ...(agent.defaultMaxTurns === undefined ? {} : { defaultMaxTurns: agent.defaultMaxTurns }),
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
  const stores = resolveStores(options);
  const agents = normalizeAgents(options.agents)
    .map((agent) => withStudioSessionMemory(agent, stores.sessions))
    .map((agent) => withStudioTraceObserver(agent, stores.traces));
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
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

  app.get("/config", (c) => c.json(buildConfig(options, agents, stores)));

  app.get("/agents", (c) => c.json({ agents: agents.map(agentConfig) }));

  app.get("/agents/:agentId", (c) => {
    const agent = agentMap.get(c.req.param("agentId"));
    if (agent === undefined) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }

    return c.json(agentConfig(agent));
  });

  registerApprovalRoutes(app, approvalRuntime);
  registerQuestionRoutes(app, questionRuntime);
  registerKnowledgeRoutes(app, {
    agents,
    ...(stores.traces === undefined ? {} : { traceStore: stores.traces }),
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

    const runId = globalThis.crypto.randomUUID();
    const memoryMetadata = {
      agentId,
      ...(body.metadata ?? {}),
      studioRunId: runId,
    };
    const request =
      session !== undefined
        ? agent.agent.session(session.id, { metadata: memoryMetadata }).prompt(body.message)
        : agent.agent.prompt(
            body.history !== undefined
              ? [...body.history, normalizePromptMessage(body.message)]
              : body.message,
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
      const effectiveHook = composeHooks(
        composeHooks(
          agent.agent.hook,
          approvalRuntime.createHook({
            runId,
            agentId,
            ...(session?.id === undefined ? {} : { sessionId: session.id }),
            ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
            getTool: (toolName) => agent.agent.getTool(toolName),
            emit: (event) => runtimeEvents.push(event),
          }),
        ),
        questionRuntime.createHook({
          runId,
          agentId,
          ...(session?.id === undefined ? {} : { sessionId: session.id }),
          ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
          emit: (event) => runtimeEvents.push(event),
        }),
      );
      if (effectiveHook !== undefined) {
        request.requestHook(effectiveHook);
      }
      const runStream = mergeRunAndApprovalEvents(request.stream(), runtimeEvents);
      const stream =
        session === undefined || stores.sessions === undefined
          ? runStream
          : persistStreamingSessionTranscript({
              stream: runStream,
              store: stores.sessions,
              session,
              message: body.message,
              runId,
            });
      return streamAgentRunEvents(c, stream);
    }

    try {
      const effectiveHook = composeHooks(
        composeHooks(
          agent.agent.hook,
          approvalRuntime.createHook({
            runId,
            agentId,
            ...(session?.id === undefined ? {} : { sessionId: session.id }),
            ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
            getTool: (toolName) => agent.agent.getTool(toolName),
          }),
        ),
        questionRuntime.createHook({
          runId,
          agentId,
          ...(session?.id === undefined ? {} : { sessionId: session.id }),
          ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
        }),
      );
      if (effectiveHook !== undefined) {
        request.requestHook(effectiveHook);
      }
      const response = await request.send();
      if (session !== undefined && stores.sessions !== undefined) {
        await stores.sessions.saveSessionRunTranscript({
          id: session.id,
          runId,
          ...optionalTitle(body.message),
          transcript: transcriptFromMessages(response.messages),
          status: "success",
        });
      }
      return c.json(response);
    } catch (error) {
      if (session !== undefined && stores.sessions !== undefined) {
        const messages = await stores.sessions.load({
          sessionId: session.id,
          metadata: memoryMetadata,
        });
        await stores.sessions.saveSessionRunTranscript({
          id: session.id,
          runId,
          ...optionalTitle(body.message),
          transcript: transcriptFromMessages(messages.slice(session.messageCount)),
          status: "error",
          error: serializeError(error),
        });
      }
      return errorResponse(c, 500, "internal_error", "Agent run failed", serializeError(error));
    }
  });

  if (stores.sessions !== undefined) {
    registerSessionRoutes(app, {
      agentMap,
      sessionStore: stores.sessions,
      ...(stores.traces === undefined ? {} : { traceStore: stores.traces }),
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
      return buildConfig(options, agents, stores);
    },
    close() {},
    ...(stores.sessions === undefined ? {} : { sessionStore: stores.sessions }),
    ...(stores.traces === undefined ? {} : { traceStore: stores.traces }),
  };
}

function normalizePromptMessage(message: string | CoreMessage): CoreMessage {
  return typeof message === "string" ? Message.user(message) : message;
}

function withStudioSessionMemory(
  studioAgent: StudioAgent,
  sessionStore: StudioSessionStore | undefined,
): StudioAgent {
  if (sessionStore === undefined) {
    return studioAgent;
  }

  return {
    ...studioAgent,
    agent: cloneAgent(studioAgent.agent, {
      memory: {
        store: sessionStore,
        options: resolveMemoryOptions({ savePolicy: "message" }),
      },
    }),
  };
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
      if (firstAction?.type === "skip" || firstAction?.type === "terminate") {
        return firstAction;
      }
      if (firstAction?.type === "approval_request") {
        return (await approvalRequestHandler(second)?.(args, firstAction)) ?? firstAction;
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

function approvalRequestHandler(
  hook: PromptHook,
): StudioApprovalHook["handleApprovalRequest"] | undefined {
  const candidate = hook as Partial<StudioApprovalHook>;
  return typeof candidate.handleApprovalRequest === "function"
    ? candidate.handleApprovalRequest
    : undefined;
}
