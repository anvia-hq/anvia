import type { AgentTeamMemberSummary } from "@anvia/core/agent";
import { MarkdownText } from "../shared/renderers";
import { errorMessage } from "../shared/format";
import { cn } from "../../lib/utils";
import type { TeamState } from "./team-state";

export function TeamMembers(props: {
  state: TeamState;
  selected: string;
  select: (id: string) => void;
}) {
  const members = Object.values(props.state.members);
  const selected =
    props.state.members[props.selected] ?? members.find((member) => member.depth === 0);
  function node(member: AgentTeamMemberSummary) {
    return (
      <li key={member.instanceId}>
        <button
          type="button"
          onClick={() => props.select(member.instanceId)}
          title={member.instanceId}
          aria-pressed={selected?.instanceId === member.instanceId}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted",
            selected?.instanceId === member.instanceId && "bg-muted",
          )}
          style={{ paddingLeft: 12 + member.depth * 16 }}
        >
          <span className="min-w-0 truncate">
            {member.depth > 0 ? "↳ " : ""}
            {member.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {member.status.replaceAll("_", " ")}
          </span>
        </button>
        <ul>{members.filter((child) => child.parentInstanceId === member.instanceId).map(node)}</ul>
      </li>
    );
  }
  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-3 text-sm font-medium">
          Members <span className="text-muted-foreground">{members.length}</span>
        </h2>
        {members.length ? (
          <ul aria-label="Team members">
            {members.filter((member) => !member.parentInstanceId).map(node)}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Spawned agents will appear here as the team works.
          </p>
        )}
      </div>
      {selected && (
        <section className="space-y-4 border-t border-hair pt-4" aria-label="Member details">
          <div>
            <h3 className="text-sm font-medium">{selected.name}</h3>
            <p className="break-all text-xs text-muted-foreground">
              {selected.agentId} · {selected.instanceId}
            </p>
          </div>
          {selected.error !== undefined && (
            <p role="alert" className="text-sm text-status-danger-ink">
              {errorMessage(selected.error)}
            </p>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Token usage</summary>
            <pre className="overflow-auto p-2">{JSON.stringify(selected.usage, null, 2)}</pre>
          </details>
          {props.state.turns
            .filter((turn) => turn.instanceId === selected.instanceId)
            .map((turn) => (
              <div key={turn.key} className="space-y-3">
                {turn.text && (
                  <MarkdownText text={turn.text} live={props.state.status === "running"} />
                )}
                {turn.tools.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Tool activity ({turn.tools.length})
                    </summary>
                    {turn.tools.map((tool, index) => (
                      <pre
                        key={index}
                        className="my-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs"
                      >
                        {tool}
                      </pre>
                    ))}
                  </details>
                )}
                {turn.messages && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Run messages
                    </summary>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(turn.messages, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
        </section>
      )}
    </div>
  );
}

export function TeamMessages({ state }: { state: TeamState }) {
  const name = (id: string) => state.members[id]?.name ?? id;
  return (
    <section className="space-y-3" aria-label="Messages between agents">
      <h2 className="text-sm font-medium">
        Messages <span className="text-muted-foreground">{state.messages.length}</span>
      </h2>
      {!state.messages.length && (
        <p className="text-sm text-muted-foreground">Messages between agents will appear here.</p>
      )}
      {state.messages.map(({ message, delivered }) => (
        <article key={message.id} className="space-y-2 rounded-lg border border-hair p-3">
          <div className="text-xs font-medium">
            {name(message.fromInstanceId)} → {name(message.toInstanceId)}
          </div>
          <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
          <p className="text-xs text-muted-foreground">
            {delivered ? "Delivered" : "Queued"} ·{" "}
            {new Date(message.createdAt).toLocaleTimeString()}
          </p>
        </article>
      ))}
    </section>
  );
}
