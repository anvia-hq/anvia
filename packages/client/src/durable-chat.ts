import type { AgentPrompt, AgentSteerInput } from "@anvia/core/agent";
import type { JsonObject, Message, ToolResultOutput } from "@anvia/core/completion";
import { isJsonValue } from "@anvia/core/completion";
import type { DurableEvent } from "@anvia/durable/protocol";
import { DurableHttpError, type DurableClient } from "./durable";
import {
  createDurableChatMapState,
  mapDurableChatEvent,
  needsSettledOutcome,
  statusEventStatus,
  type DurableChatMapState,
} from "./durable-chat-map";
import { createClientId } from "./messages";
import {
  CLIENT_STREAM_PROTOCOL,
  type ClientStreamCursor,
  type ClientStreamFrame,
  type ClientStreamRequest,
  type ClientTransport,
  type ClientTransportSendOptions,
} from "./types";

/**
 * Thrown when a submission is rejected because the session already has unfinished work (HTTP 409).
 * `runId` is that run when it could be read back from the session; `undefined` when the lookup
 * failed. Reattach to `runId` instead of submitting again. Aborting a stream never raises this.
 */
export class DurableBusyError extends Error {
  readonly code = "session_busy" as const;

  constructor(
    readonly runId: string | undefined,
    message = "Session already has unfinished work.",
  ) {
    super(message);
    this.name = "DurableBusyError";
  }
}

const UNFINISHED = new Set([
  "queued",
  "retry_wait",
  "pending",
  "running",
  "waiting",
  "needs_attention",
]);

/** Methods the adapter needs. A structural subset of `DurableClient`, so tests can fake it. */
export type DurableChatClient = Pick<
  DurableClient,
  "submit" | "stream" | "snapshot" | "respond" | "resolveTool" | "retry" | "cancel" | "listRuns"
> &
  // Optional so a client written before these methods existed still satisfies the type.
  Partial<Pick<DurableClient, "resolveMemoryWrite" | "steer">>;

/**
 * Run controls that `useChat` does not expose. `stop()` only aborts the subscription; cancellation
 * is always this explicit `cancel()`.
 */
export type DurableChatController = {
  /** Run last submitted or reattached. Undefined before the first successful send. */
  readonly activeRunId: string | undefined;
  /**
   * Last known status of `activeRunId` (for example `running`, `waiting`, `retry_wait`,
   * `needs_attention`). Updated from the submit response, a resume snapshot and status events.
   */
  readonly status: string | undefined;
  /** Called after `activeRunId` or `status` changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Point later interaction responses and `send({ resume })` at an existing run. */
  reattach(runId: string, after?: number): void;
  /** Add a user message to a running run. The run applies it at its next model step. */
  steer(input: AgentSteerInput, runId?: string): Promise<void>;
  cancel(runId?: string): Promise<void>;
  retry(runId?: string): Promise<void>;
  resolveTool(operationId: string, output: ToolResultOutput, runId?: string): Promise<void>;
  /** Settle a blocked recorded memory write: `applied` says the store holds it, `discarded` drops it. */
  resolveMemoryWrite(
    operationKey: string,
    resolution: "applied" | "discarded",
    runId?: string,
  ): Promise<void>;
};

export type CreateDurableChatTransportOptions = {
  client: DurableChatClient;
  agentId: string;
  sessionId: string;
  /** Defaults to a UUID per submission. Return a stable id to deduplicate one prompt. */
  requestId?: () => string;
  /** Queue behind unfinished session work instead of failing. Defaults to true. */
  enqueue?: boolean;
};

export type DurableChatTransport = ClientTransport<ClientStreamRequest> & {
  readonly controller: DurableChatController;
};

type Session = {
  activeRunId?: string;
  status?: string | undefined;
  /** Durable sequence last applied for `activeRunId`. Interaction responses resume after it. */
  cursor: number;
  map: DurableChatMapState;
};

/**
 * Transport `useChat` can pass to talk to `@anvia/durable`.
 *
 * Only the last user message of a `messages` request is submitted; durable keeps the transcript,
 * so the rest of the client history is discarded. An `interaction_response` is delivered to the
 * remembered run and then the stream resumes from the last applied sequence. Abort detaches the
 * SSE subscription and does not cancel the run.
 */
