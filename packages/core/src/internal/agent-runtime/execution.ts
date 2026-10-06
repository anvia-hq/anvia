import type { CompletionRequest, CompletionResponse, ToolCallPart } from "../../completion";
import type { NormalizedToolOutput, ToolCallContext } from "../../tool";

/** Runtime capability marker: older core versions must fail before accepting durable work. */
export const AGENT_RUN_EXECUTION_VERSION = 1;

export type AgentToolExecutionResult =
  | { output: NormalizedToolOutput; failed: false }
  | { output: NormalizedToolOutput; failed: true; error: unknown };

/** Internal persistence boundary used by execution runtimes. Callbacks own external effects. */
export interface AgentRunExecution {
  completion(
    turn: number,
    request: CompletionRequest,
    execute: () => Promise<CompletionResponse>,
  ): Promise<CompletionResponse>;
  tool(
    call: { turn: number; toolCall: ToolCallPart; args: string },
    execute: (context?: Pick<ToolCallContext, "operationId">) => Promise<AgentToolExecutionResult>,
  ): Promise<AgentToolExecutionResult>;
}
