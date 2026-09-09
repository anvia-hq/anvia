import type { Agent } from "../agent";
import type { AgentInteractionRequest, AgentInteractionResponse } from "../interactions";
import type {
  AgentBlockedOutcome,
  AgentPrompt,
  AgentResponse,
  AgentRunSettings,
  AgentSteerInput,
  AgentSteerReceipt,
  AgentStreamEvent,
} from "../run-types";
import type { AgentOptions } from "../types";
import type { CompletionModel, CompletionModelControlsOf, Message, Usage } from "../../completion";

/** An Agent definition; individual members may have different output schemas. */
export type AgentTeamMember = Agent<unknown>;

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse> ? RawResponse : unknown;

export type AgentTeamLimits = {
  maxConcurrentAgents?: number;
  maxAgentInstances?: number;
  maxTotalTurns?: number;
  /** Maximum unread stream events. Overflow fails and cancels the team. Defaults to 1024. */
  maxBufferedEvents?: number;
};

export type AgentTeamOptions<
  Output = string,
  M extends CompletionModel = CompletionModel,
  ContextDocument = unknown,
> = AgentOptions<Output, M, ContextDocument> & {
  members: readonly AgentTeamMember[];
  limits?: AgentTeamLimits;
};

export type AgentTeamInteraction = {
  teamRunId: string;
  instanceId: string;
  runId: string;
  interaction: AgentInteractionRequest;
  abortSignal: AbortSignal;
};

export type AgentTeamRunOptions<
  Output = string,
  M extends CompletionModel = CompletionModel,
> = Omit<
  AgentRunSettings<Output, RawResponseOf<M>, CompletionModelControlsOf<M>>,
  "toolConcurrency"
> &
  ({ prompt: AgentPrompt; messages?: never } | { messages: readonly Message[]; prompt?: never }) & {
    resolveInteraction?: (
      request: AgentTeamInteraction,
    ) => AgentInteractionResponse | Promise<AgentInteractionResponse>;
  };

export type AgentTeamMemberStatus =
  | "queued"
  | "running"
  | "waiting"
  | "awaiting_interaction"
  | "idle"
  | "failed"
  | "cancelled";

export type AgentTeamMemberSummary = Readonly<{
  instanceId: string;
  agentId: string;
  name: string;
  parentInstanceId?: string;
  status: AgentTeamMemberStatus;
  usage: Usage;
  outcome?: AgentResponse<unknown> | AgentBlockedOutcome;
  error?: unknown;
}>;

export type AgentTeamOutcome<Output = string> = (AgentResponse<Output> | AgentBlockedOutcome) & {
  teamRunId: string;
  /** Aggregate usage across every member run, including the coordinator. */
  usage: Usage;
  members: readonly AgentTeamMemberSummary[];
};

export type AgentTeamMessage = Readonly<{
  id: string;
  teamRunId: string;
  fromInstanceId: string;
  toInstanceId: string;
  content: string;
  replyTo?: string;
  createdAt: string;
}>;

type TeamEventIdentity = { teamRunId: string; instanceId: string; runId?: string };

export type AgentTeamEvent<Output = string> =
  | (TeamEventIdentity & {
      type: "agent_started" | "agent_waiting" | "agent_idle" | "agent_failed" | "agent_cancelled";
      member: AgentTeamMemberSummary;
    })
  | (TeamEventIdentity & {
      type: "message_queued" | "message_delivered";
      message: AgentTeamMessage;
    })
  | (TeamEventIdentity & { type: "interaction"; interaction: AgentInteractionRequest })
  | (TeamEventIdentity & {
      type: "agent_event";
      coordinator: boolean;
      event: AgentStreamEvent<unknown>;
    })
  | AgentTeamOutcome<Output>;

export interface AgentTeamStream<Output = string> extends AsyncIterable<AgentTeamEvent<Output>> {
  readonly events: AsyncIterable<AgentTeamEvent<Output>>;
  readonly textStream: AsyncIterable<string>;
  readonly text: Promise<string>;
  readonly result: Promise<AgentTeamOutcome<Output>>;
  steer(input: AgentSteerInput): AgentSteerReceipt;
  cancel(reason?: string): void;
}
