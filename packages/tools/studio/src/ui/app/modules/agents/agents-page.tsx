import type { StudioConfig } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { cn } from "../../lib/utils";
import { JsonValueView } from "../shared/renderers";

export function AgentsPage(props: { agents: StudioConfig["agents"]; selectedAgentId: string }) {
  return (
    <section className="grid min-h-0 w-full overflow-auto" aria-label="Agents">
      <div className="min-w-260 border-b border-border bg-card">
        <div className="grid min-h-10 grid-cols-[minmax(220px,1.1fr)_minmax(280px,1.4fr)_160px_minmax(220px,0.9fr)] items-center gap-4 border-b border-border px-5 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <span>Agent</span>
          <span>Description</span>
          <span>Quick prompts</span>
          <span>Metadata</span>
        </div>
        {props.agents.length === 0 ? (
          <div className="px-5 py-4 text-sm font-medium text-muted-foreground">No agents</div>
        ) : null}
        {props.agents.map((agent) => (
          <div
            className={cn(
              "grid min-h-16 grid-cols-[minmax(220px,1.1fr)_minmax(280px,1.4fr)_160px_minmax(220px,0.9fr)] items-start gap-4 border-b border-border px-5 py-3 text-left text-muted-foreground",
              agent.id === props.selectedAgentId && "bg-primary/10 text-primary",
            )}
            key={agent.id}
          >
            <span className="grid min-w-0 gap-0.5">
              <strong className="min-w-0 truncate text-sm font-medium text-foreground">
                {agent.name ?? agent.id}
              </strong>
              <span className="min-w-0 truncate font-mono text-xs font-medium text-muted-foreground">
                {agent.id}
              </span>
            </span>
            <p className="m-0 min-w-0 text-sm leading-6 text-muted-foreground">
              {agent.description ?? "No description"}
            </p>
            <span className="flex min-w-0 flex-wrap gap-1.5">
              {agent.quickPrompts.length === 0 ? (
                <span className="text-xs font-medium text-muted-foreground">None</span>
              ) : (
                agent.quickPrompts.map((prompt) => <Badge key={prompt}>{prompt}</Badge>)
              )}
            </span>
            <span className="min-w-0 overflow-hidden text-xs text-muted-foreground">
              {agent.metadata === undefined ? "None" : <JsonValueView value={agent.metadata} />}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
