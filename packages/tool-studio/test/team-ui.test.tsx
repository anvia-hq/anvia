// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { Usage } from "@anvia/core/completion";
import { TeamMembers } from "../src/ui/app/modules/teams/team-members";
import { TeamInteractionCard } from "../src/ui/app/modules/teams/team-interactions";
import { initialTeamState, teamReducer } from "../src/ui/app/modules/teams/team-state";

afterEach(() => vi.unstubAllGlobals());
it("keeps the coordinator and recursive member tree visible after terminal outcomes omit the coordinator", () => {
  const root = {
    instanceId: "root",
    agentId: "team",
    name: "Coordinator",
    depth: 0,
    status: "idle" as const,
    usage: Usage.empty(),
  };
  const child = {
    ...root,
    instanceId: "child",
    agentId: "worker",
    name: "Researcher",
    parentInstanceId: "root",
    depth: 1,
  };
  const grandchild = {
    ...child,
    instanceId: "grandchild",
    name: "Reviewer",
    parentInstanceId: "child",
    depth: 2,
  };
  const state = teamReducer(
    { ...initialTeamState, members: { root, child, grandchild } },
    {
      type: "event",
      event: {
        type: "response",
        teamRunId: "core",
        runId: "run",
        text: "Done",
        output: "Done",
        usage: Usage.empty(),
        messages: [],
        members: [child, grandchild],
      },
    },
  );
  const html = renderToStaticMarkup(
    <TeamMembers state={state} selected="grandchild" select={() => undefined} />,
  );
  expect(html).toContain("Coordinator");
  expect(html).toContain("Researcher");
  expect(html).toContain("Reviewer");
  expect(html).toContain('aria-pressed="true"');
  expect(Object.keys(state.members)).toEqual(["root", "child", "grandchild"]);
});

it("submits question choice values with the originating interaction ID", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const respond = vi.fn(async () => true);
  act(() =>
    root.render(
      <TeamInteractionCard
        name="Reviewer"
        busy={false}
        respond={respond}
        item={{
          instanceId: "reviewer-instance",
          status: "pending",
          request: {
            id: "question-id",
            type: "tool-question",
            toolName: "ask",
            toolCallId: "tool",
            internalCallId: "internal",
            questions: [
              {
                id: "focus",
                text: "What should I review?",
                choices: [
                  { label: "Runtime", value: "runtime" },
                  { label: "UI", value: "ui" },
                ],
              },
            ],
          },
        }}
      />,
    ),
  );
  try {
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.querySelector("textarea")).toBeNull();
    act(() => container.querySelector<HTMLInputElement>('input[value="runtime"]')!.click());
    expect(container.querySelector("button")?.disabled).toBe(false);
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(respond).toHaveBeenCalledWith("question-id", {
      type: "tool-question",
      answers: [{ questionId: "focus", value: "runtime" }],
    });
  } finally {
    act(() => root.unmount());
  }
});

it("shows custom answers and disables controls for cancelled interactions", () => {
  const html = renderToStaticMarkup(
    <TeamInteractionCard
      name="Researcher"
      busy={false}
      respond={async () => true}
      item={{
        instanceId: "researcher-instance",
        status: "cancelled",
        request: {
          id: "question-id",
          type: "tool-question",
          toolName: "ask",
          toolCallId: "tool",
          internalCallId: "internal",
          questions: [
            {
              id: "scope",
              text: "Scope?",
              allowCustom: true,
              choices: [{ label: "Small", value: "small" }],
            },
          ],
        },
      }}
    />,
  );
  expect(html).toContain("researcher-instance");
  expect(html).toContain("textarea");
  expect(html).toContain('disabled=""');
});
