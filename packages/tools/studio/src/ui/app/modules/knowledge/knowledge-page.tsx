import { RefreshCw } from "lucide-react";
import type { StudioKnowledgeSummary } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { JsonValueView } from "../shared/renderers";

export function KnowledgePage(props: {
  enabled: boolean;
  summary: StudioKnowledgeSummary | undefined;
  loading: boolean;
  onOpenTrace: (traceId: string) => void;
  onRefresh: () => void;
}) {
  if (!props.enabled) {
    return (
      <EmptyState
        title="Knowledge unavailable"
        text="No registered agent exposes inspectable context."
      />
    );
  }

  const agents = props.summary?.agents ?? [];
  const evidence = props.summary?.evidence ?? [];

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/45">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border/80 bg-card/70 px-6 shadow-sm">
        <div className="min-w-0">
          <h1 className="m-0 text-sm font-semibold text-foreground">Knowledge</h1>
          <p className="m-0 text-xs font-medium text-muted-foreground">
            Context and retrieval signals visible to Studio
          </p>
        </div>
        <Button
          className="h-8 min-h-8 gap-2"
          type="button"
          variant="secondary"
          onClick={props.onRefresh}
        >
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </header>
      <div className="min-h-0 overflow-auto p-6">
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.8fr)]">
          <section className="grid min-w-0 content-start gap-3" aria-label="Agent knowledge">
            {props.loading && agents.length === 0 ? <MutedRow text="Loading knowledge" /> : null}
            {!props.loading && agents.length === 0 ? (
              <MutedRow text="No knowledge sources" />
            ) : null}
            {agents.map((agent) => (
              <Card className="overflow-hidden rounded-sm bg-card/90" key={agent.agentId}>
                <div className="grid gap-1 border-b border-border/80 px-4 py-3">
                  <strong className="truncate text-sm font-semibold text-foreground">
                    {agent.agentName ?? agent.agentId}
                  </strong>
                  <span className="truncate font-mono text-xs font-medium text-muted-foreground">
                    {agent.agentId}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 border-b border-border/80 bg-muted/20 px-4 py-3">
                  {agent.sources.map((source) => (
                    <Badge className="rounded-sm" key={source.kind}>
                      {source.kind.replaceAll("_", " ")}: {source.count}
                    </Badge>
                  ))}
                </div>
                <div className="grid gap-0">
                  {agent.staticContext.length === 0 ? (
                    <MutedRow text="No static context" />
                  ) : (
                    agent.staticContext.map((document) => (
                      <div
                        className="grid gap-2 border-b border-border/75 px-4 py-3.5 last:border-b-0"
                        key={document.id}
                      >
                        <span className="font-mono text-xs font-semibold text-muted-foreground">
                          {document.id}
                        </span>
                        <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
                          {document.text}
                        </p>
                        {document.additionalProps === undefined ? null : (
                          <JsonValueView value={document.additionalProps} />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </Card>
            ))}
          </section>
          <section className="grid min-w-0 content-start gap-3" aria-label="Recent evidence">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Recent trace evidence
            </div>
            {evidence.length === 0 ? <MutedRow text="No retrieved context captured yet" /> : null}
            {evidence.map((item) => (
              <Card
                className="overflow-hidden rounded-sm bg-card/90"
                key={`${item.traceId}:${item.observationId}`}
              >
                <div className="grid gap-1 border-b border-border/80 px-4 py-3">
                  <strong className="truncate text-sm font-semibold text-foreground">
                    {item.observationName}
                  </strong>
                  <Button
                    className="h-auto min-h-0 max-w-full justify-self-start rounded-sm border border-border bg-muted px-2 py-1 font-mono text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    type="button"
                    variant="ghost"
                    onClick={() => props.onOpenTrace(item.traceId)}
                  >
                    {item.traceId}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 border-b border-border/80 bg-muted/20 px-4 py-3">
                  <Badge>Turn {item.turn}</Badge>
                  <Badge>{item.documentCount} docs</Badge>
                  <Badge>{item.toolCount} tools</Badge>
                </div>
                <div className="grid gap-2 px-4 py-3">
                  {item.query === undefined ? null : (
                    <p className="m-0 border-b border-border pb-3 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                      <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
                        Query
                      </span>{" "}
                      {item.query}
                    </p>
                  )}
                  {item.documents.slice(0, 4).map((document) => (
                    <p
                      className="m-0 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]"
                      key={`${document.id ?? "doc"}:${document.text ?? ""}`}
                    >
                      <span className="font-mono text-xs text-foreground">
                        {document.id ?? "document"}
                      </span>{" "}
                      {document.text ?? ""}
                    </p>
                  ))}
                  {item.tools.length === 0 ? null : (
                    <p className="m-0 text-sm leading-6 text-muted-foreground">
                      Tools: {item.tools.join(", ")}
                    </p>
                  )}
                </div>
              </Card>
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}

function EmptyState(props: { title: string; text: string }) {
  return (
    <section className="grid h-full place-items-center p-8">
      <div className="grid max-w-sm gap-2 text-center">
        <h1 className="m-0 text-base font-semibold text-foreground">{props.title}</h1>
        <p className="m-0 text-sm font-medium leading-6 text-muted-foreground">{props.text}</p>
      </div>
    </section>
  );
}

function MutedRow(props: { text: string }) {
  return (
    <div className="rounded-sm border border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground">
      {props.text}
    </div>
  );
}
