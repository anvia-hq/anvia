import { AgentRunCancelledError, AgentStreamClosedError } from "../../agent/errors";
import {
  assertAgentInteractionResponse,
  parseAgentInteractionResponse,
} from "../../agent/interactions";
import { composeAgentLifecycle, lifecycleSnapshot } from "../../agent/lifecycle";
import { createResolvedAgent, getResolvedAgentOptions } from "../../agent/resolved-agent";
import type {
  AgentInput,
  AgentOutcome,
  AgentSteerInput,
  AgentSteerReceipt,
  AgentStreamEvent,
} from "../../agent/run-types";
import { AgentTeamInteractionError, AgentTeamLimitError } from "../../agent/team/errors";
import type {
  AgentTeamEvent,
  AgentTeamLimits,
  AgentTeamMember,
  AgentTeamMessage,
  AgentTeamOutcome,
  AgentTeamRunOptions,
} from "../../agent/team/types";
import { isStreamingCompletionModel } from "../../completion/generate-completion";
import { parseMessages, Usage, type CompletionResponse } from "../../completion";
import { throwIfAborted } from "../abort";
import { AgentRun } from "../agent-runtime/agent-run";
import { withInternalAgentRunOptions } from "../agent-runtime/run-options";
import { abortable, TeamChanges, TeamSlots } from "./coordination";
import {
  agentMessageInput,
  memberSummary,
  steeringMessages,
  type TeamInput,
  type TeamMember,
} from "./member";
import { TEAM_INSTRUCTIONS, teamTools } from "./tools";
import type { TeamPolicy } from "./policy";

export class TeamRun<Output = unknown> {
  readonly id = globalThis.crypto.randomUUID();
  private readonly controller = new AbortController();
  private readonly changes = new TeamChanges();
  private readonly slots: TeamSlots;
  private readonly instances = new Map<string, TeamMember>();
  private readonly leader: TeamMember;
  private closed = false;
  private started = false;
  private turns = 0;
  private fatal: unknown;
  private removeAbortListener: (() => void) | undefined;

  constructor(
    leader: AgentTeamMember,
    private readonly policy: TeamPolicy,
    private readonly limits: Required<AgentTeamLimits>,
    private readonly options: AgentTeamRunOptions<unknown>,
    private readonly streaming: boolean,
    private readonly emit: (event: AgentTeamEvent<Output>) => void,
  ) {
    this.slots = new TeamSlots(limits.maxConcurrentAgents);
    this.leader = this.createMember(leader, leader.name ?? leader.id);
    const messages =
      options.messages === undefined
        ? steeringMessages({ prompt: options.prompt! })
        : parseMessages(options.messages);
    const last = messages.at(-1);
    if (last?.role !== "user")
      throw new TypeError("Agent team input must end with a user message.");
    this.leader.history = messages.slice(0, -1);
    this.leader.inputs.push({
      id: globalThis.crypto.randomUUID(),
      messages: [last],
      submitted: false,
    });
    if (options.abortSignal !== undefined) {
      const signal = options.abortSignal;
      const abort = () => this.cancel("Agent team aborted.");
      if (signal.aborted) abort();
      else {
        signal.addEventListener("abort", abort, { once: true });
        this.removeAbortListener = () => signal.removeEventListener("abort", abort);
      }
    }
  }

