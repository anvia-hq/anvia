import type { PreparedLoopContext, LoopContextCheckpoint } from "./loop-context";
import type {
  CompletionRequest,
  CompletionResponse,
  ToolCallPart,
  Message,
  UserMessage,
} from "../../completion";
import type { NormalizedToolOutput, ToolCallContext } from "../../tool";
import type { AgentStreamEvent } from "../../agent/run-types";

/** Runtime capability marker: older core versions must fail before accepting durable work. */
export const AGENT_RUN_EXECUTION_VERSION = 4;

/** Normalized generation progress; never includes raw provider responses. */
export type AgentCompletionStreamEvent = Extract<
  AgentStreamEvent<unknown, unknown>,
  {
    type:
      | "text_delta"
      | "reasoning_delta"
      | "tool_call_delta"
      | "tool_call"
      | "source"
      | "provider_tool_call";
  }
>;

export type AgentCompletionStream = AsyncGenerator<AgentCompletionStreamEvent, CompletionResponse>;

export type AgentToolExecutionResult =
  | { output: NormalizedToolOutput; failed: false }
  | { output: NormalizedToolOutput; failed: true; error: unknown };

/** Internal persistence boundary used by execution runtimes. Callbacks own external effects. */
export interface AgentRunExecution {
  /** Synchronously checkpoint queued input at a safe boundary, including empty/closing drains. */
  drainSteering?(turn: number, closing: boolean): { id: string; messages: UserMessage[] }[];
  /** Persist the context selected before each model call, including skipped compaction decisions. */
  prepareMessages?(
    turn: number,
    messages: readonly Message[],
    checkpoint?: LoopContextCheckpoint,
  ): Promise<PreparedLoopContext>;
  completion(
    turn: number,
    request: CompletionRequest,
    execute: () => Promise<CompletionResponse>,
  ): Promise<CompletionResponse>;
  streamCompletion?(
    turn: number,
    request: CompletionRequest,
    execute: () => AgentCompletionStream,
  ): AgentCompletionStream;
  tool(
    call: { turn: number; toolCall: ToolCallPart; args: string },
    execute: (context?: Pick<ToolCallContext, "operationId">) => Promise<AgentToolExecutionResult>,
  ): Promise<AgentToolExecutionResult>;
}
