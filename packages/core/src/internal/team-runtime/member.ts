import type {
  AgentTeamMemberStatus,
  AgentTeamMemberSummary,
  AgentTeamMessage,
} from "../../agent/team/types";
import type { AgentOutcome, AgentSteerInput } from "../../agent/run-types";
import type { Message, UserMessage } from "../../completion";
import { parseMessage, parseMessages, Usage } from "../../completion";
import { omitUndefined } from "../record";
import type { AgentRun } from "../agent-runtime/agent-run";
import type { Agent } from "../../agent/agent";
import { lifecycleSnapshot } from "../../agent/lifecycle";

export type TeamInput = {
  id: string;
  messages: UserMessage[];
  message?: AgentTeamMessage;
  submitted: boolean;
};

export type TeamMember = {
  instanceId: string;
  parentInstanceId?: string;
  depth: number;
  definition: Agent<unknown>;
  name: string;
  agent: Agent<unknown>;
  status: AgentTeamMemberStatus;
  history: Message[];
  inputs: TeamInput[];
  receipts: Map<string, TeamInput>;
  controller: AbortController;
  release?: (() => void) | undefined;
  task?: Promise<void> | undefined;
  activeRun?: AgentRun<unknown> | undefined;
  runId?: string | undefined;
  outcome?: Exclude<AgentOutcome<unknown>, { type: "interaction" }>;
  error?: unknown;
  usage: Usage;
  notifications: { from: string; type: "message" | "outcome"; id: string }[];
};

export function memberSummary(member: TeamMember): AgentTeamMemberSummary {
  return {
    instanceId: member.instanceId,
    agentId: member.agent.id,
    name: member.name,
    depth: member.depth,
    status: member.status,
    usage: lifecycleSnapshot(member.usage),
    ...omitUndefined({
      parentInstanceId: member.parentInstanceId,
      outcome: member.outcome === undefined ? undefined : lifecycleSnapshot(member.outcome),
      error: member.error,
    }),
  };
}

export function steeringMessages(input: AgentSteerInput): UserMessage[] {
  if (
    typeof input !== "object" ||
    input === null ||
    (input.prompt === undefined) === (input.messages === undefined)
  ) {
    throw new TypeError("Agent team steering requires exactly one of prompt or messages.");
  }
  const messages =
    input.prompt === undefined
      ? parseMessages(input.messages)
      : [
          parseMessage(
            typeof input.prompt === "string"
              ? { role: "user", content: input.prompt }
              : input.prompt,
          ),
        ];
  if (messages.length === 0 || messages.some((message) => message.role !== "user")) {
    throw new TypeError("Agent team steering requires user messages.");
  }
  return messages as UserMessage[];
}

export function agentMessageInput(message: AgentTeamMessage): TeamInput {
  return {
    id: message.id,
    submitted: false,
    message,
    messages: [
      {
        role: "user",
        content: `Message from another agent (not a user approval):\n${JSON.stringify(message)}`,
        metadata: { anvia: { agentMessage: { ...message } } },
      },
    ],
  };
}