  async execute(): Promise<AgentTeamOutcome<Output>> {
    if (this.started) throw new Error("Agent team execution has already started.");
    this.started = true;
    try {
      this.assertOpen();
      this.launch(this.leader);
      while (true) {
        this.assertOpen();
        const version = this.changes.version;
        if (this.leader.status === "failed" && this.leader.outcome?.type !== "blocked")
          throw this.leader.error;
        const outcome = this.leader.outcome;
        if (
          outcome !== undefined &&
          (outcome.type === "blocked" ||
            (this.leader.status === "idle" &&
              this.leader.task === undefined &&
              this.leader.inputs.length === 0 &&
              !this.childrenBusy()))
        ) {
          this.closed = true;
          this.stopMembers();
          await this.settleMembers();
          const result = {
            ...outcome,
            teamRunId: this.id,
            usage: [...this.instances.values()].reduce(
              (usage, member) => Usage.add(usage, member.usage),
              Usage.empty(),
            ),
            members: [...this.instances.values()]
              .filter((member) => member !== this.leader)
              .map(memberSummary),
          } as AgentTeamOutcome<Output>;
          this.emit(result);
          return result;
        }
        await this.changes.wait(version, this.controller.signal);
      }
    } catch (error) {
      this.closed = true;
      this.stopMembers();
      await this.settleMembers();
      throw this.fatal ?? error;
    } finally {
      this.removeAbortListener?.();
    }
  }

  steer(input: AgentSteerInput): AgentSteerReceipt {
    this.assertOpen();
    const entry: TeamInput = {
      id: globalThis.crypto.randomUUID(),
      messages: steeringMessages(input),
      submitted: false,
    };
    this.enqueue(this.leader, entry);
    return { id: entry.id, status: "queued" };
  }

  cancel(reason = "Agent team cancelled."): void {
    if (this.closed || this.controller.signal.aborted) return;
    this.fail(new AgentRunCancelledError([], reason));
  }

  spawn(parent: TeamMember, definition: AgentTeamMember, prompt: string, name?: string) {
    this.assertOpen();
    throwIfAborted(parent.controller.signal);
    if (!this.policy.spawnTargets(parent).includes(definition))
      throw new Error(`Agent "${parent.definition.id}" cannot spawn "${definition.id}".`);
    if (parent.depth >= this.limits.maxDepth) throw new AgentTeamLimitError("maxDepth");
    if (this.instances.size >= this.limits.maxAgentInstances)
      throw new AgentTeamLimitError("maxAgentInstances");
    const member = this.createMember(definition, name ?? definition.name ?? definition.id, parent);
    member.inputs.push({
      id: globalThis.crypto.randomUUID(),
      messages: [{ role: "user", content: prompt }],
      submitted: false,
    });
    this.memberEvent(member, "agent_queued");
    this.launch(member);
    return { instanceId: member.instanceId, status: "queued" as const };
  }

  send(sender: TeamMember, input: { to: string; content: string; replyTo?: string | undefined }) {
    this.assertOpen();
    throwIfAborted(sender.controller.signal);
    const recipient = this.recipient(sender, input.to);
    if (recipient.status === "failed" || recipient.status === "cancelled") {
      throw new Error(`Agent instance "${recipient.instanceId}" is ${recipient.status}.`);
    }
    return this.queueMessage(sender, recipient, input);
  }

  private queueMessage(
    sender: TeamMember,
    recipient: TeamMember,
    input: { content: string; replyTo?: string | undefined },
    notificationType: "message" | "outcome" = "message",
  ) {
    const message: AgentTeamMessage = {
      id: globalThis.crypto.randomUUID(),
      teamRunId: this.id,
      fromInstanceId: sender.instanceId,
      toInstanceId: recipient.instanceId,
      content: input.content,
      createdAt: new Date().toISOString(),
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    };
    this.enqueue(recipient, agentMessageInput(message), notificationType);
    return { messageId: message.id, status: "queued" as const };
  }

  visibleMembers(caller: TeamMember) {
    return [...this.instances.values()]
      .filter((member) => this.policy.canAccess(caller, member))
      .map((member) => ({
        instanceId: member.instanceId,
        agentId: member.agent.id,
        name: member.name,
        status: member.status,
        depth: member.depth,
        ...(member.parentInstanceId === undefined
          ? {}
          : { parentInstanceId: member.parentInstanceId }),
      }));
  }

