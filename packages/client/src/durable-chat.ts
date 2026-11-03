import type { AgentPrompt } from "@anvia/core/agent";
import type { Message, ToolResultOutput } from "@anvia/core/completion";
import { DurableHttpError, type DurableClient } from "./durable";
import {
  createDurableChatMapState,
  mapDurableChatEvent,
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

const BUSY_MESSAGE = "Session already has unfinished work.";
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
  "submit" | "stream" | "respond" | "resolveTool" | "retry" | "cancel" | "listRuns"
>;

/**
 * Run controls that `useChat` does not expose. `stop()` only aborts the subscription; cancellation
 * is always this explicit `cancel()`.
 */
export type DurableChatController = {
  /** Run last submitted or reattached. Undefined before the first successful send. */
  readonly activeRunId: string | undefined;
  /** Point later interaction responses and `send({ resume })` at an existing run. */
  reattach(runId: string, after?: number): void;
  cancel(runId?: string): Promise<void>;
  retry(runId?: string): Promise<void>;
  resolveTool(operationId: string, output: ToolResultOutput, runId?: string): Promise<void>;
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

  const controller: DurableChatController = {
    get activeRunId() {
      return session.activeRunId;
    },
    reattach(runId, after = 0) {
      assertCursor(after);
      session.activeRunId = requireId(runId, "runId");
      session.cursor = after;
      session.map = createDurableChatMapState(after);
    },
    cancel(runId) {
      return options.client.cancel(resolveRun(session, runId));
    },
    retry(runId) {
      return options.client.retry(resolveRun(session, runId));
    },
    resolveTool(operationId, output, runId) {
      return options.client.resolveTool(resolveRun(session, runId), operationId, output);
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
      session.activeRunId = target.runId;
      session.cursor = target.after;
      yield* streamFrames(options.client, session, target.runId, send.abortSignal);
    },
  };
}

async function begin(
  options: CreateDurableChatTransportOptions,
  session: Session,
  send: ClientTransportSendOptions<ClientStreamRequest>,
): Promise<{ runId: string; after: number }> {
  const resume = send.resume ?? send.request.resume;
  if (resume !== undefined) {
    assertCursor(resume.after);
    return { runId: requireId(resume.streamId, "streamId"), after: resume.after };
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
  const snapshot = await submitPrompt(options, send);
  return { runId: snapshot, after: 0 };
}

async function submitPrompt(
  options: CreateDurableChatTransportOptions,
  send: ClientTransportSendOptions<ClientStreamRequest>,
): Promise<string> {
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
    return snapshot.run.id;
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
      const mapped = mapDurableChatEvent(event, session.map);
      session.map = mapped.state;
      session.cursor = mapped.state.sequence;
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

function lastUserPrompt(messages: readonly Message[]): AgentPrompt {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message;
  }
  throw new TypeError("Durable chat requires a user message to submit.");
}

function isSessionBusy(error: unknown): error is DurableHttpError {
  return (
    error instanceof DurableHttpError && error.status === 409 && error.message === BUSY_MESSAGE
  );
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
