import { type Message as CoreMessage, type JsonObject, Message } from "@anvia/core/completion";
import type { Agent } from "@anvia/core/internal/agent";
import type { Context, Hono } from "hono";
import type {
  AgentRunRequest,
  AgentRunStreamEvent,
  StudioAgent,
  StudioSession,
  StudioSessionStore,
} from "../types";
import { cloneAgent, composeHooks } from "./agent-utils";
import type { createApprovalRuntime } from "./approvals";
import { compact } from "./compact";
import { serializeError } from "./errors";
import { errorResponse, unsupportedCapability } from "./http";
import {
  type createStudioModelRegistry,
  ModelSelectionError,
  resolveStudioModel,
  STUDIO_MODEL_METADATA_KEY,
  sessionModelRef,
} from "./models";
import { rawObservedStore } from "./observability";
import type { ResolvedStores } from "./options";
import type { createQuestionRuntime } from "./questions";
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

type AgentRunRouteProps = {
  agentMap: Map<string, StudioAgent>;
  stores: ResolvedStores;
  modelRegistry: ReturnType<typeof createStudioModelRegistry>;
  approvalRuntime: ReturnType<typeof createApprovalRuntime>;
  questionRuntime: ReturnType<typeof createQuestionRuntime>;
};

type SelectedModel = ReturnType<typeof resolveStudioModel>;
type RunRequest = ReturnType<Agent["prompt"]>;

type PreparedAgentRun = {
  agentId: string;
  agent: StudioAgent;
  body: AgentRunRequest;
  memoryMetadata: JsonObject;
  request: RunRequest;
  runAgent: Agent;
  runId: string;
  runStartedAt: number;
  selectedModel: SelectedModel;
  session: StudioSession | undefined;
  sessionStore: StudioSessionStore | undefined;
  shouldPersistSessionMessages: boolean;
};

export function registerAgentRunRoute(app: Hono, props: AgentRunRouteProps): void {
  app.post("/agents/:agentId/runs", (c) => handleAgentRun(c, props));
}

async function handleAgentRun(c: Context, props: AgentRunRouteProps): Promise<Response> {
  const prepared = await prepareAgentRun(c, props);
  if (prepared instanceof Response) {
    return prepared;
  }

  if (prepared.body.stream === true) {
    return handleStreamingAgentRun(c, prepared, props);
  }
  return handleBufferedAgentRun(c, prepared, props);
}

async function prepareAgentRun(
  c: Context,
  props: AgentRunRouteProps,
): Promise<PreparedAgentRun | Response> {
  const agentId = c.req.param("agentId") as string;
  const agent = props.agentMap.get(agentId);
  if (agent === undefined) {
    return errorResponse(c, 404, "not_found", "Agent not found");
  }

  const body = await parseRunRequest(c);
  if ("error" in body) {
    return body.error;
  }

  const session = await resolveRunSession(c, body, agentId, props.stores);
  if (session instanceof Response) {
    return session;
  }

  const selectedModel = selectRunModel(c, props, agent, body, session);
  if (selectedModel instanceof Response) {
    return selectedModel;
  }
  const runAgent =
    selectedModel.model === undefined
      ? agent.agent
      : cloneAgent(agent.agent, { model: selectedModel.model });
  const runId = globalThis.crypto.randomUUID();
  const runStartedAt = Date.now();

  await recordRunReceived({
    agentId,
    body,
    runId,
    selectedModel,
    session,
    store: props.stores.sessions,
  });
  await recordSelectedModelWarnings({
    runId,
    selectedModel,
    session,
    store: props.stores.sessions,
  });

  const memoryMetadata = runMemoryMetadata(agentId, body, selectedModel, runId);
  const promptMessage = normalizePromptMessage(body.message);
  const sessionStore = props.stores.sessions;
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

  const request = createRunRequest({
    agentId,
    body,
    memoryMetadata,
    promptMessage,
    runAgent,
    session,
  });

  return {
    agentId,
    agent,
    body,
    memoryMetadata,
    request,
    runAgent,
    runId,
    runStartedAt,
    selectedModel,
    session,
    sessionStore,
    shouldPersistSessionMessages,
  };
}

async function resolveRunSession(
  c: Context,
  body: AgentRunRequest,
  agentId: string,
  stores: ResolvedStores,
): Promise<StudioSession | undefined | Response> {
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
  return session;
}