  cancelMember(caller: TeamMember, instanceId: string, reason = "Cancelled by parent.") {
    this.assertOpen();
    throwIfAborted(caller.controller.signal);
    const member = this.recipient(caller, instanceId);
    if (member.parentInstanceId !== caller.instanceId)
      throw new Error("Only a parent can cancel its child.");
    if (member.status === "cancelled") return { instanceId, status: "cancelled" as const };
    this.stopMember(member, reason);
    this.stopDescendants(member, reason);
    if (member.task === undefined) this.reportOutcome(member);
    return { instanceId, status: "cancelled" as const };
  }

  async wait(member: TeamMember, instanceId: string | undefined, timeoutMs: number) {
    this.assertOpen();
    const target = instanceId === undefined ? undefined : this.recipient(member, instanceId);
    const deadline = Date.now() + timeoutMs;
    return this.yieldSlot(member, "waiting", async () => {
      while (true) {
        const version = this.changes.version;
        const index = member.notifications.findIndex(
          (notification) => target === undefined || notification.from === target.instanceId,
        );
        if (index !== -1) {
          const notification = member.notifications.splice(index, 1)[0]!;
          return {
            reason: notification.type,
            instanceId: notification.from,
            messageId: notification.id,
          };
        }
        if (target !== undefined && ["idle", "failed", "cancelled"].includes(target.status)) {
          return { reason: "outcome", instanceId: target.instanceId, status: target.status };
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { reason: "timeout" };
        await this.changes.wait(version, member.controller.signal, remaining);
      }
    });
  }

  private createMember(agent: AgentTeamMember, name: string, parent?: TeamMember): TeamMember {
    const parentInstanceId = parent?.instanceId;
    const member: TeamMember = {
      instanceId: globalThis.crypto.randomUUID(),
      agent,
      definition: agent,
      depth: parent === undefined ? 0 : parent.depth + 1,
      name,
      ...(parentInstanceId === undefined ? {} : { parentInstanceId }),
      status: "queued",
      history: [],
      inputs: [],
      receipts: new Map(),
      controller: new AbortController(),
      usage: Usage.empty(),
      notifications: [],
    };
    const resolved = getResolvedAgentOptions(member.agent);
    member.agent = createResolvedAgent({
      ...resolved,
      instructions: [
        resolved.instructions,
        TEAM_INSTRUCTIONS,
        `Your instance ID is ${member.instanceId}. ${parentInstanceId === undefined ? "You are the coordinator. Spawn tools create independent members; their outcomes are delivered automatically." : `Your parent instance is ${parentInstanceId}.`}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      tools: [
        ...(resolved.tools ?? []),
        ...teamTools(this, member, this.policy.spawnTargets(member)),
      ],
    });
    this.instances.set(member.instanceId, member);
    return member;
  }

  private recipient(sender: TeamMember, to: string): TeamMember {
    const id = to === "parent" ? sender.parentInstanceId : to;
    const recipient = id === undefined ? undefined : this.instances.get(id);
    if (
      recipient === undefined ||
      recipient === sender ||
      !this.policy.canAccess(sender, recipient)
    ) {
      throw new Error(
        `Agent instance "${to}" is not an accessible parent or child, or enabled sibling.`,
      );
    }
    return recipient;
  }

  private enqueue(
    member: TeamMember,
    input: TeamInput,
    notificationType: "message" | "outcome" = "message",
  ): void {
    if (member.inputs.length >= 128)
      throw new AgentTeamLimitError("pending messages per instance (128)");
    member.inputs.push(input);
    if (input.message !== undefined) {
      this.emit({ type: "message_queued", ...this.identity(member), message: input.message });
      member.notifications.push({
        type: notificationType,
        from: input.message.fromInstanceId,
        id: input.id,
      });
    }
    this.submitInputs(member);
    if (this.started && member.task === undefined) this.launch(member);
    this.changes.notify();
  }

  private submitInputs(member: TeamMember): void {
    if (member.activeRun === undefined) return;
    for (const input of member.inputs) {
      if (input.submitted) continue;
      try {
        const receipt = member.activeRun.steer({ messages: input.messages });
        member.receipts.set(receipt.id, input);
        input.submitted = true;
      } catch (error) {
        // Closing runs reject steering; leave this input pending for the next assignment.
        if (error instanceof AgentStreamClosedError) return;
        throw error;
      }
    }
  }

  private delivered(member: TeamMember, input: TeamInput): void {
    const index = member.inputs.indexOf(input);
    if (index !== -1) member.inputs.splice(index, 1);
    member.notifications = member.notifications.filter(
      (notification) => notification.id !== input.id,
    );
    if (input.message !== undefined)
      this.emit({ type: "message_delivered", ...this.identity(member), message: input.message });
  }

  private launch(member: TeamMember): void {
    if (member.task !== undefined || this.closed || member.controller.signal.aborted) return;
    member.status = "queued";
    member.task = Promise.resolve()
      .then(() => this.runMember(member))
      .catch((error: unknown) => {
        member.error = error;
        member.inputs.length = 0;
        if (member.controller.signal.aborted) member.status = "cancelled";
        else {
          member.status = "failed";
          this.memberEvent(member, "agent_failed");
        }
        this.stopDescendants(member, "Parent failed or was cancelled.");
        if (!this.closed && !this.controller.signal.aborted && member !== this.leader) {
          try {
            this.reportOutcome(member);
          } catch (reportError) {
            this.fail(reportError);
          }
        }
      })
      .finally(() => {
        member.release?.();
        member.release = undefined;
        member.activeRun = undefined;
        member.task = undefined;
        if (member.status === "idle" && member.inputs.length > 0) this.launch(member);
        this.changes.notify();
      });
    this.changes.notify();
  }

  private async runMember(member: TeamMember): Promise<void> {
    const signal = member.controller.signal;
    member.release = await this.slots.acquire(signal);
    let nextInput: AgentInput | undefined;
    let firstInputs: TeamInput[] = [];
    while (true) {
      throwIfAborted(signal);
      member.status = "running";
      member.runId = globalThis.crypto.randomUUID();
      if (nextInput === undefined) {
        firstInputs = member.inputs.filter((input) => !input.submitted);
        const incoming = firstInputs.flatMap((input) => input.messages);
        if (incoming.length === 0) throw new Error("Agent team member has no input.");
        nextInput = { messages: [...member.history, ...incoming] };
        member.history.push(...incoming.slice(0, -1));
        for (const input of firstInputs) input.submitted = true;
      }
      const streaming =
        this.streaming &&
        member.agent.model.capabilities.streaming &&
        isStreamingCompletionModel(member.agent.model);
      const baseSettings =
        member === this.leader
          ? {
              maxTurns: this.options.maxTurns,
              retries: this.options.retries,
              lifecycle: this.options.lifecycle,
              guardrails: this.options.guardrails,
              middlewares: this.options.middlewares,
              trace: this.options.trace,
              controls: this.options.controls,
            }
          : {};
      const run = AgentRun.fromAgent(
        member.agent,
        withInternalAgentRunOptions(
          {
            ...baseSettings,
            ...nextInput,
            abortSignal: signal,
            // Collaboration tools mutate one inbox/permit at a time; provider tools may still run independently across agents.
            toolConcurrency: 1,
            lifecycle: composeAgentLifecycle(baseSettings.lifecycle, {
              onStepFinish: (event) => {
                if (!streaming)
                  this.agentEvent(member, {
                    type: "turn_end",
                    turn: event.step,
                    response: lifecycleSnapshot(event.response) as CompletionResponse,
                  });
              },
              onError: (event) => {
                member.usage = Usage.add(member.usage, event.usage);
              },
            }),
          },
          {
            runId: member.runId,
            hook: {
              onCompletionCall: () => {
                this.assertOpen();
                if (this.turns >= this.limits.maxTotalTurns) {
                  const error = new AgentTeamLimitError("maxTotalTurns");
                  this.fail(error);
                  throw error;
                }
                this.turns += 1;
                for (const input of firstInputs) this.delivered(member, input);
                firstInputs = [];
              },
            },
            beforeFinish: () => this.waitForChildren(member),
            onSteeringApplied: (id) => {
              const input = member.receipts.get(id);
              if (input !== undefined) {
                member.receipts.delete(id);
                this.delivered(member, input);
              }
            },
          },
        ),
      );
      member.activeRun = run;
      this.submitInputs(member);
      this.memberEvent(member, "agent_started");
      // Caller-owned models/tools may ignore abort. Close the team promptly, and discard late events.
      const outcome = await abortable(this.consumeRun(member, run, streaming), signal);
      member.activeRun = undefined;
      member.usage = Usage.add(member.usage, outcome.usage);
      member.history.push(...outcome.messages);
      if (outcome.type === "interaction") {
        const resolver = this.options.resolveInteraction;
        this.emit({
          type: "interaction",
          ...this.identity(member),
          interaction: lifecycleSnapshot(outcome.interaction),
        });
        if (resolver === undefined) {
          const error = new AgentTeamInteractionError(member.instanceId);
          this.fail(error);
          throw error;
        }
        try {
          const response = await this.yieldSlot(member, "awaiting_interaction", () =>
            abortable(
              Promise.resolve().then(() =>
                resolver({
                  teamRunId: this.id,
                  instanceId: member.instanceId,
                  runId: outcome.runId,
                  interaction: lifecycleSnapshot(outcome.interaction),
                  abortSignal: signal,
                }),
              ),
              signal,
            ),
          );
          const parsed = parseAgentInteractionResponse(response);
          assertAgentInteractionResponse(outcome.interaction, parsed);
          nextInput = { continuation: outcome.continuation, response: parsed };
        } catch (cause) {
          if (signal.aborted) throw cause;
          const error = new AgentTeamInteractionError(member.instanceId, { cause });
          this.fail(error);
          throw error;
        }
        continue;
      }
      member.outcome = outcome;
      member.status = outcome.type === "blocked" ? "failed" : "idle";
      if (outcome.type === "blocked") {
        member.inputs.length = 0;
        this.stopDescendants(member, "Parent was blocked.");
      }
      this.memberEvent(member, outcome.type === "blocked" ? "agent_failed" : "agent_idle");
      if (member !== this.leader) this.reportOutcome(member);
      return;
    }
  }

  private async consumeRun(
    member: TeamMember,
    run: AgentRun<unknown>,
    streaming: boolean,
  ): Promise<AgentOutcome<unknown>> {
    if (!streaming) {
      const outcome = await run.generate();
      if (outcome.type === "response")
        this.agentEvent(member, { type: "text_delta", turn: 0, delta: outcome.text });
      this.agentEvent(member, outcome);
      return outcome;
    }
    for await (const event of run.events()) {
      this.agentEvent(member, event);
      if (event.type === "error") throw event.error;
      if (event.type === "response" || event.type === "blocked" || event.type === "interaction")
        return event;
    }
    throw new Error("Agent team member stream ended without an outcome.");
  }

  private reportOutcome(member: TeamMember): void {
    const parent = this.instances.get(member.parentInstanceId!);
    if (parent === undefined || parent.status === "failed" || parent.status === "cancelled") return;
    const content = JSON.stringify({
      type: "agent-outcome",
      instanceId: member.instanceId,
      status: member.status,
      ...(member.outcome?.type === "response" ? { output: member.outcome.output } : {}),
      ...(member.outcome?.type === "blocked" ? { reason: member.outcome.reason } : {}),
      ...(member.error === undefined
        ? {}
        : { error: member.error instanceof Error ? member.error.message : String(member.error) }),
    });
    this.queueMessage(member, parent, { content }, "outcome");
  }

  private async waitForChildren(member: TeamMember): Promise<void> {
    if (!this.childrenBusy(member) || member.inputs.length > 0) return;
    await this.yieldSlot(member, "waiting", async () => {
      while (this.childrenBusy(member) && member.inputs.length === 0) {
        const version = this.changes.version;
        await this.changes.wait(version, member.controller.signal);
      }
    });
  }

  // Without a parent, final team settlement checks all descendants, including revived assignments.
  private childrenBusy(parent?: TeamMember): boolean {
    return [...this.instances.values()].some(
      (member) =>
        member !== this.leader &&
        (parent === undefined || member.parentInstanceId === parent.instanceId) &&
        (["queued", "running", "waiting", "awaiting_interaction"].includes(member.status) ||
          member.inputs.length > 0),
    );
  }

  private async yieldSlot<T>(
    member: TeamMember,
    status: "waiting" | "awaiting_interaction",
    work: () => Promise<T>,
  ): Promise<T> {
    member.release?.();
    member.release = undefined;
    member.status = status;
    this.memberEvent(member, "agent_waiting");
    this.changes.notify();
    try {
      return await work();
    } finally {
      if (!member.controller.signal.aborted && !this.closed) {
        member.release = await this.slots.acquire(member.controller.signal);
        member.status = "running";
        this.changes.notify();
      }
    }
  }

  private identity(member: TeamMember) {
    return {
      teamRunId: this.id,
      instanceId: member.instanceId,
      ...(member.runId === undefined ? {} : { runId: member.runId }),
    };
  }

  private memberEvent(
    member: TeamMember,
    type:
      | "agent_queued"
      | "agent_started"
      | "agent_waiting"
      | "agent_idle"
      | "agent_failed"
      | "agent_cancelled",
  ) {
    this.emit({ type, ...this.identity(member), member: memberSummary(member) });
  }

  private agentEvent(member: TeamMember, event: AgentStreamEvent<unknown>) {
    if (this.closed || member.controller.signal.aborted) return;
    this.emit({
      type: "agent_event",
      ...this.identity(member),
      coordinator: member === this.leader,
      event: lifecycleSnapshot(event),
    });
  }

  private assertOpen(): void {
    if (this.fatal !== undefined) throw this.fatal;
    if (this.closed) throw new AgentStreamClosedError();
    throwIfAborted(this.controller.signal);
  }

  private fail(error: unknown): void {
    this.fatal ??= error;
    this.controller.abort(error);
    this.stopMembers();
    this.changes.notify();
  }

  private stopMember(member: TeamMember, reason: string): void {
    if (member.status === "cancelled") return;
    member.status = "cancelled";
    member.inputs.length = 0;
    member.controller.abort(reason);
    member.activeRun?.cancel(reason);
    this.memberEvent(member, "agent_cancelled");
    this.changes.notify();
  }

  private stopMembers(): void {
    for (const member of this.instances.values()) {
      if (["queued", "running", "waiting", "awaiting_interaction"].includes(member.status))
        this.stopMember(member, "Agent team closed.");
    }
  }

  private stopDescendants(parent: TeamMember, reason: string): void {
    // Instances are inserted after their parents; this also reaches idle descendants without recursion.
    // The subtree root is already terminal, and each descendant's parent is stopped first.
    // Only the subtree root reports cancellation to a surviving parent; descendant reports are suppressed.
    const stopped = new Set([parent.instanceId]);
    for (const member of this.instances.values()) {
      if (member.parentInstanceId !== undefined && stopped.has(member.parentInstanceId)) {
        stopped.add(member.instanceId);
        this.stopMember(member, reason);
      }
    }
  }

  private async settleMembers(): Promise<void> {
    await Promise.allSettled(
      [...this.instances.values()].flatMap((member) =>
        member.task === undefined ? [] : [member.task],
      ),
    );
  }
}
