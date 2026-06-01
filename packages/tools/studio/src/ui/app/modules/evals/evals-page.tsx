import { Play } from "@phosphor-icons/react";
import type { StudioEvalRunResponse, StudioEvalSuiteConfig } from "../../../../types";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { JsonSyntax } from "../shared/renderers";

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

  if (!props.enabled) {
    return (
      <section className="grid min-h-0 place-items-center p-8 text-center">
        <div className="grid max-w-lg gap-3">
          <h1 className="m-0 text-2xl font-semibold text-foreground">Evals unavailable</h1>
          <p className="m-0 text-sm leading-6 text-muted-foreground">
            Register eval suites with Studio to run them from this workspace.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-h-0 overflow-auto bg-background/45">
      <div className="mx-auto grid w-full max-w-6xl content-start gap-5 p-6">
        <header className="flex min-w-0 items-start justify-between gap-4 border-b border-border/80 pb-5">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Evals
            </p>
            <h1 className="m-0 mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {selected?.name ?? "Eval suite"}
            </h1>
            {selected?.description === undefined ? null : (
              <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {selected.description}
              </p>
            )}
          </div>
          <Button
            className="h-9 shrink-0 rounded-lg px-3 text-sm font-semibold"
            disabled={selected === undefined || props.runState === "running"}
            onClick={props.onRun}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {props.runState === "running" ? "Running" : "Run"}
          </Button>
        </header>

        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="grid content-start gap-4">
            <label className="grid gap-2" htmlFor="eval-suite-select">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Suite
              </span>
              <Select value={selected?.id ?? ""} onValueChange={props.onSelectEval}>
                <SelectTrigger
                  id="eval-suite-select"
                  className="h-9 w-full rounded-lg border-primary/55 bg-background font-mono text-[11px]"
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
              <div className="grid gap-2">
                <Metric label="Cases" value={String(selected.caseCount)} />
                <Metric label="Metrics" value={String(selected.metricNames.length)} />
                <Metric label="Concurrency" value={String(selected.concurrency ?? 1)} />
              </div>
            )}
          </aside>

          <main className="min-w-0">
            {props.result === undefined ? (
              <div className="rounded-lg border border-border/80 bg-card/25 p-5 text-sm font-medium text-muted-foreground">
                Run a suite to inspect pass, fail, invalid, and per-case metric results.
              </div>
            ) : (
              <EvalResult result={props.result} />
            )}
          </main>
        </div>
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card/35 px-3 py-3">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
        {props.value}
      </div>
    </div>
  );
}

function EvalResult(props: { result: StudioEvalRunResponse }) {
  const result = props.result.result as {
    passed?: number;
    failed?: number;
    invalid?: number;
    durationMs?: number;
  };
  return (
    <article className="grid gap-4 rounded-lg border border-border/80 bg-card/25 p-4">
      <div className="grid grid-cols-4 gap-2">
        <Metric label="Passed" value={String(result.passed ?? 0)} />
        <Metric label="Failed" value={String(result.failed ?? 0)} />
        <Metric label="Invalid" value={String(result.invalid ?? 0)} />
        <Metric label="Duration" value={`${result.durationMs ?? props.result.durationMs}ms`} />
      </div>
      <div className="grid gap-2">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Result
        </div>
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/80 bg-background/55 p-3 font-mono text-xs leading-5 text-foreground">
          <JsonSyntax text={JSON.stringify(props.result.result, null, 2)} />
        </pre>
      </div>
    </article>
  );
}
