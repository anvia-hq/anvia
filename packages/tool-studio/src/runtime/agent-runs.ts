import type { AgentOutcome, AgentRunSettings, AgentStream } from "@anvia/core/agent";
import type {
  CompletionModel,
  Message as CoreMessage,
  JsonObject,
  UserMessage,
} from "@anvia/core/completion";
import {
  type Agent,
  type InternalAgentRunOptions,
  withInternalAgentRunOptions,
} from "@anvia/core/internal/agent";
import type { Context, Hono } from "hono";
import type {
  AgentRunRequest,
  AgentRunResponse,
  AgentRunStreamEvent,
  StudioAgent,
  StudioSession,
  StudioSessionStore,
} from "../types";
import { cloneAgent } from "./agent-utils";
import { serializeError } from "./errors";
import { errorResponse, unsupportedCapability } from "./http";
import type { StudioContinuationRegistry } from "./interactions";
import {
  type createStudioModelRegistry,
  ModelSelectionError,
  resolveStudioModel,
  sessionControlValues,
  STUDIO_CONTROLS_METADATA_KEY,
  STUDIO_MODEL_METADATA_KEY,
  sessionModelRef,
} from "./models";
import { rawObservedStore } from "./observability";
import type { ResolvedStores } from "./options";
import type { StudioRunLease, StudioRunLifecycle } from "./run-lifecycle";
import {
  assignTranscriptRunDuration,
  createPersistedStreamingSessionTranscript,
  optionalTitle,
  parseRunRequest,
  streamAgentRunEvents,
  traceForRun,
  transcriptFromMessages,
} from "./runs";
import {
  appendSessionLog,
  memoryCompactedLog,
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
  continuationRegistry: StudioContinuationRegistry<PreparedAgentRun>;
  runLifecycle: StudioRunLifecycle;
};

type SelectedModel = ReturnType<typeof resolveStudioModel>;
type RunExecution = {
  generate(options: AgentRunSettings): Promise<AgentOutcome>;
  stream(options: AgentRunSettings): AgentStream;
};

export type PreparedAgentRun = {
  agentId: string;
  agent: StudioAgent;
  body: Extract<AgentRunRequest, { type: "messages" }>;
  memoryMetadata: JsonObject;
  execution: RunExecution;
  failureMessages: readonly CoreMessage[] | undefined;
  memoryCompactionLogged: boolean;
  options: AgentRunSettings;
  runAgent: Agent;
  runId: string;
  runStartedAt: number;
  generatedMessagesStartIndex: 0 | 1;
  selectedModel: SelectedModel;
  session: StudioSession | undefined;
  sessionStore: StudioSessionStore | undefined;
  shouldPersistSessionMessages: boolean;
};

export function registerAgentRunRoute(app: Hono, props: AgentRunRouteProps): void {
  app.post("/agents/:agentId/runs", (c) => handleAgentRun(c, props));
}

async function handleAgentRun(c: Context, props: AgentRunRouteProps): Promise<Response> {
  const lease = props.runLifecycle.start(c.req.raw.signal);
  if (lease === undefined) {
    return errorResponse(c, 503, "service_unavailable", "Anvia Studio is shutting down");
  }

  try {
    const prepared = await prepareAgentRun(c, props, lease.abortSignal);
    if (prepared instanceof Response) {
      lease.finish();
      return prepared;
    }

    if (prepared.body.stream === true) {
      return handleStreamingAgentRun(c, prepared, props, lease);
    }
    try {
      return await handleBufferedAgentRun(c, prepared, props);
    } finally {
      lease.finish();
    }
  } catch (error) {
    lease.finish();
    throw error;
  }
}

