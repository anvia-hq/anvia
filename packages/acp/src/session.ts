import { MaxTurnsError } from "@anvia/core/agent";
import type { AgentInput, AgentOutcome } from "@anvia/core/agent";
import { convertPrompt, type PromptBlock } from "./content.js";
import { TurnEvents, type UpdateSink } from "./events.js";
import { AcpError } from "./errors.js";
import { SessionMemory } from "./memory.js";
import { PendingRequests } from "./pending-requests.js";
import type { AcpLimits, AcpSessionBinding, AcpSessionContext } from "./types.js";

export type TurnStopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal";

export class AcpSession {
  readonly memory: SessionMemory;
  readonly pendingRequests: PendingRequests;
  private activePrompt: Promise<TurnStopReason> | undefined;
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
    if (this.activePrompt) return Promise.reject(new AcpError("session_busy"));
    // Reserve before the first await, including history loading and content conversion.
    const task = this.run(blocks, send).finally(() => {
      this.activePrompt = undefined;
    });
    this.activePrompt = task;
    return task;
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

  private async run(blocks: readonly PromptBlock[], send: UpdateSink): Promise<TurnStopReason> {
    try {
      const prompt = convertPrompt(blocks, this.limits, this.images);
      const scope = { sessionId: this.context.sessionId };
      const history = await this.memory.load({ scope });
      const messages = [...history, prompt];
      this.memory.assertFits(messages);
      const input: AgentInput = { messages };
      if (this.controller.signal.aborted) throw new AcpError("connection_closed");
      const options = { ...input, abortSignal: this.controller.signal };
      const agent = this.binding.agent;
      const events = new TurnEvents(
        () => `${this.context.sessionId}:${++this.nextToolId}`,
        this.context.cwd,
        this.binding,
        this.reasoning,
        async (update) => {
          if (this.controller.signal.aborted) throw new AcpError("connection_closed");
          await send(update);
        },
      );
      let outcome: AgentOutcome;
      if (agent.model.capabilities.streaming) {
        outcome = await events.consume(agent.stream(options));
      } else {
        outcome = await agent.generate(options);
        await events.completed(outcome);
      }
      if (this.controller.signal.aborted) throw new AcpError("connection_closed");
      if (outcome.type === "interaction") throw new AcpError("unsupported_interaction");
      // Only complete, successful turns enter memory. Failed/suspended turns cannot
      // leave unmatched tool calls or duplicate user messages in the next request.
      if (outcome.type === "blocked") return "refusal";
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
      if (this.controller.signal.aborted) throw new AcpError("connection_closed");
      if (error instanceof AcpError) throw error;
      if (error instanceof MaxTurnsError) return "max_turn_requests";
      throw new AcpError("execution_failed");
    }
  }
}