export function createDurableChatTransport(
  options: CreateDurableChatTransportOptions,
): DurableChatTransport {
  const session: Session = { cursor: 0, map: createDurableChatMapState() };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // A new run starts with an unknown status until the submit response or a status event reports it.
  const track = (runId: string, status: string | undefined) => {
    if (session.activeRunId === runId && session.status === status) return;
    session.activeRunId = runId;
    session.status = status;
    notify();
  };
  const observe = (runId: string, status: string | undefined) => {
    if (status === undefined || session.activeRunId !== runId || session.status === status) return;
    session.status = status;
    notify();
  };

  // Cancel and retry change the status without a stream attached to report it.
  const refreshStatus = async (runId: string) => {
    try {
      observe(runId, (await options.client.snapshot(runId)).run.status);
    } catch {
      // Advisory only; the control itself succeeded.
    }
  };

  const controller: DurableChatController = {
    get activeRunId() {
      return session.activeRunId;
    },
    get status() {
      return session.status;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    reattach(runId, after = 0) {
      assertCursor(after);
      session.map = createDurableChatMapState(after);
      session.cursor = after;
      track(requireId(runId, "runId"), undefined);
    },
    async steer(input, runId) {
      const steer = options.client.steer;
      if (steer === undefined) throw new TypeError("The durable client does not support steer.");
      await steer.call(options.client, resolveRun(session, runId), input);
    },
    async cancel(runId) {
      const id = resolveRun(session, runId);
      await options.client.cancel(id);
      await refreshStatus(id);
    },
    async retry(runId) {
      const id = resolveRun(session, runId);
      await options.client.retry(id);
      await refreshStatus(id);
    },
    resolveTool(operationId, output, runId) {
      return options.client.resolveTool(resolveRun(session, runId), operationId, output);
    },
    resolveMemoryWrite(operationKey, resolution, runId) {
      const resolve = options.client.resolveMemoryWrite;
      if (resolve === undefined)
        return Promise.reject(
          new TypeError("The durable client does not support resolveMemoryWrite."),
        );
      return resolve.call(options.client, resolveRun(session, runId), operationKey, resolution);
    },
  };

  return {
    controller,
    async *send(send) {
      const target = await begin(options, session, send);
      // A new run, or a resume behind the applied cursor, needs a fresh projection. Reusing the
      // run's existing projection keeps `run_start` and open messages from being emitted twice.
      if (session.activeRunId !== target.runId || target.after < session.cursor) {
        session.map = createDurableChatMapState(target.after);
      }
      session.cursor = target.after;
      track(
        target.runId,
        target.status ?? (session.activeRunId === target.runId ? session.status : undefined),
      );
      yield* streamFrames(options.client, session, target.runId, send.abortSignal, observe);
    },
  };
}

async function begin(
  options: CreateDurableChatTransportOptions,
  session: Session,
  send: ClientTransportSendOptions<ClientStreamRequest>,
): Promise<{ runId: string; after: number; status?: string | undefined }> {
  const resume = send.resume ?? send.request.resume;
  if (resume !== undefined) {
    assertCursor(resume.after);
    const runId = requireId(resume.streamId, "streamId");
    // Status events behind the cursor are not replayed, so read the current status once.
    return { runId, after: resume.after, status: await currentStatus(options.client, runId, send) };
  }
  if (send.request.type === "interaction_response") {
    if (session.activeRunId === undefined) {
      throw new Error("No active durable run to receive the interaction response.");
    }
    await options.client.respond(
      session.activeRunId,
      send.request.interactionId,
      send.request.response,
      send.abortSignal === undefined ? {} : { abortSignal: send.abortSignal },
    );
    return { runId: session.activeRunId, after: session.cursor };
  }
  const submitted = await submitPrompt(options, send);
  return { runId: submitted.runId, after: 0, status: submitted.status };
}

async function currentStatus(
  client: DurableChatClient,
  runId: string,
  send: ClientTransportSendOptions<ClientStreamRequest>,
): Promise<string | undefined> {
  try {
    const snapshot = await client.snapshot(
      runId,
      send.abortSignal === undefined ? {} : { abortSignal: send.abortSignal },
    );
    return snapshot.run.status;
  } catch {
    // The status is advisory; the stream below reports a missing run itself.
    return undefined;
  }
}

async function submitPrompt(
  options: CreateDurableChatTransportOptions,
  send: ClientTransportSendOptions<ClientStreamRequest>,
): Promise<{ runId: string; status: string }> {
  if (send.request.type !== "messages") {
    throw new TypeError("Unsupported durable chat request.");
  }
  const prompt = lastUserPrompt(send.request.messages);
  const requestId = options.requestId?.() ?? createClientId("durable");
  const requestOptions: { enqueue: boolean; abortSignal?: AbortSignal } = {
    enqueue: options.enqueue ?? true,
  };
  if (send.abortSignal !== undefined) requestOptions.abortSignal = send.abortSignal;
  try {
    const snapshot = await options.client.submit(
      { agentId: options.agentId, sessionId: options.sessionId, requestId, prompt },
      requestOptions,
    );
    return { runId: snapshot.run.id, status: snapshot.run.status };
  } catch (error) {
    if (!isSessionBusy(error)) throw error;
    throw new DurableBusyError(await findBusyRun(options, send.abortSignal), error.message);
  }
}

async function* streamFrames(
  client: DurableChatClient,
  session: Session,
  runId: string,
  abortSignal: AbortSignal | undefined,
  observe: (runId: string, status: string | undefined) => void,
): AsyncIterable<ClientStreamFrame> {
  // The event id is the durable sequence, which is not contiguous per stream. See the note in
  // durable-chat-map.ts for why validateFrameSequence must not wrap this generator.
  yield {
    type: "stream_start",
    protocol: CLIENT_STREAM_PROTOCOL,
    streamId: runId,
    eventId: 0,
    resumable: true,
  };
  let lastEventId = session.cursor;
  const streamOptions =
    abortSignal === undefined ? { after: session.cursor } : { after: session.cursor, abortSignal };
  try {
    for await (const event of client.stream(runId, streamOptions)) {
      const settled = needsSettledOutcome(event)
        ? await snapshotOutcome(client, runId, event, abortSignal)
        : undefined;
      const mapped = mapDurableChatEvent(event, session.map, settled);
      session.map = mapped.state;
      session.cursor = mapped.state.sequence;
      observe(runId, statusEventStatus(event));
      lastEventId = mapped.state.sequence;
      for (const clientEvent of mapped.events) {
        yield {
          type: "stream_event",
          streamId: runId,
          eventId: event.sequence,
          event: clientEvent,
        };
      }
    }
  } catch (error) {
    if (!isAbort(error, abortSignal)) {
      yield { type: "stream_end", streamId: runId, eventId: lastEventId, status: "error" };
    }
    throw error;
  }
  yield { type: "stream_end", streamId: runId, eventId: lastEventId, status: "completed" };
}

/**
 * The outcome for a settled status event, read from the run snapshot (DUR-07 keeps it out of the
 * event). If the run has moved past that status, the snapshot describes a later point, so nothing
 * is returned and the event maps without its outcome.
 */
async function snapshotOutcome(
  client: DurableChatClient,
  runId: string,
  event: DurableEvent,
  abortSignal: AbortSignal | undefined,
): Promise<JsonObject | undefined> {
  const snapshot = await client.snapshot(runId, abortSignal === undefined ? {} : { abortSignal });
  if (snapshot.run.status !== statusEventStatus(event)) return undefined;
  const outcome: unknown = snapshot.run.outcome;
  return typeof outcome === "object" &&
    outcome !== null &&
    !Array.isArray(outcome) &&
    isJsonValue(outcome)
    ? (outcome as JsonObject)
    : undefined;
}

function lastUserPrompt(messages: readonly Message[]): AgentPrompt {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message;
  }
  throw new TypeError("Durable chat requires a user message to submit.");
}

function isSessionBusy(error: unknown): error is DurableHttpError {
  // A submit conflict means this session already has an unfinished run.
  return error instanceof DurableHttpError && error.status === 409;
}

async function findBusyRun(
  options: CreateDurableChatTransportOptions,
  abortSignal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const page = await options.client.listRuns(
      { sessionId: options.sessionId, limit: 100 },
      abortSignal === undefined ? {} : { abortSignal },
    );
    return page.runs.find((run) => UNFINISHED.has(run.status))?.id;
  } catch {
    return undefined;
  }
}

function resolveRun(session: Session, runId: string | undefined): string {
  return requireId(runId ?? session.activeRunId, "run");
}

function requireId(value: string | undefined, label: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(label === "run" ? "No active durable run." : `${label} must not be empty.`);
  }
  return value;
}

function assertCursor(after: number): void {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new TypeError("Invalid durable resume cursor.");
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

export type { ClientStreamCursor };
