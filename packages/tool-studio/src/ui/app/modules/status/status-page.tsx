import { useCallback, useEffect, useState } from "react";
import type { StudioStatusSummary } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { formatRelativeTime } from "../shared/format";
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
      <header className="bg-background/70 pb-3 pl-4 pr-6 pt-4 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Operations
            </div>
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              Status
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Runtime health, storage adapters, feature capabilities, and current record counts.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap justify-end gap-2 max-md:justify-start">
            <StatusMetric label="agents" value={summary?.counts.agents ?? 0} />
            <StatusMetric label="sessions" value={summary?.counts.sessions ?? "-"} />
            <StatusMetric label="traces" value={summary?.counts.traces ?? "-"} />
            <Button
              className="h-8 min-h-8 rounded-md px-3 text-xs"
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => void loadStatus()}
            >
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 overflow-auto pb-6 pl-4 pr-6">
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
          <StatusDashboard summary={summary} />
        )}
      </div>
    </section>
  );
}

function StatusDashboard(props: { summary: StudioStatusSummary }) {
  const capabilityEntries = Object.entries(props.summary.capabilities);
  const enabledCapabilityCount = capabilityEntries.filter(
    ([, capability]) => capability?.enabled === true,
  ).length;

  return (
    <div className="grid h-full min-h-0 gap-5 border-t border-border/80 pt-4">
      <section className="grid gap-5 xl:grid-cols-[minmax(280px,0.58fr)_minmax(0,1.42fr)]">
        <RuntimeSummary summary={props.summary} enabledCapabilityCount={enabledCapabilityCount} />
        <div className="grid gap-5 lg:grid-cols-2">
          <StorageMatrix storage={props.summary.storage} />
          <CountsLedger counts={props.summary.counts} />
        </div>
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <CapabilityLedger capabilities={props.summary.capabilities} />
        <RawSummary summary={props.summary} />
      </section>
    </div>
  );
}

function RuntimeSummary(props: { summary: StudioStatusSummary; enabledCapabilityCount: number }) {
  return (
    <section className="grid content-start gap-5 border-b border-border/80 pb-5 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-5">
      <div className="grid gap-3">
        <SectionLabel>runtime</SectionLabel>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge className="border-border/80 bg-muted/45 text-foreground">online</Badge>
          <Badge className="border-border/80 bg-background/45 text-muted-foreground">
            {props.enabledCapabilityCount} capabilities
          </Badge>
        </div>
      </div>
      <div className="grid border-y border-border/80">
        <StatusFact label="id" value={props.summary.runner.id} />
        <StatusFact label="name" value={props.summary.runner.name ?? "-"} />
        <StatusFact label="version" value={props.summary.runner.version ?? "-"} />
        <StatusFact
          label="generated"
          value={`${formatRelativeTime(props.summary.generatedAt)} / ${props.summary.generatedAt}`}
        />
      </div>
    </section>
  );
}

