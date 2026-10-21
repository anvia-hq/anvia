import { AgentRunCancelledError, MaxTurnsError } from "@anvia/core/agent";
import type { AgentInput, AgentOutcome, AgentStream } from "@anvia/core/agent";
import type { Message } from "@anvia/core/completion";
import { requestInteraction, type InteractionClient } from "./permissions.js";
import { TurnBudget, TurnBudgetExceeded } from "./turn-budget.js";
import { convertPrompt, type PromptBlock } from "./content.js";
import { TurnEvents, type UpdateSink } from "./events.js";
import { AcpError } from "./errors.js";
import { randomUUID } from "node:crypto";
import { Transcript, type AcpTranscriptEntry } from "./transcript.js";
import type { AcpSessionRecord, AcpSessionStore } from "./session-store.js";
import { SessionMemory } from "./memory.js";
import type { SessionConfiguration } from "./config.js";
import { PendingRequests } from "./pending-requests.js";
import type { AcpLimits, AcpSessionBinding, AcpSessionContext, AcpSessionConfig } from "./types.js";

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
  budgetExceeded: boolean;
  finished: boolean;
  sending: Promise<void>;
};

export class AcpSession {
  readonly memory: SessionMemory;
  pendingRequests: PendingRequests;
  private activePrompt: Promise<void> | undefined;
  private activeTurn: ActiveTurn | undefined;
  private nextToolId = 0;
  // Uncommitted cards may remain in a client's view after silent resume. A fresh
  // runtime namespace prevents their IDs from colliding with newly allocated cards.
  private readonly toolIdNamespace = randomUUID();
  private record: AcpSessionRecord | undefined;
  private updating: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private cancelling: Promise<void> | undefined;

  constructor(
    public context: AcpSessionContext,
    private binding: AcpSessionBinding,
    private readonly controller: AbortController,
    private readonly limits: AcpLimits,
    private readonly images: boolean,
    private readonly reasoning = false,
    private readonly features?: {
      configuration: SessionConfiguration;
      embeddedContext: boolean;
      rebuild: (
        config: AcpSessionConfig,
      ) => Promise<{ context: AcpSessionContext; binding: AcpSessionBinding }>;
      cleanup: () => Promise<void>;
      persistence?: { record: AcpSessionRecord; store: AcpSessionStore };
    },
  ) {
    this.record = features?.persistence?.record;
    this.nextToolId = this.record?.nextToolId ?? 0;
    this.memory = new SessionMemory(context.sessionId, limits, this.record?.messages);
    this.pendingRequests = new PendingRequests(limits.maxPendingRequests);
  }

