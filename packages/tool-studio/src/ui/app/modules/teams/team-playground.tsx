import { useEffect, useRef, useState, type ReactNode } from "react";
import type { StudioTeamConfig } from "../../../../team-types";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { MarkdownText } from "../shared/renderers";
import { TeamInteractionCard } from "./team-interactions";
import { TeamMembers, TeamMessages } from "./team-members";
import { useTeamRun } from "./use-team-run";

export function TeamPlayground({
  team,
  targetSelector,
}: {
  team: StudioTeamConfig;
  targetSelector: (running: boolean) => ReactNode;
}) {
  const run = useTeamRun(team.id);
  const [prompt, setPrompt] = useState("");
  const [selected, select] = useState("");
  const [tab, setTab] = useState<"members" | "messages">("members");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const running = run.state.status === "running";
  const started = run.state.status !== "idle";
  useEffect(() => {
    const element = scrollRef.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [run.state]);
  async function send() {
    const value = prompt.trim();
    if (!value) return;
    if (running) {
      if (await run.steer(value)) setPrompt("");
    } else {
      setPrompt("");
      stick.current = true;
      void run.start(value);
    }
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-auto lg:overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hair px-5 py-3">
        <div className="flex items-center gap-3">{targetSelector(running)}</div>
        <div className="flex items-center gap-3">
          <span role="status" className="text-xs text-muted-foreground">
            {run.state.status}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={running}
            onClick={() => {
              run.reset();
              setPrompt("");
              select("");
            }}
          >
            New task
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-h-[480px] min-w-0 flex-col lg:min-h-0">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-auto px-5 py-6"
            onScroll={() => {
              const element = scrollRef.current;
              if (element)
                stick.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            }}
          >
            <div className="mx-auto max-w-3xl space-y-6">
              {!started && (
                <div className="py-16">
                  <h1 className="text-2xl font-medium">Work with {team.id}</h1>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Give the coordinator a task. Follow its agents, messages, and requests as they
                    work.
                  </p>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Available members:{" "}
                    {team.members.map((member) => member.name ?? member.id).join(", ") || "None"}
                  </p>
                </div>
              )}
              {run.state.conversation.map((entry, index) => {
                if (entry.type === "prompt")
                  return (
                    <article key={`prompt:${index}`} className="rounded-xl bg-muted p-4">
                      <div className="mb-2 text-xs text-muted-foreground">You</div>
                      <p className="whitespace-pre-wrap break-words text-sm">{entry.text}</p>
                    </article>
                  );
                const turn = run.state.turns.find((item) => item.key === entry.key);
                return turn?.text ? (
                  <article key={entry.key}>
                    <div className="mb-2 text-xs text-muted-foreground">Coordinator</div>
                    <MarkdownText text={turn.text} live={running} size="base" />
                  </article>
                ) : null;
              })}
              {Object.values(run.state.interactions).map((item) => (
                <TeamInteractionCard
                  key={item.request.id}
                  item={item}
                  name={run.state.members[item.instanceId]?.name ?? item.instanceId}
                  busy={run.busy.has(item.request.id)}
                  respond={run.respond}
                />
              ))}
              {run.state.error && (
                <p role="alert" className="text-sm text-status-danger-ink">
                  {run.state.error}
                </p>
              )}
              {run.controlError && (
                <p role="alert" className="text-sm text-status-danger-ink">
                  {run.controlError}
                </p>
              )}
            </div>
          </div>
          <form
            className="mx-auto w-full max-w-3xl space-y-3 px-5 pb-5 pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Textarea
              aria-label={running ? "Message coordinator" : "Team task"}
              placeholder={
                running ? "Send a follow-up to the coordinator…" : "Give this team a task…"
              }
              value={prompt}
              maxLength={32768}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={started && !running}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if ((!started || running) && !run.busy.has("steer")) void send();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                This run stays in this page. Leaving stops active work.
              </p>
              {running && (
                <Button type="button" variant="secondary" size="sm" onClick={run.stop}>
                  Stop team
                </Button>
              )}
              <Button
                size="sm"
                disabled={
                  !prompt.trim() ||
                  (started && !running) ||
                  (running && (!run.state.runId || run.busy.has("steer")))
                }
              >
                {running ? "Send follow-up" : "Run team"}
              </Button>
            </div>
          </form>
        </div>
        <aside
          className="min-h-64 min-w-0 space-y-5 overflow-auto border-t border-hair p-5 lg:border-t-0 lg:border-l"
          aria-label="Team activity"
        >
          <div className="flex gap-2">
            <Button
              variant={tab === "members" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab("members")}
            >
              Members
            </Button>
            <Button
              variant={tab === "messages" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab("messages")}
            >
              Messages
            </Button>
          </div>
          {tab === "members" ? (
            <TeamMembers state={run.state} selected={selected} select={select} />
          ) : (
            <TeamMessages state={run.state} />
          )}
        </aside>
      </div>
    </div>
  );
}