async function prepareAgentRun(
  c: Context,
  props: AgentRunRouteProps,
  abortSignal: AbortSignal,
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

  if (body.type === "interaction_response") {
    const registration = props.continuationRegistry.take(
      body.interactionId,
      agentId,
      body.response,
    );
    if (registration.status === "missing") {
      return errorResponse(c, 404, "not_found", "Interaction continuation is unavailable");
    }
    if (registration.status === "claimed") {
      return errorResponse(c, 409, "conflict", "Interaction response was already claimed");
    }
    if (registration.status === "invalid") {
      return errorResponse(c, 400, "bad_request", registration.error.message);
    }
    const { registration: claimed } = registration;
    const source = claimed.context;
    const runId = globalThis.crypto.randomUUID();
    let resumedBody: PreparedAgentRun["body"] = {
      ...source.body,
    };
    if (body.stream !== undefined) resumedBody = { ...resumedBody, stream: body.stream };
    if (body.metadata !== undefined) resumedBody = { ...resumedBody, metadata: body.metadata };
    if (body.trace !== undefined) resumedBody = { ...resumedBody, trace: body.trace };
    const runOptions = createRunOptions(resumedBody, agentId, source.session, abortSignal);
    const execution: RunExecution = {
      generate: (options) =>
        source.runAgent.generate({
          continuation: claimed.continuation,
          response: body.response,
          ...options,
        }),
      stream: (options) =>
        source.runAgent.stream({
          continuation: claimed.continuation,
          response: body.response,
          ...options,
        }),
    };
    return {
      ...source,
      body: resumedBody,
      execution,
      failureMessages: undefined,
      memoryCompactionLogged: false,
      options: runOptions,
      runId,
      runStartedAt: Date.now(),
      generatedMessagesStartIndex: 0,
      shouldPersistSessionMessages: source.shouldPersistSessionMessages,
    };
  }

  const session = await resolveRunSession(c, body, agentId, props.stores);
  if (session instanceof Response) {
    return session;
  }

  const persistedControls = sessionControlValues(session?.metadata);
  const runBody =
    body.controls === undefined && persistedControls !== undefined
      ? { ...body, controls: persistedControls }
      : body;
  const selectedModel = selectRunModel(c, props, agent, runBody, session);
  if (selectedModel instanceof Response) {
    return selectedModel;
  }
  const runAgent =
    selectedModel.model === undefined
      ? agent.agent
      : cloneAgent(agent.agent, {
          model: selectedModel.model,
          controls: compatibleAgentControls(agent.agent.controls, selectedModel.model),
        });
  const runId = globalThis.crypto.randomUUID();
  const runStartedAt = Date.now();

  await recordRunReceived({
    agentId,
    body: runBody,
    runId,
    selectedModel,
    session,
    store: props.stores.sessions,
  });
  await recordSelectedModelWarnings({
    body: runBody,
    runId,
    selectedModel,
    session,
    store: props.stores.sessions,
  });

  const memoryMetadata = runMemoryMetadata(agentId, runBody, selectedModel, runId);
  const promptMessage = runBody.messages.at(-1) as UserMessage;
  const sessionStore = props.stores.sessions;
  const shouldPersistSessionMessages =
    session !== undefined &&
    sessionStore !== undefined &&
    !usesStoreAsAgentMemory(runAgent, sessionStore);
  if (shouldPersistSessionMessages) {
    await sessionStore.append({
      scope: { sessionId: session.id, metadata: memoryMetadata },
      runId,
      turn: 1,
      messages: [promptMessage],
    });
  }

  const execution = createRunExecution({
    agentId,
    body: runBody,
    memoryMetadata,
    promptMessage,
    runAgent,
    session,
  });

  return {
    agentId,
    agent,
    body: runBody,
    memoryMetadata,
    execution,
    failureMessages: undefined,
    memoryCompactionLogged: false,
    options: createRunOptions(runBody, agentId, session, abortSignal),
    runAgent,
    runId,
    runStartedAt,
    generatedMessagesStartIndex: 1,
    selectedModel,
    session,
    sessionStore,
    shouldPersistSessionMessages,
  };
}

