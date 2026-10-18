import type { AgentInteractionOutcome, AgentOutcome } from "@anvia/core/agent";
import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import type { Message, UserMessage } from "@anvia/core/completion";
import type { PromptBlock } from "./content.js";

/** Private write-ahead submission, saved before the runtime can execute any effects. */
export type AcpPendingRun = Readonly<{
  requestId: string;
  prompt: UserMessage;
  blocks: readonly PromptBlock[];
}>;

/** Execution boundary implemented by the optional durable subpath. No durable runtime import. */
export interface AcpDurableDriver {
  readonly key: string;
  execute(options: {
    sessionId: string;
    pending: AcpPendingRun;
    historyLength: number;
    signal: AbortSignal;
    project: (outcome: AgentOutcome<unknown>) => Promise<void>;
    interact: (outcome: AgentInteractionOutcome) => Promise<AgentInteractionResponse | "cancel">;
  }): Promise<
    { outcome: AgentOutcome<unknown>; messages: Message[] } | "cancelled" | "max_turn_requests"
  >;
  cancel(sessionId: string, requestId: string): Promise<"completed" | "cancelled">;
}
