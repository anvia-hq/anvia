import type { AgentTeamEvent, AgentTeamLimits } from "@anvia/core/agent";
import type { Message } from "@anvia/core/completion";

export type StudioTeamConfig = {
  id: string;
  members: { id: string; name?: string; description?: string }[];
  limits: Readonly<Required<AgentTeamLimits>>;
};

export type StudioTeamRunRequest =
  | { prompt: string; messages?: never }
  | { messages: readonly Message[]; prompt?: never };

/** JSONL events; runId on team_run_started addresses Studio's live run controls. */
export type StudioTeamRunEvent =
  | { type: "team_run_started"; teamId: string; runId: string }
  | AgentTeamEvent<unknown>
  | { type: "error"; error: unknown };