function compatibleAgentControls(
  controls: Readonly<Record<string, string | undefined>> | undefined,
  model: CompletionModel,
): Readonly<Record<string, string>> | undefined {
  const modelControls = model.controls;
  const compatible = Object.fromEntries(
    Object.entries(controls ?? {}).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" &&
        modelControls !== undefined &&
        Object.hasOwn(modelControls, entry[0]) &&
        modelControls[entry[0]]?.options.includes(entry[1]) === true,
    ),
  );
  return Object.keys(compatible).length === 0 ? undefined : compatible;
}

async function resolveRunSession(
  c: Context,
  body: Extract<AgentRunRequest, { type: "messages" }>,
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
  body: Extract<AgentRunRequest, { type: "messages" }>,
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
  body: Extract<AgentRunRequest, { type: "messages" }>;
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
    message: props.body.messages.at(-1) as UserMessage,
    stream: props.body.stream === true,
    hasTrace: props.body.trace !== undefined,
  };
  if (props.body.maxTurns !== undefined) input.maxTurns = props.body.maxTurns;
  if (props.body.toolConcurrency !== undefined) {
    input.toolConcurrency = props.body.toolConcurrency;
  }
  if (
    props.body.metadata !== undefined ||
    props.selectedModel.ref !== undefined ||
    props.body.controls !== undefined
  ) {
    const metadata: JsonObject = {};
    Object.assign(metadata, props.body.metadata);
    if (props.selectedModel.ref !== undefined) {
      metadata[STUDIO_MODEL_METADATA_KEY] = props.selectedModel.ref;
    }
    if (props.body.controls !== undefined) {
      metadata[STUDIO_CONTROLS_METADATA_KEY] = props.body.controls;
    }
    input.metadata = metadata;
  }
  await appendSessionLog(props.store, runReceivedLog(input));
}

