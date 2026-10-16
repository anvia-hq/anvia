import type { AgentStream, AgentStreamEvent, AgentOutcome } from "@anvia/core/agent";
import type { AgentInteractionRequest } from "@anvia/core/agent/interactions";
import { hasEnforcedOutputGuardrails } from "@anvia/core/guardrails";
import type { ToolResultOutput } from "@anvia/core/completion";
import type { AcpSessionBinding, AcpToolPresentation } from "./types.js";
import type { PermissionTool } from "./permissions.js";
import { presentTool, type PresentedTool } from "./presentation.js";

/** Adapter-owned updates; SDK types and v1 discriminators stay at the wire boundary. */
export type SessionUpdate =
  | { type: "text" | "thought"; text: string }
  | ({ type: "tool"; id: string } & PresentedTool)
  | ({
      type: "tool-update";
      id: string;
      status: "pending" | "completed" | "failed";
    } & Partial<AcpToolPresentation>);

export type UpdateSink = (update: SessionUpdate) => Promise<void>;

type ToolState = PermissionTool & { callId: string; completed: boolean };

/** One mapper per prompt. Allocation is session-owned, correlation is generation-local. */
export class TurnEvents {
  private readonly outputGuarded: boolean;
  private readonly textTurns = new Set<number>();
  private readonly calls = new Map<string, ToolState>();
  private readonly executions = new Map<string, ToolState>();

  private resuming = false;
  private readonly unfinished = new Map<string, ToolState>();

  constructor(
    private readonly allocateId: () => string,
    private readonly cwd: string,
    private readonly binding: AcpSessionBinding,
    private readonly reasoning: boolean,
    private readonly send: UpdateSink,
    private readonly signal?: AbortSignal,
  ) {
    this.outputGuarded = hasEnforcedOutputGuardrails([...binding.agent.guardrails]);
  }

  /** Core restarts turn numbers on resume; carry only uncompleted calls forward. */
  beginSegment(): void {
    for (const state of this.calls.values()) {
      if (!state.completed) this.unfinished.set(state.callId, state);
    }
    this.calls.clear();
    this.textTurns.clear();
    this.resuming = true;
  }

  async interaction(request: AgentInteractionRequest): Promise<PermissionTool> {
    const state =
      [...this.calls.values()]
        .reverse()
        .find((candidate) => candidate.callId === request.toolCallId && !candidate.completed) ??
      this.unfinished.get(request.toolCallId);
    if (!state) throw new Error("Missing interaction tool call.");
    this.executions.set(request.internalCallId, state);
    const { id, title, kind, locations, diffs } = state;
    const tool: PermissionTool = { id, title, kind, locations };
    if (diffs) return { ...tool, diffs };
    return tool;
  }

  async consume(stream: AgentStream): Promise<AgentOutcome> {
    // Reading result first can auto-drain AgentStream. Never use text/textStream here.
    for await (const event of stream.events) {
      // Drain core to completion without projecting late results or calling host
      // presentation callbacks after cancellation.
      if (!this.signal?.aborted) await this.accept(event);
    }
    return stream.result;
  }

  async accept(event: AgentStreamEvent): Promise<void> {
    if (this.signal?.aborted) return;
    switch (event.type) {
      case "turn_start":
        this.resuming = false;
        break;
      case "text_delta":
        if (event.delta) {
          this.textTurns.add(event.turn);
          await this.send({ type: "text", text: event.delta });
        }
        break;
      case "turn_end":
        // Final-only models may supply no text deltas. With output guardrails, core
        // emits safe replacement deltas itself: intermediate turn_end text can be
        // unguarded, so never use this fallback for those agents.
        if (!this.outputGuarded && !this.textTurns.has(event.turn)) {
          for (const part of event.response.choice) {
            if (part.type === "text") {
              await this.accept({ type: "text_delta", turn: event.turn, delta: part.text });
            }
          }
        }
        break;
      case "reasoning_delta":
        if (
          this.reasoning &&
          event.delta &&
          (event.contentType === undefined ||
            event.contentType === "text" ||
            event.contentType === "summary")
        ) {
          await this.send({ type: "thought", text: event.delta });
        }
        break;
      case "tool_call_delta":
        await this.call(event.turn, event.id, event.name);
        break;
      case "tool_call": {
        const call = event.toolCall;
        const state = await this.call(event.turn, call.toolCallId, call.toolName);
        if (this.signal?.aborted) return;
        const presentation = presentTool(
          call.toolName,
          this.cwd,
          this.binding.toolPresentation?.(call),
        );
        Object.assign(state, presentation);
        await this.send({ type: "tool-update", id: state.id, status: "pending", ...presentation });
        break;
      }
      case "tool_result": {
        const state =
          this.executions.get(event.internalCallId) ??
          (await this.call(event.turn, event.toolCallId, event.toolName));
        this.executions.set(event.internalCallId, state);
        if (state.completed) break;
        state.completed = true;
        await this.send({ type: "tool-update", id: state.id, status: resultStatus(event.output) });
        break;
      }
      // Final outcomes settle only through stream.result. Do not replay their text,
      // requests, nested agent events, raw errors, provider artifacts or signatures.
      default:
        break;
    }
  }

  /** Completion-only models have no stream; project this run's public messages once. */
  async completed(outcome: AgentOutcome): Promise<void> {
    if (outcome.type === "blocked") return;
    let turn = 0;
    for (const message of outcome.messages) {
      if (message.role === "assistant") {
        this.resuming = false;
        turn++;
        if (typeof message.content === "string") {
          if (!this.outputGuarded) {
            await this.accept({ type: "text_delta", turn, delta: message.content });
          }
          continue;
        }
        for (const part of message.content) {
          if (part.type === "text" && !this.outputGuarded) {
            await this.accept({ type: "text_delta", turn, delta: part.text });
          } else if (part.type === "tool-call") {
            await this.accept({ type: "tool_call", turn, toolCall: part });
          }
        }
      } else if (message.role === "tool") {
        for (const part of message.content) {
          if (part.type !== "tool-result") continue;
          const state = await this.call(turn, part.toolCallId, part.toolName);
          if (state.completed) continue;
          state.completed = true;
          await this.send({ type: "tool-update", id: state.id, status: resultStatus(part.output) });
        }
      }
    }
    if (this.outputGuarded && outcome.type === "response" && outcome.text) {
      await this.send({ type: "text", text: outcome.text });
    }
  }

  private async call(turn: number, callId: string, name?: string): Promise<ToolState> {
    // JSON encoding avoids delimiter collisions. Provider callId is not an identity:
    // providers may reuse it, even for distinct toolCallIds in the same generation.
    const pending = this.resuming ? this.unfinished.get(callId) : undefined;
    if (pending) return pending;
    const key = JSON.stringify([turn, callId]);
    let state = this.calls.get(key);
    if (!state) {
      state = { id: this.allocateId(), callId, completed: false, ...presentTool(name, this.cwd) };
      this.calls.set(key, state);
      await this.send({ type: "tool", id: state.id, ...presentTool(name, this.cwd) });
    }
    return state;
  }
}

function resultStatus(output: ToolResultOutput): "completed" | "failed" {
  switch (output.type) {
    case "execution-denied":
    case "error-text":
    case "error-json":
      return "failed";
    default:
      return "completed";
  }
}
