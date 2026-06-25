import { PlayIcon } from "@hugeicons/core-free-icons";
import type React from "react";
import type {
  StudioEvalCasePreview,
  StudioEvalMetricSummary,
  StudioEvalRunResponse,
  StudioEvalSuiteConfig,
} from "../../../../types";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

export function EvalsPage(props: {
  evals: StudioEvalSuiteConfig[];
  selectedEvalId: string;
  enabled: boolean;
  runState: "idle" | "running";
  result: StudioEvalRunResponse | undefined;
  onSelectEval: (evalId: string) => void;
  onRun: () => void;
}) {
  const selected = props.evals.find((suite) => suite.id === props.selectedEvalId) ?? props.evals[0];

  return (
    <section className="grid h-full min-h-0 min-w-0 max-h-full max-w-full overflow-hidden bg-background/45">
      <div className="grid min-h-0 min-w-0 pb-6 pr-6">
        <div className="grid min-h-0 min-w-0 content-start gap-5 overflow-auto rounded-2xl border border-border/80 bg-card/70 p-6 shadow-sm">
          <header className="flex min-w-0 items-start justify-between gap-4 border-b border-border/80 pb-5">
            <div className="min-w-0">
              <p className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Evals
              </p>
              <h1 className="m-0 mt-2 text-2xl font-semibold tracking-tight text-foreground">
                {selected?.name ?? "Eval suite"}
              </h1>
              <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {selected?.description ??
                  "Inspect eval datasets, metrics, run configuration, and per-case outcomes."}
              </p>
            </div>
            <RunButton
              disabled={!props.enabled || selected === undefined || props.runState === "running"}
              label={props.runState === "running" ? "Running" : "Run"}
              onRun={props.onRun}
            />
          </header>

          <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="grid content-start gap-4 border-r border-border/80 pr-5 max-lg:border-b max-lg:border-r-0 max-lg:pb-5 max-lg:pr-0">
              <label className="grid gap-2" htmlFor="eval-suite-select">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Suite
                </span>
                <Select value={selected?.id ?? ""} onValueChange={props.onSelectEval}>
                  <SelectTrigger
                    id="eval-suite-select"
                    className="h-9 w-full rounded-lg border-border/80 bg-background font-mono text-[11px] hover:border-muted-foreground/60 focus:border-muted-foreground/70 focus:ring-muted-foreground/20"
                  >
                    <SelectValue placeholder="Select eval" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.evals.map((suite) => (
                      <SelectItem key={suite.id} value={suite.id}>
                        {suite.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              {selected === undefined ? null : (
                <SuiteOverview suite={selected} enabled={props.enabled} />
              )}
            </aside>

            <main className="min-w-0">
              {selected === undefined ? (
                <EmptyEvals />
              ) : props.result === undefined ? (
                <BeforeRun suite={selected} enabled={props.enabled} runState={props.runState} />
              ) : (
                <EvalResult result={props.result} suite={selected} />
              )}
            </main>
          </div>
        </div>
      </div>
    </section>
  );
}

function RunButton(props: { disabled: boolean; label: string; onRun: () => void }) {
  return (
    <Button
      className="h-9 shrink-0 gap-1.5 rounded-lg border border-white bg-white px-3 text-sm font-semibold text-black shadow-none hover:border-white hover:bg-white/90 hover:text-black disabled:border-border disabled:bg-muted disabled:text-muted-foreground [&_svg]:!size-3"
      disabled={props.disabled}
      onClick={props.onRun}
      variant="ghost"
    >
      <StudioIcon icon={PlayIcon} aria-hidden="true" />
      {props.label}
    </Button>
  );
}

function SuiteOverview(props: { suite: StudioEvalSuiteConfig; enabled: boolean }) {
  const metadataKeys = objectKeys(props.suite.metadata);
  const previewCount = props.suite.casePreviewCount ?? props.suite.casePreviews?.length ?? 0;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Cases" value={String(props.suite.caseCount)} />
        <Metric label="Metrics" value={String(props.suite.metricNames.length)} />
        <Metric label="Concurrency" value={String(props.suite.concurrency ?? 1)} />
        <Metric label="Previewed" value={`${previewCount}/${props.suite.caseCount}`} />
      </div>

      <section className="grid gap-3 rounded-xl border border-border/70 bg-background/45 p-4">
        <div>
          <h2 className="m-0 text-sm font-semibold text-foreground">Run readiness</h2>
          <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
            {props.enabled
              ? "This suite is available in the current Studio runtime."
              : "Eval routes are not available in the current Studio runtime."}
          </p>
        </div>
        <div className="grid gap-2 text-xs text-muted-foreground">
          <KeyValue label="Suite id" value={props.suite.id} />
          <KeyValue
            label="Metadata keys"
            value={metadataKeys.length > 0 ? metadataKeys.join(", ") : "None"}
          />
        </div>
      </section>
    </div>
  );
}

function BeforeRun(props: {
  suite: StudioEvalSuiteConfig;
  enabled: boolean;
  runState: "idle" | "running";
}) {
  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-xl border border-border/80 bg-background/45 p-5">
        <div className="grid gap-1">
          <SectionLabel>What this eval tests</SectionLabel>
          <p className="m-0 max-w-3xl text-sm leading-6 text-foreground">
            {props.suite.description ??
              "This suite has no description. Use the dataset and metric definitions below to inspect coverage before running it."}
          </p>
        </div>
        <MetadataBlock metadata={props.suite.metadata} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <DatasetPreview suite={props.suite} />
        <div className="grid content-start gap-4">
          <MetricsPanel
            metrics={props.suite.metricSummaries}
            metricNames={props.suite.metricNames}
          />
          <RunSetup suite={props.suite} enabled={props.enabled} runState={props.runState} />
        </div>
      </div>
    </div>
  );
}

function DatasetPreview(props: { suite: StudioEvalSuiteConfig }) {
  const previews = props.suite.casePreviews ?? [];

  return (
    <section className="grid gap-3 rounded-xl border border-border/80 bg-background/45 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Dataset preview</SectionLabel>
          <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
            Showing {previews.length} of {props.suite.caseCount} cases.
          </p>
        </div>
        <span className="rounded-lg border border-border/80 bg-card/60 px-2.5 py-1 font-mono text-[11px] font-semibold text-muted-foreground">
          {props.suite.caseCount} cases
        </span>
      </div>

      {previews.length === 0 ? (
        <MutedPanel>No dataset preview is available for this suite.</MutedPanel>
      ) : (
        <div className="grid gap-3">
          {previews.map((testCase) => (
            <CasePreviewCard key={testCase.id} testCase={testCase} />
          ))}
        </div>
      )}
    </section>
  );
}

function CasePreviewCard(props: { testCase: StudioEvalCasePreview }) {
  return (
    <article className="grid gap-3 rounded-xl border border-border/70 bg-card/35 p-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="m-0 truncate font-mono text-sm font-semibold text-foreground">
          {props.testCase.id}
        </h3>
        {props.testCase.metadataKeys === undefined ? null : (
          <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {props.testCase.metadataKeys.length} metadata
          </span>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ValuePanel label="Input" value={props.testCase.input} emptyText="No input preview" />
        <ValuePanel
          label="Expected"
          value={props.testCase.expected}
          emptyText="No expected value"
        />
      </div>
    </article>
  );
}

function MetricsPanel(props: {
  metrics: StudioEvalMetricSummary[] | undefined;
  metricNames: string[];
}) {
  const metrics =
    props.metrics ??
    props.metricNames.map(
      (name): StudioEvalMetricSummary => ({
        name,
      }),
    );

  return (
    <section className="grid gap-3 rounded-xl border border-border/80 bg-background/45 p-5">
      <div>
        <SectionLabel>Metrics</SectionLabel>
        <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
          Scoring functions that evaluate every case output.
        </p>
      </div>
      {metrics.length === 0 ? (
        <MutedPanel>No metrics are configured for this suite.</MutedPanel>
      ) : (
        <div className="grid gap-2">
          {metrics.map((metric) => (
            <MetricSummaryRow key={metric.name} metric={metric} />
          ))}
        </div>
      )}
    </section>
  );
}

function MetricSummaryRow(props: { metric: StudioEvalMetricSummary }) {
  const details = [
    props.metric.dataType,
    props.metric.configId === undefined ? undefined : `config ${props.metric.configId}`,
    props.metric.scoreConfigId === undefined ? undefined : `score ${props.metric.scoreConfigId}`,
    props.metric.metadataKeys === undefined
      ? undefined
      : `${props.metric.metadataKeys.length} metadata`,
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-border/70 bg-card/35 px-3 py-3">
      <div className="font-mono text-sm font-semibold text-foreground">{props.metric.name}</div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {details.length > 0 ? details.join(" / ") : "No metric metadata"}
      </div>
    </div>
  );
}

function RunSetup(props: {
  suite: StudioEvalSuiteConfig;
  enabled: boolean;
  runState: "idle" | "running";
}) {
  return (
    <section className="grid gap-3 rounded-xl border border-border/80 bg-background/45 p-5">
      <div>
        <SectionLabel>Run configuration</SectionLabel>
        <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
          This run will execute {props.suite.caseCount} cases across{" "}
          {props.suite.metricNames.length} metrics.
        </p>
      </div>
      <div className="grid gap-2 text-xs text-muted-foreground">
        <KeyValue label="Concurrency" value={String(props.suite.concurrency ?? 1)} />
        <KeyValue label="Status" value={props.enabled ? props.runState : "Unavailable"} />
      </div>
    </section>
  );
}

function EvalResult(props: { result: StudioEvalRunResponse; suite: StudioEvalSuiteConfig }) {
  const result = runResult(props.result.result);
  const cases = Array.isArray(result.results) ? result.results : [];

  return (
    <article className="grid gap-4">
      <section className="grid gap-3 rounded-xl border border-border/80 bg-background/45 p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div>
            <SectionLabel>Run summary</SectionLabel>
            <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
              {props.result.runId} / {new Date(props.result.startedAt).toLocaleTimeString()}
            </p>
          </div>
          <span className="rounded-lg border border-border/80 bg-card/60 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {props.suite.name}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Metric label="Passed" value={String(result.passed ?? 0)} />
          <Metric label="Failed" value={String(result.failed ?? 0)} />
          <Metric label="Invalid" value={String(result.invalid ?? 0)} />
          <Metric label="Duration" value={`${result.durationMs ?? props.result.durationMs}ms`} />
        </div>
      </section>

      <section className="grid gap-3 rounded-xl border border-border/80 bg-background/45 p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div>
            <SectionLabel>Case results</SectionLabel>
            <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
              Each case shows the prompt, expected answer, model output, then metric judgments.
            </p>
          </div>
          <span className="rounded-lg border border-border/80 bg-card/60 px-2.5 py-1 font-mono text-[11px] font-semibold text-muted-foreground">
            {cases.length} cases
          </span>
        </div>
        {cases.length === 0 ? (
          <MutedPanel>No per-case results were returned by this eval run.</MutedPanel>
        ) : (
          <div className="grid gap-4">
            {cases.map((testCase, index) => (
              <CaseResultCard
                index={index}
                key={caseResultKey(testCase, index)}
                result={testCase}
              />
            ))}
          </div>
        )}
      </section>

      <RawDetails title="Raw result" value={props.result.result} />
    </article>
  );
}

function CaseResultCard(props: { index: number; result: EvalCaseRunResult }) {
  const testCase = isRecord(props.result.case) ? props.result.case : {};
  const metrics = Array.isArray(props.result.metrics) ? props.result.metrics : [];
  const caseId = typeof testCase.id === "string" ? testCase.id : `case-${props.index + 1}`;
  const counts = metricOutcomeCounts(metrics);
  const primaryStatus = casePrimaryStatus(counts);

  return (
    <article className="overflow-hidden rounded-xl border border-border/70 bg-card/35">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 border-b border-border/70 bg-background/35 px-4 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-7 min-w-7 items-center justify-center rounded-lg border border-border/80 bg-card/70 font-mono text-[11px] font-semibold text-muted-foreground">
            {props.index + 1}
          </span>
          <div className="min-w-0">
            <h3 className="m-0 truncate text-base font-semibold text-foreground">{caseId}</h3>
            <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
              {metrics.length} metric outcomes / {counts.passed} pass / {counts.failed} fail /{" "}
              {counts.invalid} invalid
            </p>
          </div>
        </div>
        <StatusBadge status={primaryStatus} />
      </div>

      <div className="grid gap-4 p-4">
        <section className="grid gap-3">
          <SectionLabel>Test case</SectionLabel>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <ValuePanel label="Input" value={testCase.input} emptyText="No input" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <ValuePanel
                label="Expected"
                value={testCase.expected}
                emptyText="No expected value"
              />
              <ValuePanel label="Output" value={props.result.output} emptyText="No output" />
            </div>
          </div>
        </section>

        {props.result.targetError === undefined ? null : (
          <ValuePanel
            label="Target error"
            value={props.result.targetError}
            emptyText="No target error"
          />
        )}

        <section className="grid gap-3">
          <SectionLabel>Metric judgments</SectionLabel>
          {metrics.length === 0 ? (
            <MutedPanel>No metric results were returned for this case.</MutedPanel>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/70 bg-background/45">
              <div className="grid grid-cols-[minmax(0,1fr)_96px_96px] gap-3 border-b border-border/70 px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span>Metric</span>
                <span>Score</span>
                <span className="text-right">Status</span>
              </div>
              <div className="grid">
                {metrics.map((metric, index) => (
                  <MetricOutcomeRow index={index} key={metricOutcomeKey(metric)} metric={metric} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </article>
  );
}

function MetricOutcomeRow(props: { index: number; metric: EvalMetricRunResult }) {
  const outcome = isRecord(props.metric.outcome) ? props.metric.outcome : {};
  const status = typeof outcome.outcome === "string" ? outcome.outcome : "unknown";
  const reporterErrors = Array.isArray(props.metric.reporterErrors)
    ? props.metric.reporterErrors
    : [];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_96px_96px] gap-3 border-b border-border/60 px-3 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate font-mono text-sm font-semibold text-foreground">
          {props.metric.metricName ?? `metric-${props.index + 1}`}
        </div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          {typeof outcome.comment === "string"
            ? outcome.comment
            : typeof outcome.reason === "string"
              ? outcome.reason
              : "No comment"}
        </div>
        {reporterErrors.length > 0 ? (
          <pre className="m-0 mt-2 whitespace-pre-wrap break-words rounded-md border border-border/70 bg-card/45 p-2 font-mono text-[11px] leading-5 text-muted-foreground">
            {formatValue(reporterErrors)}
          </pre>
        ) : null}
      </div>
      <div className="font-mono text-xs leading-6 text-foreground">
        {"score" in outcome ? formatValue(outcome.score) : "n/a"}
      </div>
      <div className="flex justify-end">
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

function StatusBadge(props: { status: string }) {
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-border/80 bg-card/70 px-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
      {props.status}
    </span>
  );
}

function EmptyEvals() {
  return (
    <section className="rounded-xl border border-border/80 bg-background/45 p-5">
      <SectionLabel>No eval suites</SectionLabel>
      <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
        0 eval suite records are available in this Studio runtime.
      </p>
    </section>
  );
}

function MetadataBlock(props: { metadata: unknown }) {
  const entries = isRecord(props.metadata) ? Object.entries(props.metadata) : [];
  if (entries.length === 0) {
    return <MutedPanel>No suite metadata was provided.</MutedPanel>;
  }

  return (
    <div className="grid gap-2 rounded-xl border border-border/70 bg-card/35 p-4">
      <SectionLabel>Suite metadata</SectionLabel>
      <div className="grid gap-2 text-xs text-muted-foreground">
        {entries.map(([key, value]) => (
          <KeyValue key={key} label={key} value={formatValue(value)} />
        ))}
      </div>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/35 px-3 py-3">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
        {props.value}
      </div>
    </div>
  );
}

function ValuePanel(props: { label: string; value: unknown; emptyText: string }) {
  const hasValue = props.value !== undefined;

  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-background/45 p-3">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {props.label}
      </div>
      <pre className="m-0 mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
        {hasValue ? formatValue(props.value) : props.emptyText}
      </pre>
    </div>
  );
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </span>
      <span className="min-w-0 break-words text-right font-mono text-xs text-foreground">
        {props.value}
      </span>
    </div>
  );
}

function MutedPanel(props: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/35 p-3 text-sm leading-6 text-muted-foreground">
      {props.children}
    </div>
  );
}

function SectionLabel(props: { children: React.ReactNode }) {
  return (
    <h2 className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {props.children}
    </h2>
  );
}

function RawDetails(props: { title: string; value: unknown }) {
  return (
    <details className="rounded-xl border border-border/80 bg-background/45 p-5">
      <summary className="cursor-pointer font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {props.title}
      </summary>
      <pre className="mt-3 max-h-[45vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-card/35 p-3 font-mono text-xs leading-5 text-foreground">
        {formatValue(props.value)}
      </pre>
    </details>
  );
}

type EvalSuiteRunResult = {
  passed?: number;
  failed?: number;
  invalid?: number;
  durationMs?: number;
  results?: EvalCaseRunResult[];
};

type EvalCaseRunResult = {
  case?: unknown;
  output?: unknown;
  targetError?: unknown;
  metrics?: EvalMetricRunResult[];
};

type EvalMetricRunResult = {
  metricName?: string;
  outcome?: unknown;
  reporterErrors?: unknown[];
};

function runResult(value: unknown): EvalSuiteRunResult {
  return isRecord(value) ? (value as EvalSuiteRunResult) : {};
}

function caseResultKey(result: EvalCaseRunResult, index: number): string {
  const testCase = isRecord(result.case) ? result.case : {};
  return typeof testCase.id === "string" ? testCase.id : `case-${index + 1}`;
}

function metricOutcomeCounts(metrics: EvalMetricRunResult[]): {
  passed: number;
  failed: number;
  invalid: number;
} {
  return metrics.reduce(
    (counts, metric) => {
      const outcome = isRecord(metric.outcome) ? metric.outcome.outcome : undefined;
      if (outcome === "pass") {
        counts.passed += 1;
      }
      if (outcome === "fail") {
        counts.failed += 1;
      }
      if (outcome === "invalid") {
        counts.invalid += 1;
      }
      return counts;
    },
    { passed: 0, failed: 0, invalid: 0 },
  );
}

function casePrimaryStatus(counts: { passed: number; failed: number; invalid: number }): string {
  if (counts.failed > 0) {
    return "fail";
  }
  if (counts.invalid > 0) {
    return "invalid";
  }
  if (counts.passed > 0) {
    return "pass";
  }
  return "unknown";
}

function metricOutcomeKey(result: EvalMetricRunResult): string {
  if (typeof result.metricName === "string" && result.metricName.length > 0) {
    return result.metricName;
  }
  return formatValue(result);
}

function objectKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).filter((key) => value[key] !== undefined) : [];
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