function selectRunModel(
  c: Context,
  props: AgentRunRouteProps,
  agent: StudioAgent,
  body: AgentRunRequest,
  session: StudioSession | undefined,
): SelectedModel | Response {
  try {
    return resolveStudioModel(props.modelRegistry, {
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
}

async function recordRunReceived(props: {
  agentId: string;
  body: AgentRunRequest;
  runId: string;
  selectedModel: SelectedModel;
  session: StudioSession | undefined;
  store: StudioSessionStore | undefined;
}): Promise<void> {
  if (props.session === undefined) {
    return;
  }

  await appendSessionLog(
    props.store,
    runReceivedLog({
      sessionId: props.session.id,
      runId: props.runId,
      agentId: props.agentId,
      message: props.body.message,
      stream: props.body.stream === true,
      ...compact({ maxTurns: props.body.maxTurns }),
      ...compact({ toolConcurrency: props.body.toolConcurrency }),
      hasTrace: props.body.trace !== undefined,
      ...(props.body.metadata === undefined && props.selectedModel.ref === undefined
        ? {}
        : {
            metadata: {
              ...(props.body.metadata ?? {}),
              ...(props.selectedModel.ref === undefined
                ? {}
                : { [STUDIO_MODEL_METADATA_KEY]: props.selectedModel.ref }),
            },
          }),
    }),
  );
}

async function recordSelectedModelWarnings(props: {
  runId: string;
  selectedModel: SelectedModel;
  session: StudioSession | undefined;
  store: StudioSessionStore | undefined;
}): Promise<void> {
  if (props.session === undefined || props.selectedModel.ref === undefined) {
    return;
  }

  for (const warning of props.selectedModel.warnings) {
    await appendSessionLog(props.store, {
      sessionId: props.session.id,
      runId: props.runId,
      level: "warn",
      category: "model",
      event: "model.warning",
      message: typeof warning.message === "string" ? warning.message : "Model warning",
      metadata: warning,
    });
  }
  if (sessionModelRef(props.session.metadata) !== props.selectedModel.ref) {
    await props.store?.updateSessionMetadata?.(props.session.id, {
      ...(props.session.metadata ?? {}),
      [STUDIO_MODEL_METADATA_KEY]: props.selectedModel.ref,
    });
  }
}

function runMemoryMetadata(
  agentId: string,
  body: AgentRunRequest,
  selectedModel: SelectedModel,
  runId: string,
): JsonObject {
  return {
    agentId,
    ...(body.metadata ?? {}),
    ...(selectedModel.ref === undefined ? {} : { [STUDIO_MODEL_METADATA_KEY]: selectedModel.ref }),
    studioRunId: runId,
  };
}

function createRunRequest(props: {
  agentId: string;
  body: AgentRunRequest;
  memoryMetadata: JsonObject;
  promptMessage: CoreMessage;
  runAgent: Agent;
  session: StudioSession | undefined;
}): RunRequest {
  const request =
    props.session !== undefined
      ? props.runAgent.memory === undefined
        ? props.runAgent.prompt([...props.session.messages, props.promptMessage])
        : props.runAgent
            .session(props.session.id, { metadata: props.memoryMetadata })
            .prompt(props.body.message)
      : props.runAgent.prompt(
          props.body.history !== undefined
            ? [...props.body.history, props.promptMessage]
            : props.body.message,
        );
  if (props.body.maxTurns !== undefined) {
    request.maxTurns(props.body.maxTurns);
  }
  if (props.body.toolConcurrency !== undefined) {
    request.withToolConcurrency(props.body.toolConcurrency);
  }
  if (props.body.trace !== undefined) {
    request.withTrace(traceForRun(props.body.trace, props.agentId, props.session));
  } else if (props.session !== undefined) {
    request.withTrace(traceForRun(undefined, props.agentId, props.session));
  }
  return request;
}

function handleStreamingAgentRun(
  c: Context,
  run: PreparedAgentRun,
  props: AgentRunRouteProps,
): Response {
  const runtimeEvents = new AsyncEventQueue<AgentRunStreamEvent>();
  run.request.approvals(
    props.approvalRuntime.createApprovals({
      runId: run.runId,
      agentId: run.agentId,
      ...compact({ sessionId: run.session?.id }),
      ...compact({ metadata: run.body.metadata }),
      emit: (event) => runtimeEvents.push(event),
    }),
  );
  const effectiveHook = composeHooks(
    run.runAgent.hook,
    props.questionRuntime.createHook({
      runId: run.runId,
      agentId: run.agentId,
      ...compact({ sessionId: run.session?.id }),
      ...compact({ metadata: run.body.metadata }),
      emit: (event) => runtimeEvents.push(event),
    }),
  );
  if (effectiveHook !== undefined) {
    run.request.requestHook(effectiveHook);
  }

  const runStream = mergeRunAndApprovalEvents(run.request.stream(), runtimeEvents);
  const stream =
    run.session === undefined || run.sessionStore === undefined
      ? runStream
      : persistStreamingSessionTranscript({
          stream: streamSessionRunLogs({
            stream: runStream,
            store: run.sessionStore,
            session: run.session,
            runId: run.runId,
            startedAt: run.runStartedAt,
          }),
          store: run.sessionStore,
          session: run.session,
          message: run.body.message,
          runId: run.runId,
          persistGeneratedMessages: run.shouldPersistSessionMessages,
        });
  return streamAgentRunEvents(c, stream);
}

async function handleBufferedAgentRun(
  c: Context,
  run: PreparedAgentRun,
  props: AgentRunRouteProps,
): Promise<Response> {
  try {
    await startBufferedSessionRun(run, props);
    const response = await run.request.send();
    await completeBufferedSessionRun(run, response);
    return c.json(response);
  } catch (error) {
    await failBufferedSessionRun(run, error);
    return errorResponse(c, 500, "internal_error", "Agent run failed", serializeError(error));
  }
}

async function startBufferedSessionRun(
  run: PreparedAgentRun,
  props: AgentRunRouteProps,
): Promise<void> {
  if (run.session !== undefined) {
    await appendSessionLog(run.sessionStore, runStartedLog(run.session, run.runId));
    await appendSessionLog(run.sessionStore, memoryLoadedLog(run.session, run.runId));
  }
  const effectiveHook = composeHooks(
    run.runAgent.hook,
    props.questionRuntime.createHook({
      runId: run.runId,
      agentId: run.agentId,
      ...compact({ sessionId: run.session?.id }),
      ...compact({ metadata: run.body.metadata }),
    }),
  );
  run.request.approvals(
    props.approvalRuntime.createApprovals({
      runId: run.runId,
      agentId: run.agentId,
      ...compact({ sessionId: run.session?.id }),
      ...compact({ metadata: run.body.metadata }),
    }),
  );
  if (effectiveHook !== undefined) {
    run.request.requestHook(effectiveHook);
  }
}

async function completeBufferedSessionRun(
  run: PreparedAgentRun,
  response: Awaited<ReturnType<RunRequest["send"]>>,
): Promise<void> {
  if (run.session === undefined || run.sessionStore === undefined) {
    return;
  }
  if (run.shouldPersistSessionMessages) {
    const generatedMessages = response.messages.slice(1);
    if (generatedMessages.length > 0) {
      await run.sessionStore.append({
        context: { sessionId: run.session.id, metadata: run.memoryMetadata },
        runId: run.runId,
        turn: 1,
        messages: generatedMessages,
      });
    }
  }
  await run.sessionStore.saveSessionRunTranscript({
    id: run.session.id,
    runId: run.runId,
    ...optionalTitle(run.body.message),
    transcript: transcriptFromMessages(response.messages),
    status: "success",
  });
  await appendSessionLog(
    run.sessionStore,
    runCompletedLog({
      sessionId: run.session.id,
      runId: run.runId,
      durationMs: Date.now() - run.runStartedAt,
      usage: response.usage,
      output: response.output,
      messageCount: response.messages.length,
    }),
  );
  await appendSessionLog(
    run.sessionStore,
    memorySavedLog({
      sessionId: run.session.id,
      runId: run.runId,
      messageCount: response.messages.length,
    }),
  );
}

async function failBufferedSessionRun(run: PreparedAgentRun, error: unknown): Promise<void> {
  if (run.session === undefined || run.sessionStore === undefined) {
    return;
  }

  const messages = await run.sessionStore.load({
    sessionId: run.session.id,
    metadata: run.memoryMetadata,
  });
  await run.sessionStore.saveSessionRunTranscript({
    id: run.session.id,
    runId: run.runId,
    ...optionalTitle(run.body.message),
    transcript: transcriptFromMessages(messages.slice(run.session.messageCount)),
    status: "error",
    error: serializeError(error),
  });
  await appendSessionLog(
    run.sessionStore,
    runFailedLog(run.session.id, run.runId, error, run.runStartedAt),
  );
}

function normalizePromptMessage(message: string | CoreMessage): CoreMessage {
  return typeof message === "string" ? Message.user(message) : message;
}

function usesStoreAsAgentMemory(agent: Agent, store: StudioSessionStore): boolean {
  const memoryStore = agent.memory?.store;
  return memoryStore !== undefined && rawObservedStore(memoryStore) === rawObservedStore(store);
}
