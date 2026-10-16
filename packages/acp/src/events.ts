import type { AgentStream, AgentStreamEvent, AgentOutcome } from "@anvia/core/agent";
import { hasEnforcedOutputGuardrails } from "@anvia/core/guardrails";
import type { ToolResultOutput } from "@anvia/core/completion";
import type { AcpSessionBinding, AcpToolPresentation } from "./types.js";
import { presentTool } from "./presentation.js";

/** Adapter-owned updates; SDK types and v1 discriminators stay at the wire boundary. */
export type SessionUpdate =
  | { type: "text" | "thought"; text: string }
  | ({ type: "tool"; id: string } & Required<AcpToolPresentation>)
  | ({
      type: "tool-update";
      id: string;
      status: "pending" | "completed" | "failed";
    } & Partial<AcpToolPresentation>);

export type UpdateSink = (update: SessionUpdate) => Promise<void>;

type ToolState = { id: string; completed: boolean };

/** One mapper per prompt. Allocation is session-owned, correlation is generation-local. */
export class TurnEvents {
  private readonly outputGuarded: boolean;
  private readonly textTurns = new Set<number>();
  private readonly calls = new Map<string, ToolState>();
  private readonly executions = new Map<string, ToolState>();

  constructor(
    private readonly allocateId: () => string,
    private readonly cwd: string,
    private readonly binding: AcpSessionBinding,
    private readonly reasoning: boolean,
    private readonly send: UpdateSink,
  ) {
    this.outputGuarded = hasEnforcedOutputGuardrails([...binding.agent.guardrails]);
  }

  async consume(stream: AgentStream): Promise<AgentOutcome> {
    // Reading result first can auto-drain AgentStream. Never use text/textStream here.
    for await (const event of stream.events) await this.accept(event);
    return stream.result;
  }

  async accept(event: AgentStreamEvent): Promise<void> {
    switch (event.type) {
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
        const presentation = presentTool(
          call.toolName,
          this.cwd,
          this.binding.toolPresentation?.(call),
        );
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
    if (outcome.type !== "response") return;
    let turn = 0;
    for (const message of outcome.messages) {
      if (message.role === "assistant") {
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
    if (this.outputGuarded && outcome.text) {
      await this.send({ type: "text", text: outcome.text });
    }
  }

  private async call(turn: number, callId: string, name?: string): Promise<ToolState> {
    // JSON encoding avoids delimiter collisions. Provider callId is not an identity:
    // providers may reuse it, even for distinct toolCallIds in the same generation.
    const key = JSON.stringify([turn, callId]);
    let state = this.calls.get(key);
    if (!state) {
      state = { id: this.allocateId(), completed: false };
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