function StorageMatrix(props: { storage: StudioStatusSummary["storage"] }) {
  const entries = Object.entries(props.storage);
  return (
    <section className="grid content-start gap-3">
      <SectionHeader title="storage" value={`${entries.length} adapters`} />
      {entries.length === 0 ? (
        <DashedNote text="No storage adapters reported." />
      ) : (
        <div className="grid border-y border-border/80">
          {entries.map(([key, value]) => (
            <StatusRow
              label={humanizeKey(key)}
              value={value ?? "-"}
              key={key}
              tone={value === undefined ? "muted" : "normal"}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CountsLedger(props: { counts: StudioStatusSummary["counts"] }) {
  const entries = Object.entries(props.counts).filter((entry): entry is [string, number] => {
    return typeof entry[1] === "number";
  });
  return (
    <section className="grid content-start gap-3">
      <SectionHeader title="records" value={`${entries.length} counters`} />
      <div className="grid border-y border-border/80">
        {entries.map(([key, value]) => (
          <StatusRow label={humanizeKey(key)} value={value} key={key} />
        ))}
      </div>
    </section>
  );
}

function CapabilityLedger(props: { capabilities: StudioStatusSummary["capabilities"] }) {
  const entries = Object.entries(props.capabilities);
  return (
    <section className="grid content-start gap-3">
      <SectionHeader title="capabilities" value={`${entries.length} reported`} />
      {entries.length === 0 ? (
        <DashedNote text="No capabilities reported." />
      ) : (
        <div className="grid border-y border-border/80 sm:grid-cols-2 sm:divide-x sm:divide-border/80">
          {entries.map(([name, capability], index) => (
            <div
              className={[
                "grid min-w-0 gap-1 border-b border-border/70 px-3 py-3",
                index >= entries.length - (entries.length % 2 === 0 ? 2 : 1) ? "sm:border-b-0" : "",
              ].join(" ")}
              key={name}
            >
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {humanizeKey(name)}
                </span>
                <span
                  className={
                    capability?.enabled
                      ? "text-xs font-medium text-foreground"
                      : "text-xs font-medium text-muted-foreground"
                  }
                >
                  {capability?.enabled ? "enabled" : "disabled"}
                </span>
              </div>
              {capability?.reason === undefined ? null : (
                <p className="m-0 text-xs leading-5 text-muted-foreground">{capability.reason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RawSummary(props: { summary: StudioStatusSummary }) {
  return (
    <section className="grid min-w-0 content-start gap-3">
      <SectionHeader title="raw summary" value="JSON" />
      <details className="group grid min-w-0 overflow-hidden border-y border-border/80" open>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 bg-muted/10 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground marker:hidden">
          Payload
          <span className="font-medium normal-case tracking-normal group-open:hidden">Show</span>
          <span className="hidden font-medium normal-case tracking-normal group-open:inline">
            Hide
          </span>
        </summary>
        <div className="min-w-0 overflow-x-auto border-t border-border/70">
          <pre className="m-0 max-h-[28rem] min-w-max p-4 text-xs leading-5 text-foreground">
            <code>
              <JsonSyntax text={JSON.stringify(props.summary, null, 2)} />
            </code>
          </pre>
        </div>
      </details>
    </section>
  );
}

function StatusMetric(props: { label: string; value: string | number }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-md border border-border/70 bg-background/45 px-2.5 text-xs font-medium text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">{props.value}</span>
      {props.label}
    </span>
  );
}

function SectionHeader(props: { title: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <SectionLabel>{props.title}</SectionLabel>
      <span className="text-xs font-medium text-muted-foreground">{props.value}</span>
    </div>
  );
}

function SectionLabel(props: { children: string }) {
  return (
    <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {props.children}
    </h2>
  );
}

function StatusFact(props: { label: string; value: string | number }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-border/70 px-3 py-3 first:pt-3 last:border-b-0">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </span>
      <span className="min-w-0 truncate text-sm text-foreground" title={String(props.value)}>
        {props.value}
      </span>
    </div>
  );
}

function StatusRow(props: { label: string; value: string | number; tone?: "normal" | "muted" }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(120px,0.5fr)_minmax(0,1fr)] gap-3 border-b border-border/70 px-3 py-3 last:border-b-0">
      <span className="min-w-0 truncate text-sm font-medium text-muted-foreground">
        {props.label}
      </span>
      <span
        className={[
          "min-w-0 truncate text-right text-sm font-semibold tabular-nums",
          props.tone === "muted" ? "text-muted-foreground" : "text-foreground",
        ].join(" ")}
        title={String(props.value)}
      >
        {props.value}
      </span>
    </div>
  );
}

function DashedNote(props: { text: string }) {
  return (
    <div className="border-y border-dashed border-border/80 px-3 py-8 text-center text-sm text-muted-foreground">
      {props.text}
    </div>
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

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}