async function recordSelectedModelWarnings(props: {
  body: Extract<AgentRunRequest, { type: "messages" }>;
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
  if (
    sessionModelRef(props.session.metadata) !== props.selectedModel.ref ||
    props.body.controls !== undefined
  ) {
    const metadata: JsonObject = {};
    Object.assign(metadata, props.session.metadata);
    metadata[STUDIO_MODEL_METADATA_KEY] = props.selectedModel.ref;
    if (props.body.controls !== undefined) {
      metadata[STUDIO_CONTROLS_METADATA_KEY] = props.body.controls;
    }
    await props.store?.updateSessionMetadata?.(props.session.id, metadata);
  }
}

function runMemoryMetadata(
  agentId: string,
  body: Extract<AgentRunRequest, { type: "messages" }>,
  selectedModel: SelectedModel,
  runId: string,
): JsonObject {
  const metadata: JsonObject = { agentId };
  Object.assign(metadata, body.metadata);
  if (selectedModel.ref !== undefined) metadata[STUDIO_MODEL_METADATA_KEY] = selectedModel.ref;
  if (body.controls !== undefined) metadata[STUDIO_CONTROLS_METADATA_KEY] = body.controls;
  metadata.studioRunId = runId;
  return metadata;
}

function createRunExecution(props: {
  agentId: string;
  body: Extract<AgentRunRequest, { type: "messages" }>;
  memoryMetadata: JsonObject;
  promptMessage: UserMessage;
  runAgent: Agent;
  session: StudioSession | undefined;
}): RunExecution {
  const session = props.session;
  if (session !== undefined && props.runAgent.memory !== undefined) {
    return {
      generate: (options) =>
        props.runAgent.generate({
          prompt: props.promptMessage,
          session: { sessionId: session.id, metadata: props.memoryMetadata },
          ...options,
        }),
      stream: (options) =>
        props.runAgent.stream({
          prompt: props.promptMessage,
          session: { sessionId: session.id, metadata: props.memoryMetadata },
          ...options,
        }),
    };
  }

  const transcript =
    session !== undefined ? [...session.messages, props.promptMessage] : props.body.messages;
  return {
    generate: (options) => props.runAgent.generate({ messages: transcript, ...options }),
    stream: (options) => props.runAgent.stream({ messages: transcript, ...options }),
  };
}

function createRunOptions(
  body: AgentRunRequest,
  agentId: string,
  session: StudioSession | undefined,
  abortSignal: AbortSignal,
): AgentRunSettings {
  const options: AgentRunSettings = { abortSignal };
  if (body.type === "messages" && body.maxTurns !== undefined) options.maxTurns = body.maxTurns;
  if (body.type === "messages" && body.toolConcurrency !== undefined) {
    options.toolConcurrency = body.toolConcurrency;
  }
  if (body.type === "messages" && body.controls !== undefined) options.controls = body.controls;
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
  lease: StudioRunLease,
): Response {
  const streamOptions = withInternalAgentRunOptions({ ...run.options }, { runId: run.runId });
  const runStream = registerStreamingContinuation(
    run.execution.stream(streamOptions),
    props.continuationRegistry,
    run,
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
      message: run.body.messages.at(-1) as UserMessage,
      runId: run.runId,
      startedAt: run.runStartedAt,
      persistGeneratedMessages: run.shouldPersistSessionMessages,
      generatedMessagesStartIndex: run.generatedMessagesStartIndex,
    });
    stream = persistedRun.events;
  }

  return streamAgentRunEvents(c, finishRunLease(stream, lease), {
    runId: run.runId,
    onCancel: async () => {
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

async function* finishRunLease(
  events: AsyncIterable<AgentRunStreamEvent>,
  lease: StudioRunLease,
): AsyncIterable<AgentRunStreamEvent> {
  try {
    yield* events;
  } finally {
    lease.finish();
  }
}

async function handleBufferedAgentRun(
  c: Context,
  run: PreparedAgentRun,
  props: AgentRunRouteProps,
): Promise<Response> {
  try {
    const runtimeOptions = await startBufferedSessionRun(run);
    const result = await run.execution.generate(runtimeOptions);
    if (result.type === "interaction") {
      props.continuationRegistry.register({ continuation: result.continuation, context: run });
    }
    await completeBufferedSessionRun(run, result);
    return c.json(agentRunResponse(result));
  } catch (error) {
    await failBufferedSessionRun(run, error);
    return errorResponse(c, 500, "internal_error", "Agent run failed", serializeError(error));
  }
}

function agentRunResponse(result: AgentOutcome): AgentRunResponse {
  if (result.type !== "interaction") return result;
  const { continuation: _continuation, messages: _messages, ...response } = result;
  return response;
}

async function startBufferedSessionRun(run: PreparedAgentRun): Promise<AgentRunSettings> {
  if (run.session !== undefined) {
    await appendSessionLog(run.sessionStore, runStartedLog(run.session, run.runId));
    await appendSessionLog(run.sessionStore, memoryLoadedLog(run.session, run.runId));
  }
  const internalOptions: InternalAgentRunOptions = {
    onFailure: ({ messages }) => {
      run.failureMessages = structuredClone(messages);
    },
    runId: run.runId,
  };
  if (run.session !== undefined && run.sessionStore !== undefined) {
    const sessionId = run.session.id;
    const sessionStore = run.sessionStore;
    internalOptions.onMemoryCompaction = async (compaction) => {
      await appendSessionLog(
        sessionStore,
        memoryCompactedLog({
          sessionId,
          runId: run.runId,
          ...compaction,
        }),
      );
      run.memoryCompactionLogged = true;
    };
  }
  return withInternalAgentRunOptions({ ...run.options }, internalOptions);
}

async function* registerStreamingContinuation(
  stream: AgentStream,
  registry: StudioContinuationRegistry<PreparedAgentRun>,
  run: PreparedAgentRun,
): AsyncIterable<AgentRunStreamEvent> {
  for await (const event of stream) {
    if (event.type === "interaction") {
      registry.register({ continuation: event.continuation, context: run });
    }
    yield event;
  }
}

async function completeBufferedSessionRun(
  run: PreparedAgentRun,
  response: AgentOutcome,
): Promise<void> {
  if (run.session === undefined || run.sessionStore === undefined) {
    return;
  }
  if (run.shouldPersistSessionMessages) {
    const generatedMessages = response.messages.slice(run.generatedMessagesStartIndex);
    if (generatedMessages.length > 0) {
      await run.sessionStore.append({
        scope: { sessionId: run.session.id, metadata: run.memoryMetadata },
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
    ...optionalTitle(run.body.messages.at(-1) as UserMessage),
    transcript,
    status: response.type === "interaction" ? "suspended" : "success",
  });
  if (response.memoryCompaction !== undefined && !run.memoryCompactionLogged) {
    await appendSessionLog(
      run.sessionStore,
      memoryCompactedLog({
        sessionId: run.session.id,
        runId: run.runId,
        ...response.memoryCompaction,
      }),
    );
    run.memoryCompactionLogged = true;
  }
  await appendSessionLog(
    run.sessionStore,
    response.type === "interaction"
      ? {
          sessionId: run.session.id,
          runId: run.runId,
          level: "info",
          category: "run",
          event: "run.suspended",
          message: `Run suspended for ${response.interaction.type}`,
          metadata: {
            interactionId: response.interaction.id,
            interactionType: response.interaction.type,
            toolName: response.interaction.toolName,
            sourceRunId: response.continuation.sourceRunId,
          },
        }
      : runCompletedLog({
          sessionId: run.session.id,
          runId: run.runId,
          durationMs,
          usage: response.usage,
          output: response.text,
          messageCount: response.messages.length,
        }),
  );
  if (response.resumedFrom !== undefined) {
    const responseMessage = response.messages[0];
    const responsePart = responseMessage?.role === "tool" ? responseMessage.content[0] : undefined;
    if (responsePart !== undefined && responsePart.type !== "tool-result") {
      const metadata: JsonObject = {
        interactionId: responsePart.interactionId,
        interactionType:
          responsePart.type === "tool-approval-response" ? "tool-approval" : "tool-question",
        toolName: responsePart.toolName,
        sourceRunId: response.resumedFrom.runId,
      };
      if (responsePart.type === "tool-approval-response") {
        metadata.approved = responsePart.approved;
        metadata.hasReason = responsePart.reason !== undefined;
      } else {
        metadata.answerCount = responsePart.answers.length;
      }
      await appendSessionLog(run.sessionStore, {
        sessionId: run.session.id,
        runId: run.runId,
        level: "info",
        category: "run",
        event: "interaction.responded",
        message: `Interaction response received for ${responsePart.toolName}`,
        metadata,
      });
    }
    await appendSessionLog(run.sessionStore, {
      sessionId: run.session.id,
      runId: run.runId,
      level: "info",
      category: "run",
      event: "interaction.resumed",
      message: "Interaction resumed in a linked run",
      metadata: {
        interactionId: response.resumedFrom.interactionId,
        sourceRunId: response.resumedFrom.runId,
        resumedRunId: response.runId,
      },
    });
  }
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

  const durationMs = Date.now() - run.runStartedAt;
  const messages = run.failureMessages ?? [run.body.messages.at(-1) as UserMessage];
  const transcript = transcriptFromMessages([...messages]);
  assignTranscriptRunDuration(transcript, durationMs);
  await run.sessionStore.saveSessionRunTranscript({
    id: run.session.id,
    runId: run.runId,
    ...optionalTitle(run.body.messages.at(-1) as UserMessage),
    transcript,
    status: "error",
    error: serializeError(error),
  });
  await appendSessionLog(
    run.sessionStore,
    runFailedLog(run.session.id, run.runId, error, run.runStartedAt),
  );
}

function usesStoreAsAgentMemory(agent: Agent, store: StudioSessionStore): boolean {
  const memoryStore = agent.memory?.store;
  return memoryStore !== undefined && rawObservedStore(memoryStore) === rawObservedStore(store);
}
