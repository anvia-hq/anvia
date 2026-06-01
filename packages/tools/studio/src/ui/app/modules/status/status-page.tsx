import { useCallback, useEffect, useState } from "react";
import type { StudioStatusSummary } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { JsonSyntax } from "../shared/renderers";

export function StatusPage(props: { enabled: boolean }) {
  const [summary, setSummary] = useState<StudioStatusSummary | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    if (!props.enabled) {
      setSummary(undefined);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/status");
      if (!response.ok) {
        throw new Error(`Status failed with HTTP ${response.status}`);
      }
      setSummary((await response.json()) as StudioStatusSummary);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setSummary(undefined);
    } finally {
      setLoading(false);
    }
  }, [props.enabled]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55"
      aria-label="Status"
    >
      <header className="bg-background/70 pb-5 pl-0 pr-6 pt-0 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">
              Operations
            </div>
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              Status
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Runtime health, storage adapters, feature capabilities, and current record counts.
            </p>
          </div>
          <Button
            className="h-9 min-h-9 rounded-lg px-3 font-mono text-xs"
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={() => void loadStatus()}
          >
            Refresh
          </Button>
        </div>
      </header>

      <div className="min-h-0 overflow-auto pb-6 pl-0 pr-6">
        {!props.enabled ? (
          <EmptyState
            title="Status unavailable"
            text="This Studio runtime did not expose status."
          />
        ) : loading && summary === undefined ? (
          <EmptyState title="Loading status" text="Reading runtime status." />
        ) : error.length > 0 ? (
          <EmptyState title="Status error" text={error} />
        ) : summary === undefined ? null : (
          <div className="grid gap-4">
            <div className="grid gap-4 lg:grid-cols-4">
              <Metric label="Agents" value={summary.counts.agents} />
              <Metric label="Pipelines" value={summary.counts.pipelines} />
              <Metric label="Sessions" value={summary.counts.sessions ?? "-"} />
              <Metric label="Traces" value={summary.counts.traces ?? "-"} />
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <section className="grid gap-3 rounded-xl border border-border/80 bg-card/45 p-5">
                <SectionLabel>runtime</SectionLabel>
                <KeyValue label="id" value={summary.runner.id} />
                <KeyValue label="name" value={summary.runner.name ?? "-"} />
                <KeyValue label="version" value={summary.runner.version ?? "-"} />
                <KeyValue label="generated" value={summary.generatedAt} />
              </section>
              <section className="grid gap-3 rounded-xl border border-border/80 bg-card/45 p-5">
                <SectionLabel>storage</SectionLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(summary.storage).map(([key, value]) => (
                    <KeyValue key={key} label={key} value={value ?? "-"} />
                  ))}
                  {Object.entries(summary.storage).length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/80 bg-background/45 px-3 py-2 text-sm text-muted-foreground">
                      No storage adapters reported.
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
            <section className="grid gap-3 rounded-xl border border-border/80 bg-card/45 p-5">
              <SectionLabel>capabilities</SectionLabel>
              <div className="flex min-w-0 flex-wrap gap-2">
                {Object.entries(summary.capabilities).map(([name, capability]) => (
                  <Badge
                    className={
                      capability?.enabled
                        ? "border-primary/35 bg-primary/10 text-primary"
                        : "border-border/80 bg-muted/55 text-muted-foreground"
                    }
                    key={name}
                  >
                    {name}
                  </Badge>
                ))}
              </div>
            </section>
            <section className="grid min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card/45">
              <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/80 bg-muted/20 px-4">
                <SectionLabel>raw summary</SectionLabel>
              </div>
              <div className="min-w-0 overflow-x-auto">
                <pre className="m-0 min-w-max p-4 font-mono text-[12px] leading-5 text-foreground">
                  <code>
                    <JsonSyntax text={JSON.stringify(summary, null, 2)} />
                  </code>
                </pre>
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: string | number }) {
  return (
    <div className="grid gap-2 rounded-xl border border-border/80 bg-card/45 p-5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {props.label}
      </span>
      <span className="font-mono text-3xl font-semibold tracking-tight text-foreground">
        {props.value}
      </span>
    </div>
  );
}

function KeyValue(props: { label: string; value: string | number }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-lg bg-background/45 px-3 py-2 text-sm">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </span>
      <span
        className="min-w-0 truncate font-mono text-xs text-foreground"
        title={String(props.value)}
      >
        {props.value}
      </span>
    </div>
  );
}

function SectionLabel(props: { children: string }) {
  return (
    <h2 className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
      {props.children}
    </h2>
  );
}

function EmptyState(props: { title: string; text: string }) {
  return (
    <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-border/80 bg-card/35 px-6 text-center">
      <div className="grid max-w-md gap-2">
        <h2 className="m-0 text-base font-semibold text-foreground">{props.title}</h2>
        <p className="m-0 text-sm leading-6 text-muted-foreground">{props.text}</p>
      </div>
    </div>
  );
}
