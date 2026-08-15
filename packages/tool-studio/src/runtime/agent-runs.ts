import type {
  AgentApprovalRequiredEvent,
  AgentBlockedResult,
  AgentResponse,
  AgentResult,
  AgentRunOptions,
  AgentStream,
} from "@anvia/core/agent";
import { type Message as CoreMessage, type JsonObject, Message } from "@anvia/core/completion";
import { type Agent, withInternalAgentRunOptions } from "@anvia/core/internal/agent";
import type { Context, Hono } from "hono";
import type {
  AgentRunRequest,
  AgentRunStreamEvent,
  StudioAgent,
  StudioSession,
  StudioSessionStore,
} from "../types";
import { cloneAgent } from "./agent-utils";
import type { ApprovalContext, createApprovalRuntime } from "./approvals";
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
  assignTranscriptRunDuration,
  createPersistedStreamingSessionTranscript,
  mergeRunAndApprovalEvents,
  optionalTitle,
  parseRunRequest,
  streamAgentRunEvents,
  type TranslatedAgentStreamEvent,
  traceForRun,
  transcriptFromMessages,
} from "./runs";
import {
  appendSessionLog,
  memoryLoadedLog,
  memorySavedLog,
  runCancelledLog,
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
type RunExecution = {
  generate(options: AgentRunOptions): Promise<AgentResult>;
  stream(options: AgentRunOptions): AgentStream;
};

type PreparedAgentRun = {
  agentId: string;
  agent: StudioAgent;
  body: AgentRunRequest;
  memoryMetadata: JsonObject;
  execution: RunExecution;
  options: AgentRunOptions;
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

  const execution = createRunExecution({
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
    execution,
    options: createRunOptions(body, agentId, session, c.req.raw.signal),
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

  const input: Parameters<typeof runReceivedLog>[0] = {
    sessionId: props.session.id,
    runId: props.runId,
    agentId: props.agentId,
    message: props.body.message,
    stream: props.body.stream === true,
    hasTrace: props.body.trace !== undefined,
  };
  if (props.body.maxTurns !== undefined) input.maxTurns = props.body.maxTurns;
  if (props.body.toolConcurrency !== undefined) {
    input.toolConcurrency = props.body.toolConcurrency;
  }
  if (props.body.metadata !== undefined || props.selectedModel.ref !== undefined) {
    const metadata: JsonObject = {};
    Object.assign(metadata, props.body.metadata);
    if (props.selectedModel.ref !== undefined) {
      metadata[STUDIO_MODEL_METADATA_KEY] = props.selectedModel.ref;
    }
    input.metadata = metadata;
  }
  await appendSessionLog(props.store, runReceivedLog(input));
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
    const metadata: JsonObject = {};
    Object.assign(metadata, props.session.metadata);
    metadata[STUDIO_MODEL_METADATA_KEY] = props.selectedModel.ref;
    await props.store?.updateSessionMetadata?.(props.session.id, metadata);
  }
}

function runMemoryMetadata(
  agentId: string,
  body: AgentRunRequest,
  selectedModel: SelectedModel,
  runId: string,
): JsonObject {
  const metadata: JsonObject = { agentId };
  Object.assign(metadata, body.metadata);
  if (selectedModel.ref !== undefined) metadata[STUDIO_MODEL_METADATA_KEY] = selectedModel.ref;
  metadata.studioRunId = runId;
  return metadata;
}

function createRunExecution(props: {
  agentId: string;
  body: AgentRunRequest;
  memoryMetadata: JsonObject;
  promptMessage: CoreMessage;
  runAgent: Agent;
  session: StudioSession | undefined;
}): RunExecution {
  if (props.session !== undefined && props.runAgent.memory !== undefined) {
    const session = props.runAgent.session(props.session.id, { metadata: props.memoryMetadata });
    return {
      generate: (options) => session.generate(props.body.message, options),
      stream: (options) => session.stream(props.body.message, options),
    };
  }

  const input =
    props.session !== undefined
      ? [...props.session.messages, props.promptMessage]
      : props.body.history !== undefined
        ? [...props.body.history, props.promptMessage]
        : props.body.message;
  return {
    generate: (options) => props.runAgent.generate(input, options),
    stream: (options) => props.runAgent.stream(input, options),
  };
}

function createRunOptions(
  body: AgentRunRequest,
  agentId: string,
  session: StudioSession | undefined,
  abortSignal: AbortSignal,
): AgentRunOptions {
  const options: AgentRunOptions = { abortSignal };
  if (body.maxTurns !== undefined) options.maxTurns = body.maxTurns;
  if (body.toolConcurrency !== undefined) options.toolConcurrency = body.toolConcurrency;
  if (body.trace !== undefined) {
    options.trace = traceForRun(body.trace, agentId, session);
  } else if (session !== undefined) {
    options.trace = traceForRun(undefined, agentId, session);
  }
  return options;
}

function handleStreamingAgentRun(
  c: Context,
  run: PreparedAgentRun,
  props: AgentRunRouteProps,
): Response {
  const runtimeEvents = new AsyncEventQueue<AgentRunStreamEvent>();
  const approvalContext: ApprovalContext = {
    runId: run.runId,
    agentId: run.agentId,
    emit: (event) => runtimeEvents.push(event),
  };
  if (run.session !== undefined) approvalContext.sessionId = run.session.id;
  if (run.body.metadata !== undefined) approvalContext.metadata = run.body.metadata;
  const questionContext: Parameters<typeof props.questionRuntime.createHook>[0] = {
    runId: run.runId,
    agentId: run.agentId,
    emit: (event) => runtimeEvents.push(event),
  };
  if (run.session !== undefined) questionContext.sessionId = run.session.id;
  if (run.body.metadata !== undefined) questionContext.metadata = run.body.metadata;
  const effectiveHook = props.questionRuntime.createHook(questionContext);
  const streamOptions = withInternalAgentRunOptions(
    { ...run.options },
    { hook: effectiveHook, runId: run.runId },
  );
  const runStream = mergeRunAndApprovalEvents(
    resumeStreamingApprovals(
      run.runAgent,
      run.execution.stream(streamOptions),
      props.approvalRuntime,
      approvalContext,
    ),
    runtimeEvents,
  );
  let stream: AsyncIterable<AgentRunStreamEvent> = runStream;
  let persistedRun: ReturnType<typeof createPersistedStreamingSessionTranscript> | undefined;
  if (run.session !== undefined && run.sessionStore !== undefined) {
    persistedRun = createPersistedStreamingSessionTranscript({
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
      startedAt: run.runStartedAt,
      persistGeneratedMessages: run.shouldPersistSessionMessages,
    });
    stream = persistedRun.events;
  }

  return streamAgentRunEvents(c, stream, {
    runId: run.runId,
    onCancel: async () => {
      props.approvalRuntime.cancelRun(run.runId);
      props.questionRuntime.cancelRun(run.runId);
      const persistence: Promise<unknown>[] = [];
      if (persistedRun !== undefined) {
        persistence.push(persistedRun.cancel());
      }
      if (run.session !== undefined && run.sessionStore !== undefined) {
        persistence.push(
          appendSessionLog(
            run.sessionStore,
            runCancelledLog(run.session.id, run.runId, run.runStartedAt),
          ),
        );
      }
      await Promise.all(persistence);
    },
  });
}

async function handleBufferedAgentRun(
  c: Context,
  run: PreparedAgentRun,
  props: AgentRunRouteProps,
): Promise<Response> {
  try {
    const runtimeOptions = await startBufferedSessionRun(run, props);
    let result = await run.execution.generate(runtimeOptions);
    const approvalContext = createApprovalContext(run);
    while (result.status === "approval_required") {
      const decision = await props.approvalRuntime.request(approvalContext, result.approval);
      result = await run.runAgent.resume(result, decision);
    }
    const response = result;
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
): Promise<AgentRunOptions> {
  if (run.session !== undefined) {
    await appendSessionLog(run.sessionStore, runStartedLog(run.session, run.runId));
    await appendSessionLog(run.sessionStore, memoryLoadedLog(run.session, run.runId));
  }
  const questionContext: Parameters<typeof props.questionRuntime.createHook>[0] = {
    runId: run.runId,
    agentId: run.agentId,
  };
  if (run.session !== undefined) questionContext.sessionId = run.session.id;
  if (run.body.metadata !== undefined) questionContext.metadata = run.body.metadata;
  const effectiveHook = props.questionRuntime.createHook(questionContext);
  return withInternalAgentRunOptions({ ...run.options }, { hook: effectiveHook, runId: run.runId });
}

function createApprovalContext(
  run: PreparedAgentRun,
  emit?: (event: AgentRunStreamEvent) => void,
): ApprovalContext {
  const context: ApprovalContext = {
    runId: run.runId,
    agentId: run.agentId,
  };
  if (run.session !== undefined) context.sessionId = run.session.id;
  if (run.body.metadata !== undefined) context.metadata = run.body.metadata;
  if (emit !== undefined) context.emit = emit;
  return context;
}

async function* resumeStreamingApprovals(
  agent: Agent,
  initialStream: AgentStream,
  approvalRuntime: ReturnType<typeof createApprovalRuntime>,
  context: ApprovalContext,
): AsyncIterable<TranslatedAgentStreamEvent> {
  let stream = initialStream;
  while (true) {
    let pending: AgentApprovalRequiredEvent | undefined;
    for await (const event of stream) {
      if (event.type === "approval_required") {
        pending = event;
        break;
      }
      yield event;
    }
    if (pending === undefined) return;
    const decision = await approvalRuntime.request(context, pending.approval);
    stream = agent.resume(pending, decision);
  }
}

async function completeBufferedSessionRun(
  run: PreparedAgentRun,
  response: AgentResponse | AgentBlockedResult,
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
  const durationMs = Date.now() - run.runStartedAt;
  const transcript = transcriptFromMessages(response.messages);
  assignTranscriptRunDuration(transcript, durationMs);
  await run.sessionStore.saveSessionRunTranscript({
    id: run.session.id,
    runId: run.runId,
    ...optionalTitle(run.body.message),
    transcript,
    status: "success",
  });
  await appendSessionLog(
    run.sessionStore,
    runCompletedLog({
      sessionId: run.session.id,
      runId: run.runId,
      durationMs,
      usage: response.usage,
      output: response.text,
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
  const durationMs = Date.now() - run.runStartedAt;
  const transcript = transcriptFromMessages(messages.slice(run.session.messageCount));
  assignTranscriptRunDuration(transcript, durationMs);
  await run.sessionStore.saveSessionRunTranscript({
    id: run.session.id,
    runId: run.runId,
    ...optionalTitle(run.body.message),
    transcript,
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
