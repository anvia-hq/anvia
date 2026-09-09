import type { AgentTeamMemberSummary, AgentTeamMessage } from "@anvia/core/agent";
import type { AgentInteractionRequest } from "@anvia/core/agent/interactions";
import type { Message } from "@anvia/core/completion";
import type { StudioTeamRunEvent } from "../../../../team-types";
import { errorMessage } from "../shared/format";

export type TeamInteraction = {
  instanceId: string;
  request: AgentInteractionRequest;
  status: "pending" | "answered" | "cancelled";
};
export type TeamTurn = {
  key: string;
  instanceId: string;
  coordinator: boolean;
  text: string;
  tools: string[];
  messages?: readonly Message[];
};
export type TeamState = {
  status: "idle" | "running" | "completed" | "blocked" | "cancelled" | "failed";
  runId?: string;
  error?: string;
  members: Record<string, AgentTeamMemberSummary>;
  turns: TeamTurn[];
  messages: { message: AgentTeamMessage; delivered: boolean }[];
  interactions: Record<string, TeamInteraction>;
  conversation: ({ type: "prompt"; text: string } | { type: "turn"; key: string })[];
};
export const initialTeamState: TeamState = {
  status: "idle",
  members: {},
  turns: [],
  messages: [],
  interactions: {},
  conversation: [],
};
export type TeamAction =
  | { type: "start"; prompt: string }
  | { type: "prompt"; prompt: string }
  | { type: "event"; event: StudioTeamRunEvent }
  | { type: "answered"; id: string }
  | { type: "stop"; error?: string }
  | { type: "reset" };

function closeInteractions(state: TeamState, instanceId?: string) {
  return Object.fromEntries(
    Object.entries(state.interactions).map(([id, item]) => [
      id,
      item.status === "pending" && (instanceId === undefined || item.instanceId === instanceId)
        ? { ...item, status: "cancelled" as const }
        : item,
    ]),
  );
}

export function teamReducer(state: TeamState, action: TeamAction): TeamState {
  switch (action.type) {
    case "reset":
      return initialTeamState;
    case "start":
      return {
        ...initialTeamState,
        status: "running",
        conversation: [{ type: "prompt", text: action.prompt }],
      };
    case "prompt":
      return {
        ...state,
        conversation: [...state.conversation, { type: "prompt", text: action.prompt }],
      };
    case "stop":
      return {
        ...state,
        status: action.error ? "failed" : "cancelled",
        ...(action.error ? { error: action.error } : {}),
        interactions: closeInteractions(state),
        members: Object.fromEntries(
          Object.entries(state.members).map(([id, member]) => [
            id,
            ["queued", "running", "waiting", "awaiting_interaction"].includes(member.status)
              ? { ...member, status: "cancelled" }
              : member,
          ]),
        ),
      };
    case "answered": {
      const item = state.interactions[action.id];
      return item !== undefined
        ? {
            ...state,
            interactions: { ...state.interactions, [action.id]: { ...item, status: "answered" } },
          }
        : state;
    }
    case "event":
      break;
  }
  const event = action.event;
  if (event.type === "team_run_started") return { ...state, runId: event.runId };
  if (event.type === "error")
    return teamReducer(state, { type: "stop", error: errorMessage(event.error) });
  if (event.type === "response" || event.type === "blocked")
    return {
      ...state,
      status: event.type === "response" ? "completed" : "blocked",
      // Terminal outcomes contain descendants only; retain the coordinator as the tree root.
      members: {
        ...state.members,
        ...Object.fromEntries(event.members.map((member) => [member.instanceId, member])),
      },
      interactions: closeInteractions(state),
    };
  if ("member" in event)
    return {
      ...state,
      members: { ...state.members, [event.instanceId]: event.member },
      ...(event.type === "agent_cancelled" || event.type === "agent_failed"
        ? { interactions: closeInteractions(state, event.instanceId) }
        : {}),
    };
  if (event.type === "interaction")
    return {
      ...state,
      interactions: {
        ...state.interactions,
        [event.interaction.id]: {
          instanceId: event.instanceId,
          request: event.interaction,
          status: "pending",
        },
      },
    };
  if (event.type === "message_queued" || event.type === "message_delivered") {
    const previous = state.messages.find((item) => item.message.id === event.message.id);
    const item = {
      message: event.message,
      delivered: previous?.delivered === true || event.type === "message_delivered",
    };
    return {
      ...state,
      messages: previous
        ? state.messages.map((old) => (old.message.id === item.message.id ? item : old))
        : [...state.messages, item].slice(-500),
    };
  }
  if (event.type !== "agent_event") return state;
  const key = `${event.instanceId}:${event.runId ?? "initial"}`;
  const turn = state.turns.find((item) => item.key === key) ?? {
    key,
    instanceId: event.instanceId,
    coordinator: event.coordinator,
    text: "",
    tools: [],
  };
  const inner = event.event;
  let updated: TeamTurn;
  switch (inner.type) {
    case "text_delta":
      updated = { ...turn, text: turn.text + inner.delta };
      break;
    case "tool_call":
      updated = { ...turn, tools: [...turn.tools, JSON.stringify(inner.toolCall)].slice(-100) };
      break;
    case "tool_result":
      updated = {
        ...turn,
        tools: [...turn.tools, `${inner.toolName}: ${JSON.stringify(inner.output, null, 2)}`].slice(
          -100,
        ),
      };
      break;
    case "response":
    case "blocked":
      updated = {
        ...turn,
        text: inner.text,
        messages: inner.messages,
        tools: inner.messages
          .flatMap((message) => {
            if (typeof message.content === "string") return [];
            return message.content
              .filter((part) => part.type === "tool-call" || part.type === "tool-result")
              .map((part) => JSON.stringify(part, null, 2));
          })
          .slice(-100),
      };
      break;
    default:
      return state;
  }
  return {
    ...state,
    conversation:
      updated.coordinator && !state.turns.some((item) => item.key === key)
        ? [...state.conversation, { type: "turn" as const, key }].slice(-500)
        : state.conversation,
    turns: state.turns.some((item) => item.key === key)
      ? state.turns.map((item) => (item.key === key ? updated : item))
      : [...state.turns, updated].slice(-500),
  };
}