  prompt(
    blocks: readonly PromptBlock[],
    send: UpdateSink = async () => {},
    client?: InteractionClient,
  ): Promise<TurnStopReason> {
    if (this.controller.signal.aborted) return Promise.reject(new AcpError("connection_closed"));
    if (this.activeTurn || this.updating || this.cancelling)
      return Promise.reject(new AcpError("session_busy"));
    // Reserve synchronously, including history loading and content conversion. The
    // turn object is its identity: a cancelled run never shares state with a new run.
    const turn: ActiveTurn = {
      controller: new AbortController(),
      cancelled: false,
      budgetExceeded: false,
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
        if (turn.budgetExceeded) resolve("max_turn_requests");
        else if (turn.cancelled) resolve("cancelled");
        else reject(new AcpError("connection_closed"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const onClose = () => {
      if (!turn.finished) turn.controller.abort();
    };
    this.controller.signal.addEventListener("abort", onClose, { once: true });
    let executionFinished = false;
    const requests = this.pendingRequests;
    const budget = new TurnBudget(this.binding.turnBudget, this.binding.agent.defaultMaxTurns);
    const duration = this.binding.turnBudget?.maxDurationMs;
    const timer =
      duration === undefined
        ? undefined
        : setTimeout(() => {
            if (turn.finished || turn.cancelled) return;
            turn.budgetExceeded = true;
            requests.close(new TurnBudgetExceeded());
            turn.controller.abort();
            turn.stream?.cancel("ACP turn budget exhausted.");
          }, duration);
    const execution = this.run(blocks, send, turn, requests, budget, client).finally(() => {
      executionFinished = true;
    });
    const task = Promise.race([execution, aborted])
      .then(async (reason) => {
        // Updates already handed to the transport precede the final response.
        await turn.sending.catch(() => undefined);
        return turn.cancelled ? ("cancelled" as const) : reason;
      })
      .finally(() => {
        clearTimeout(timer);
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

  get busy(): boolean {
    return this.activeTurn !== undefined || this.updating !== undefined || !!this.cancelling;
  }

  get durable(): boolean {
    return this.binding.driver !== undefined;
  }

  get configOptions() {
    return this.features?.configuration.options(this.context.config) ?? [];
  }

  setConfig(id: string, value: unknown): Promise<void> {
    if (this.controller.signal.aborted) return Promise.reject(new AcpError("connection_closed"));
    if (this.durable) return Promise.reject(new AcpError("invalid_config"));
    if (this.updating) return Promise.reject(new AcpError("session_busy"));
    const features = this.features;
    if (!features) return Promise.reject(new AcpError("invalid_config"));
    let config: AcpSessionConfig;
    try {
      config = features.configuration.change(this.context.config, id, value);
    } catch (error) {
      return Promise.reject(error);
    }
    if (config.mode === this.context.config.mode && config.model === this.context.config.model)
      return Promise.resolve();
    this.cancel();
    const update = (async () => {
      await this.activePrompt;
      this.controller.signal.throwIfAborted();
      const next = await features.rebuild(config);
      if (this.controller.signal.aborted) {
        await next.binding.dispose?.();
        throw new AcpError("connection_closed");
      }
      if (next.binding.driver) throw new AcpError("configuration_error");
      try {
        await this.persist({ config });
      } catch (error) {
        await next.binding.dispose?.();
        throw error;
      }
      const previous = this.binding;
      this.binding = next.binding;
      this.context = next.context;
      // The new binding is committed; never restore a disposed old agent.
      try {
        await previous.dispose?.();
      } catch {
        this.controller.abort();
        throw new AcpError("configuration_error");
      }
    })().finally(() => {
      this.updating = undefined;
    });
    this.updating = update;
    return update;
  }

  /** Detached, allowlisted display history; never exposes private model messages. */
  transcript(): readonly AcpTranscriptEntry[] {
    return new Transcript(this.context.cwd, this.limits.maxHistoryBytes, this.record?.transcript)
      .entries;
  }

  private async persist(changes: Partial<AcpSessionRecord>): Promise<void> {
    if (!this.record || !this.features?.persistence) return;
    const next = { ...this.record, ...changes, updatedAt: new Date().toISOString() };
    await this.features.persistence.store.put(structuredClone(next));
    this.record = next;
  }

  cancel(): Promise<void> {
    if (this.cancelling) return this.cancelling;
    const turn = this.activeTurn;
    if (turn?.finished) return Promise.resolve();
    if (turn && !turn.cancelled) {
      turn.cancelled = true;
      const reason = new AgentRunCancelledError([], "ACP prompt cancelled.");
      this.pendingRequests.close(reason);
      turn.controller.abort(reason);
      turn.stream?.cancel("ACP prompt cancelled.");
    }
    const driver = this.binding.driver;
    if (!driver) return Promise.resolve();
    // Wait for a possible in-flight write-ahead save before cancelling its submission.
    this.cancelling = (async () => {
      await this.activePrompt;
      const pending = this.record?.pendingRun;
      if (pending) {
        if ((await driver.cancel(this.context.sessionId, pending.requestId)) === "cancelled")
          await this.persist({ pendingRun: undefined });
      }
    })().finally(() => {
      this.cancelling = undefined;
    });
    return this.cancelling;
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
    await this.cancelling?.catch(() => undefined);
    await this.updating?.catch(() => undefined);
    await this.memory.clear({ scope: { sessionId: this.context.sessionId } });
    try {
      await this.binding.dispose?.();
    } finally {
      await this.features?.cleanup();
    }
  }

  private async run(
    blocks: readonly PromptBlock[],
    send: UpdateSink,
    turn: ActiveTurn,
    requests: PendingRequests,
    budget: TurnBudget,
    client?: InteractionClient,
  ): Promise<TurnStopReason> {
    try {
      if (this.binding.driver) return await this.runDurable(blocks, send, turn, requests, client);
      // Validate the original payload as well as any trusted command expansion.
      let prompt = convertPrompt(blocks, this.limits, this.images, this.features?.embeddedContext);
      if (blocks.length === 1 && blocks[0]?.type === "text") {
        const match = /^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(blocks[0].text);
        const command =
          match && this.features?.configuration.commands.find((entry) => entry.name === match[1]);
        if (command) {
          const expanded = command.expand(match?.[2] ?? "", this.context);
          if (typeof expanded !== "string") throw new AcpError("configuration_error");
          prompt = convertPrompt([{ type: "text", text: expanded }], this.limits, this.images);
        }
      }
      const scope = { sessionId: this.context.sessionId };
      const history = await this.memory.load({ scope });
      const messages = [...history, prompt];
      this.memory.assertFits(messages);
      let input: AgentInput = { messages };
      if (this.controller.signal.aborted) throw new AcpError("connection_closed");
      if (turn.cancelled) return "cancelled";

      const transcript = new Transcript(
        this.context.cwd,
        this.limits.maxHistoryBytes,
        this.record?.transcript,
      );
      // Preserve the user's original command, not a private host expansion.
      for (const block of blocks) {
        if (block.type !== "unsupported") transcript.add({ type: "user", content: block });
      }
      const agent = this.binding.agent;
      const events = new TurnEvents(
        () => `${this.context.sessionId}:${this.toolIdNamespace}:${++this.nextToolId}`,
        this.context.cwd,
        this.binding,
        this.reasoning,
        async (update) => {
          if (this.controller.signal.aborted) throw new AcpError("connection_closed");
          if (turn.controller.signal.aborted || turn.finished) return;
          transcript.add(update);
          turn.sending = send(update);
          await turn.sending;
        },
        turn.controller.signal,
      );
      let outcome: AgentOutcome;
      const produced: Message[] = [];
      while (true) {
        budget.check();
        turn.controller.signal.throwIfAborted();
        const options = {
          ...input,
          abortSignal: turn.controller.signal,
          middlewares: [budget.middleware],
          lifecycle: budget.segment(),
        };
        if (agent.model.capabilities.streaming) {
          turn.stream = agent.stream(options);
          outcome = await events.consume(turn.stream);
        } else {
          outcome = await agent.generate(options);
          if (!turn.controller.signal.aborted) await events.completed(outcome);
        }
        delete turn.stream;
        if (this.controller.signal.aborted) throw new AcpError("connection_closed");
        turn.controller.signal.throwIfAborted();
        budget.check();
        produced.push(...outcome.messages);
        this.memory.assertFits([...history, ...produced]);
        if (outcome.type !== "interaction") break;
        const response = await requestInteraction(
          outcome,
          events,
          requests,
          client,
          this.context.clientCapabilities.elicitationForm,
        );
        // No await between the identity/signal check and the next stream creation.
        if (this.activeTurn !== turn || turn.controller.signal.aborted) {
          turn.controller.signal.throwIfAborted();
          return "cancelled";
        }
        if (response === "cancel") {
          this.cancel();
          return "cancelled";
        }
        budget.check();
        input = { continuation: outcome.continuation, response };
        events.beginSegment();
      }
      // Only complete, successful turns enter memory. Failed/suspended turns cannot
      // leave unmatched tool calls or duplicate user messages in the next request.
      if (outcome.type === "blocked") return "refusal";
      // Starting the atomic store commit is the completion boundary. Cancellation
      // cannot abandon an in-flight write whose outcome is not yet known.
      turn.finished = true;
      await this.persist({
        title:
          this.record?.messages.length === 0
            ? blocks
                .find((block) => block.type === "text")
                ?.text.replace(/\p{Cc}/gu, " ")
                .trim()
                .slice(0, 200) || "Untitled session"
            : (this.record?.title ?? "Untitled session"),
        messages: [...history, ...produced],
        transcript: transcript.entries,
        nextToolId: this.nextToolId,
      });
      await this.memory.append({
        scope,
        runId: outcome.runId,
        turn: 0,
        // Core returns this run's messages (including the new user prompt),
        // excluding the chatHistory supplied to the run.
        messages: produced,
      });
      if (outcome.finishReason === "length") return "max_tokens";
      if (outcome.finishReason === "content-filter") return "refusal";
      return "end_turn";
    } catch (error) {
      if (turn.budgetExceeded || error instanceof TurnBudgetExceeded) return "max_turn_requests";
      if (turn.cancelled || error instanceof AgentRunCancelledError) return "cancelled";
      if (this.controller.signal.aborted) throw new AcpError("connection_closed");
      if (error instanceof AcpError) throw error;
      if (error instanceof MaxTurnsError) return "max_turn_requests";
      throw new AcpError("execution_failed");
    }
  }

  private async runDurable(
    blocks: readonly PromptBlock[],
    send: UpdateSink,
    turn: ActiveTurn,
    requests: PendingRequests,
    client?: InteractionClient,
  ): Promise<TurnStopReason> {
    const driver = this.binding.driver!;
    if (!this.features?.persistence) throw new AcpError("configuration_error");
    let pending = this.record?.pendingRun;
    if (pending && blocks.length !== 0) throw new AcpError("session_busy");
    if (!pending) {
      let prompt = convertPrompt(blocks, this.limits, this.images, this.features?.embeddedContext);
      if (blocks.length === 1 && blocks[0]?.type === "text") {
        const match = /^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(blocks[0].text);
        const command =
          match && this.features?.configuration.commands.find((c) => c.name === match[1]);
        if (command) {
          const expanded = command.expand(match?.[2] ?? "", this.context);
          if (typeof expanded !== "string") throw new AcpError("configuration_error");
          prompt = convertPrompt([{ type: "text", text: expanded }], this.limits, this.images);
        }
      }
      this.memory.assertFits([...(this.record?.messages ?? []), prompt]);
      pending = { requestId: randomUUID(), prompt, blocks: structuredClone(blocks) };
      // Persist before submit. Re-delivery after either store commit uses this same request ID.
      turn.controller.signal.throwIfAborted();
      await this.persist({ pendingRun: pending });
    }
    const transcript = new Transcript(
      this.context.cwd,
      this.limits.maxHistoryBytes,
      this.record?.transcript,
    );
    for (const block of pending.blocks) {
      if (block.type !== "unsupported") transcript.add({ type: "user", content: block });
    }
    let nextId = 0;
    const events = new TurnEvents(
      () => `${this.context.sessionId}:${pending.requestId}:${++nextId}`,
      this.context.cwd,
      this.binding,
      false,
      async (update) => {
        turn.controller.signal.throwIfAborted();
        transcript.add(update);
        turn.sending = send(update);
        await turn.sending;
      },
      turn.controller.signal,
    );
    const result = await driver.execute({
      sessionId: this.context.sessionId,
      pending,
      historyLength: this.record?.messages.length ?? 0,
      signal: turn.controller.signal,
      project: (outcome) => events.completed(outcome),
      interact: async (outcome) => {
        const response = await requestInteraction(
          outcome,
          events,
          requests,
          client,
          this.context.clientCapabilities.elicitationForm,
        );
        events.beginSegment();
        return response;
      },
    });
    turn.controller.signal.throwIfAborted();
    if (result === "cancelled" || result === "max_turn_requests") {
      turn.finished = true;
      await this.persist({ pendingRun: undefined });
      return result;
    }
    this.memory.assertFits(result.messages);
    turn.finished = true;
    await this.persist({
      pendingRun: undefined,
      messages: result.messages,
      transcript: transcript.entries,
      title:
        this.record?.messages.length === 0
          ? pending.blocks
              .find((block) => block.type === "text")
              ?.text.replace(/\p{Cc}/gu, " ")
              .trim()
              .slice(0, 200) || "Untitled session"
          : (this.record?.title ?? "Untitled session"),
    });
    const outcome = result.outcome;
    if (outcome.type === "blocked") return "refusal";
    if (outcome.type === "response" && outcome.finishReason === "length") return "max_tokens";
    if (outcome.type === "response" && outcome.finishReason === "content-filter") return "refusal";
    return "end_turn";
  }
}
