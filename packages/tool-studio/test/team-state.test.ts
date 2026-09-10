import { describe, expect, it } from "vitest";
import type { AgentTeamMemberSummary } from "@anvia/core/agent";
import { Usage } from "@anvia/core/completion";
import {
  initialTeamState,
  teamReducer,
  type TeamState,
} from "../src/ui/app/modules/teams/team-state";
import type { StudioTeamRunEvent } from "../src/team-types";
import { type Writable } from "../src/internal/type-utils";

const member = (instanceId: string, parentInstanceId?: string): AgentTeamMemberSummary => {
  const summary: Writable<AgentTeamMemberSummary> = {
    instanceId,
    agentId: "worker",
    name: "Worker",
    status: "queued",
    usage: Usage.empty(),
    depth: parentInstanceId ? 1 : 0,
  };
  if (parentInstanceId) summary.parentInstanceId = parentInstanceId;
  return summary;
};
const apply = (state: TeamState, event: StudioTeamRunEvent) =>
  teamReducer(state, { type: "event", event });
const identity = { teamRunId: "core-id", instanceId: "root", runId: "assignment-1" };

describe("Studio team state", () => {
  it("keeps repeated agent instances, recursive parents, and message delivery distinct", () => {
    let state = initialTeamState;
    for (const item of [
      member("root"),
      member("a", "root"),
      member("b", "root"),
      { ...member("child", "a"), depth: 2 },
    ]) {
      state = apply(state, {
        ...identity,
        type: "agent_queued",
        instanceId: item.instanceId,
        member: item,
      });
    }
    expect(Object.keys(state.members)).toHaveLength(4);
    expect(state.members.child?.parentInstanceId).toBe("a");
    expect(state.members.b?.status).toBe("queued");
    const message = {
      id: "message",
      teamRunId: "core-id",
      fromInstanceId: "a",
      toInstanceId: "b",
      content: "Review this",
      createdAt: new Date().toISOString(),
    };
    state = apply(state, { ...identity, type: "message_queued", message });
    state = apply(state, { ...identity, type: "message_delivered", message });
    expect(state.messages).toEqual([{ message, delivered: true }]);
  });

  it("attributes overlapping approvals and closes only the cancelled instance", () => {
    let state = initialTeamState;
    for (const id of ["a", "b"])
      state = apply(state, {
        ...identity,
        instanceId: id,
        type: "interaction",
        interaction: {
          id,
          type: "tool-approval",
          toolName: "write",
          toolCallId: id,
          internalCallId: id,
          input: {},
        },
      });
    state = apply(state, {
      ...identity,
      instanceId: "a",
      type: "agent_cancelled",
      member: { ...member("a"), status: "cancelled" },
    });
    expect(state.interactions.a?.status).toBe("cancelled");
    expect(state.interactions.b?.status).toBe("pending");
    state = teamReducer(state, { type: "answered", id: "b" });
    state = teamReducer(state, { type: "stop" });
    expect(state.interactions.b?.status).toBe("answered");
  });

  it("retains conversation order and separates resumed assignments", () => {
    let state = teamReducer(initialTeamState, { type: "start", prompt: "Work" });
    const text = (runId: string, delta: string): StudioTeamRunEvent => ({
      ...identity,
      runId,
      type: "agent_event",
      coordinator: true,
      event: { type: "text_delta", turn: 1, delta },
    });
    state = apply(state, text("first", "Starting"));
    state = teamReducer(state, { type: "prompt", prompt: "Focus on tests" });
    state = apply(state, text("second", "Testing"));
    state = apply(state, text("second", " now"));
    expect(state.conversation.map((entry) => entry.type)).toEqual([
      "prompt",
      "turn",
      "prompt",
      "turn",
    ]);
    expect(state.turns.map((turn) => turn.text)).toEqual(["Starting", "Testing now"]);
    expect(teamReducer(state, { type: "reset" })).toEqual(initialTeamState);
  });
});
