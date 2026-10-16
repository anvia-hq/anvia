import { AgentRunCancelledError, MaxTurnsError } from "@anvia/core/agent";
import type { AgentInput, AgentOutcome, AgentStream } from "@anvia/core/agent";
import { convertPrompt, type PromptBlock } from "./content.js";
import { TurnEvents, type UpdateSink } from "./events.js";
import { AcpError } from "./errors.js";
import { SessionMemory } from "./memory.js";
import { PendingRequests } from "./pending-requests.js";
import type { AcpLimits, AcpSessionBinding, AcpSessionContext } from "./types.js";

export type TurnStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

type ActiveTurn = {
  controller: AbortController;
  stream?: AgentStream;
  cancelled: boolean;
  finished: boolean;
  sending: Promise<void>;
};

export class AcpSession {
  readonly memory: SessionMemory;
  pendingRequests: PendingRequests;
  private activePrompt: Promise<void> | undefined;
  private activeTurn: ActiveTurn | undefined;
  private nextToolId = 0;
  private closing: Promise<void> | undefined;

  constructor(
    readonly context: AcpSessionContext,
    private readonly binding: AcpSessionBinding,
    private readonly controller: AbortController,
    private readonly limits: AcpLimits,
    private readonly images: boolean,
    private readonly reasoning = false,
  ) {
    this.memory = new SessionMemory(context.sessionId, limits);
    this.pendingRequests = new PendingRequests(limits.maxPendingRequests);
  }

  prompt(
    blocks: readonly PromptBlock[],
    send: UpdateSink = async () => {},
  ): Promise<TurnStopReason> {
    if (this.controller.signal.aborted) return Promise.reject(new AcpError("connection_closed"));
    if (this.activeTurn) return Promise.reject(new AcpError("session_busy"));
    // Reserve synchronously, including history loading and content conversion. The
    // turn object is its identity: a cancelled run never shares state with a new run.
    const turn: ActiveTurn = {
      controller: new AbortController(),
      cancelled: false,
      finished: false,
      sending: Promise.resolve(),
    };
    this.activeTurn = turn;
    this.pendingRequests.close();
    this.pendingRequests = new PendingRequests(this.limits.maxPendingRequests);
    const signal = turn.controller.signal;
    let onAbort!: () => void;
    const aborted = new Promise<TurnStopReason>((resolve, reject) => {
      onAbort = () => {
        if (turn.cancelled) resolve("cancelled");
        else reject(new AcpError("connection_closed"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const onClose = () => turn.controller.abort();
    this.controller.signal.addEventListener("abort", onClose, { once: true });
    let executionFinished = false;
    const execution = this.run(blocks, send, turn).finally(() => {
      executionFinished = true;
    });
    const task = Promise.race([execution, aborted])
      .then(async (reason) => {
        // Updates already handed to the transport precede the final response.
        await turn.sending.catch(() => undefined);
        return turn.cancelled ? ("cancelled" as const) : reason;
      })
      .finally(() => {
        turn.finished = true;
        signal.removeEventListener("abort", onAbort);
        this.controller.signal.removeEventListener("abort", onClose);
        this.pendingRequests.close();
        if (executionFinished) this.activeTurn = undefined;
      });
    // Keep ownership until both RPC settlement and execution finish. Caller code
    // can ignore abort; it must not overlap another turn or race resource disposal.
    const cleanup = Promise.allSettled([execution, task]).then(() => {
      if (this.activeTurn === turn) this.activeTurn = undefined;
      if (this.activePrompt === cleanup) this.activePrompt = undefined;
    });
    this.activePrompt = cleanup;
    return task;
  }

  cancel(): void {
    const turn = this.activeTurn;
    if (!turn || turn.finished || turn.cancelled) return;
    turn.cancelled = true;
    const reason = new AgentRunCancelledError([], "ACP prompt cancelled.");
    this.pendingRequests.close(reason);
    turn.controller.abort(reason);
    turn.stream?.cancel("ACP prompt cancelled.");
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.pendingRequests.close();
      this.controller.abort();
      this.closing = this.dispose();
    }
    return this.closing;
  }

  private async dispose(): Promise<void> {
    // Do not dispose resources while an uncooperative tool is still using them.
    await this.activePrompt?.catch(() => undefined);
    await this.memory.clear({ scope: { sessionId: this.context.sessionId } });
    await this.binding.dispose?.();
  }

  private async run(
    blocks: readonly PromptBlock[],
    send: UpdateSink,
    turn: ActiveTurn,
  ): Promise<TurnStopReason> {
    try {
      const prompt = convertPrompt(blocks, this.limits, this.images);
      const scope = { sessionId: this.context.sessionId };
      const history = await this.memory.load({ scope });
      const messages = [...history, prompt];
      this.memory.assertFits(messages);
      const input: AgentInput = { messages };
      if (this.controller.signal.aborted) throw new AcpError("connection_closed");
      if (turn.cancelled) return "cancelled";
      const options = { ...input, abortSignal: turn.controller.signal };
      const agent = this.binding.agent;
      const events = new TurnEvents(
        () => `${this.context.sessionId}:${++this.nextToolId}`,
        this.context.cwd,
        this.binding,
        this.reasoning,
        async (update) => {
          if (this.controller.signal.aborted) throw new AcpError("connection_closed");
          if (turn.cancelled || turn.finished) return;
          turn.sending = send(update);
          await turn.sending;
        },
        turn.controller.signal,
      );
      let outcome: AgentOutcome;
      if (agent.model.capabilities.streaming) {
        turn.stream = agent.stream(options);
        outcome = await events.consume(turn.stream);
      } else {
        outcome = await agent.generate(options);
        if (!turn.cancelled) await events.completed(outcome);
      }
      if (this.controller.signal.aborted) throw new AcpError("connection_closed");
      if (turn.cancelled) return "cancelled";
      if (outcome.type === "interaction") throw new AcpError("unsupported_interaction");
      // Only complete, successful turns enter memory. Failed/suspended turns cannot
      // leave unmatched tool calls or duplicate user messages in the next request.
      if (outcome.type === "blocked") return "refusal";
      // Memory append is synchronous/atomic in SessionMemory. From this commit
      // point the completed turn wins over a later cancellation notification.
      turn.finished = true;
      await this.memory.append({
        scope,
        runId: outcome.runId,
        turn: 0,
        // Core returns this run's messages (including the new user prompt),
        // excluding the chatHistory supplied to the run.
        messages: outcome.messages,
      });
      if (outcome.finishReason === "length") return "max_tokens";
      if (outcome.finishReason === "content-filter") return "refusal";
      return "end_turn";
    } catch (error) {
      if (turn.cancelled || error instanceof AgentRunCancelledError) return "cancelled";
      if (this.controller.signal.aborted) throw new AcpError("connection_closed");
      if (error instanceof AcpError) throw error;
      if (error instanceof MaxTurnsError) return "max_turn_requests";
      throw new AcpError("execution_failed");
    }
  }
}
