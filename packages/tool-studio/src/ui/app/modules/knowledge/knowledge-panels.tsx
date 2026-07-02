import { useEffect, useMemo, useState } from "react";
import type { StudioKnowledgeItem, StudioKnowledgeSummary } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { isRecord } from "../shared/object";
import { JsonSyntax, JsonValueView } from "../shared/renderers";
import { type ItemState, type KnowledgeSourceRef, sourceId, sourceLabel } from "./knowledge-model";

export function ItemBrowser(props: {
  source: KnowledgeSourceRef | undefined;
  state: ItemState | undefined;
  onLoadMore: () => void;
}) {
  const state = props.state;
  if (props.source?.source.kind === "dynamic_tools") {
    return (
      <DynamicToolsBrowser source={props.source} state={state} onLoadMore={props.onLoadMore} />
    );
  }

  return (
    <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
      <div className="min-h-0 overflow-auto">
        <div className="pb-4 pt-0">
          {props.source === undefined ? <MutedRow text="No knowledge source selected" /> : null}
          {state?.loading === true && state.items.length === 0 ? (
            <MutedRow text="Loading items" />
          ) : null}
          {state?.error === undefined ? null : <MutedRow text={state.error} />}
          {state?.inspectable === false ? (
            <MutedRow text={state.message ?? "This source does not expose browseable chunks."} />
          ) : null}
          {state?.inspectable !== false && state?.loading === false && state.items.length === 0 ? (
            <MutedRow text="No items in this source" />
          ) : null}
          <div className="grid gap-3">
            {state?.items.map((item) => (
              <KnowledgeItemCard
                item={item}
                key={`${item.kind}:${item.id}`}
                source={props.source}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex min-h-12 items-center justify-between gap-3 border-t border-border/80 bg-muted/10 py-2">
        <span className=" text-xs text-muted-foreground">
          {state === undefined ? "0 loaded" : `${state.items.length} loaded`}
        </span>
        <Button
          className="h-8 min-h-8"
          type="button"
          variant="secondary"
          disabled={state?.loading === true || state?.nextCursor === undefined}
          onClick={props.onLoadMore}
        >
          Load more
        </Button>
      </div>
    </section>
  );
}

function KnowledgeItemCard(props: {
  item: StudioKnowledgeItem;
  source: KnowledgeSourceRef | undefined;
}) {
  if (props.item.kind === "dynamic_tool") {
    return (
      <article className="rounded-xl border border-border/80 bg-background/55 p-4">
        <DynamicToolInspector item={props.item} source={props.source} />
      </article>
    );
  }

  return (
    <article className="grid gap-3 rounded-xl border border-border/80 bg-background/55 p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">
            {props.item.toolName ?? props.item.id}
          </div>
        </div>
        {props.item.parameterKeys === undefined || props.item.parameterKeys.length === 0 ? null : (
          <Badge>{props.item.parameterKeys.length} params</Badge>
        )}
      </div>
      {props.item.description === undefined || props.item.description.length === 0 ? null : (
        <p className="m-0 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          {props.item.description}
        </p>
      )}
      {props.item.text === undefined ? null : (
        <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
          {props.item.text}
        </p>
      )}
      {props.item.document === undefined ? null : (
        <JsonBlock title="Document" value={props.item.document} />
      )}
      {props.item.metadata === undefined ? null : (
        <JsonBlock title="Metadata" value={props.item.metadata} />
      )}
      {props.item.parameterKeys === undefined || props.item.parameterKeys.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {props.item.parameterKeys.map((key) => (
            <Badge key={key}>{key}</Badge>
          ))}
        </div>
      )}
    </article>
  );
}

type DynamicToolParameter = {
  name: string;
  type: string;
  required: boolean;
  description: string | undefined;
};

function DynamicToolsBrowser(props: {
  source: KnowledgeSourceRef;
  state: ItemState | undefined;
  onLoadMore: () => void;
}) {
  const tools = useMemo(
    () => (props.state?.items ?? []).filter(isDynamicToolItem),
    [props.state?.items],
  );
  const [selectedId, setSelectedId] = useState("");
  const selectedTool = tools.find((item) => item.id === selectedId) ?? tools[0];
  const stats = useMemo(() => dynamicToolStats(tools), [tools]);

  useEffect(() => {
    if (tools.length === 0) {
      setSelectedId("");
      return;
    }
    if (!tools.some((item) => item.id === selectedId)) {
      setSelectedId(tools[0]?.id ?? "");
    }
  }, [selectedId, tools]);

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border/80 py-3 max-md:grid-cols-1">
        <div className="grid min-w-0 gap-1">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Runtime tool index
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold text-foreground">
              {props.source.source.label ?? sourceLabel(props.source.source.kind)}
            </span>
            <span className="text-muted-foreground">{props.source.agentName}</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap justify-end gap-2 max-md:justify-start">
          <KnowledgeMetric label="tools" value={tools.length} />
          <KnowledgeMetric label="params" value={stats.parameterCount} />
          <KnowledgeMetric label="required" value={stats.requiredCount} />
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(270px,0.34fr)_minmax(0,1fr)] overflow-hidden max-lg:grid-cols-1 max-lg:grid-rows-[minmax(220px,0.44fr)_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-auto border-r border-border/80 pr-3 max-lg:border-b max-lg:border-r-0 max-lg:pr-0">
          <div className="grid gap-1 py-3 pr-3 max-lg:pr-0">
            {props.source === undefined ? <MutedRow text="No knowledge source selected" /> : null}
            {props.state?.loading === true && tools.length === 0 ? (
              <MutedRow text="Loading dynamic tools" />
            ) : null}
            {props.state?.error === undefined ? null : <MutedRow text={props.state.error} />}
            {props.state?.inspectable === false ? (
              <MutedRow
                text={props.state.message ?? "This source does not expose browseable tools."}
              />
            ) : null}
            {props.state?.inspectable !== false &&
            props.state?.loading === false &&
            tools.length === 0 ? (
              <MutedRow text="No dynamic tools in this source" />
            ) : null}
            {tools.map((item) => (
              <DynamicToolListItem
                active={selectedTool?.id === item.id}
                item={item}
                key={item.id}
                onSelect={() => setSelectedId(item.id)}
              />
            ))}
          </div>
        </aside>

        <div className="min-h-0 overflow-auto py-4 pl-5 max-lg:pl-0">
          {selectedTool === undefined ? (
            <DynamicToolEmptyPanel />
          ) : (
            <DynamicToolInspector item={selectedTool} source={props.source} />
          )}
        </div>
      </div>

      <div className="flex min-h-12 items-center justify-between gap-3 border-t border-border/80 bg-background/30 py-2">
        <span className="text-xs text-muted-foreground">
          {props.state === undefined ? "0 loaded" : `${props.state.items.length} loaded`}
        </span>
        <Button
          className="h-8 min-h-8"
          type="button"
          variant="secondary"
          disabled={props.state?.loading === true || props.state?.nextCursor === undefined}
          onClick={props.onLoadMore}
        >
          Load more
        </Button>
      </div>
    </section>
  );
}

function DynamicToolListItem(props: {
  item: StudioKnowledgeItem;
  active: boolean;
  onSelect: () => void;
}) {
  const definition = dynamicToolDefinition(props.item);
  const parameters = dynamicToolParameters(props.item);
  const requiredCount = parameters.filter((parameter) => parameter.required).length;
  const toolName = definition.name ?? props.item.toolName ?? props.item.id;

  return (
    <button
      className={[
        "grid min-w-0 gap-2 rounded-lg border border-transparent px-3 py-3 text-left transition duration-200 hover:border-border/80 hover:bg-muted/25 focus-visible:border-ring focus-visible:outline-none",
        props.active ? "border-border/80 bg-muted/35 text-foreground" : "text-muted-foreground",
      ].join(" ")}
      type="button"
      onClick={props.onSelect}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-sm font-semibold text-foreground">
          {toolName}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {parameters.length}
        </span>
      </div>
      <p className="m-0 line-clamp-2 text-xs leading-5 text-muted-foreground">
        {definition.description ?? props.item.description ?? "No description"}
      </p>
      <div className="flex min-w-0 flex-wrap gap-2 text-[11px] font-medium text-muted-foreground">
        <span>{requiredCount} required</span>
        <span>{parameters.length - requiredCount} optional</span>
      </div>
    </button>
  );
}

function DynamicToolInspector(props: {
  item: StudioKnowledgeItem;
  source: KnowledgeSourceRef | undefined;
}) {
  const definition = dynamicToolDefinition(props.item);
  const parameters = dynamicToolParameters(props.item);
  const description = definition.description ?? props.item.description;
  const toolName = definition.name ?? props.item.toolName ?? props.item.id;

  return (
    <article className="grid min-w-0 gap-5">
      <header className="grid gap-4 border-b border-border/80 pb-5">
        <div className="flex min-w-0 items-start justify-between gap-4 max-md:grid">
          <div className="grid min-w-0 gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Selected tool
            </div>
            <h2 className="m-0 truncate font-mono text-2xl font-semibold leading-none text-foreground">
              {toolName}
            </h2>
          </div>
          <div className="flex min-w-0 flex-wrap justify-end gap-2 max-md:justify-start">
            <Badge>{parameters.length} params</Badge>
            <Badge>{parameters.filter((parameter) => parameter.required).length} required</Badge>
          </div>
        </div>
        {description === undefined || description.length === 0 ? null : (
          <p className="m-0 max-w-[72ch] text-base leading-7 text-muted-foreground [overflow-wrap:anywhere]">
            {description}
          </p>
        )}
        <div className="min-w-0 overflow-x-auto border-y border-border/80 bg-muted/15 px-3 py-2">
          <code className="font-mono text-sm leading-6 text-foreground">
            {dynamicToolSignature(toolName, parameters)}
          </code>
        </div>
      </header>

      <DynamicToolParameterList parameters={parameters} />
      <DynamicToolSourceDetails item={props.item} source={props.source} />

      {props.item.document === undefined ? null : (
        <JsonDetails title="Raw definition" value={props.item.document} />
      )}

      {props.item.metadata === undefined ? null : (
        <JsonDetails title="Metadata" value={props.item.metadata} />
      )}
    </article>
  );
}

function DynamicToolParameterList(props: { parameters: DynamicToolParameter[] }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Parameters
        </h3>
        <span className="text-xs font-medium text-muted-foreground">
          {props.parameters.length === 0 ? "No parameters" : `${props.parameters.length} defined`}
        </span>
      </div>
      {props.parameters.length === 0 ? (
        <div className="border-y border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">
          This tool does not declare input parameters.
        </div>
      ) : (
        <div className="min-w-0 overflow-hidden border-y border-border/80">
          {props.parameters.map((parameter) => (
            <div
              className="grid min-w-0 grid-cols-[minmax(140px,0.24fr)_minmax(96px,0.14fr)_minmax(96px,0.14fr)_minmax(0,1fr)] gap-4 border-b border-border/70 py-3 last:border-b-0 max-md:grid-cols-1 max-md:gap-1"
              key={parameter.name}
            >
              <div className="min-w-0 font-mono text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                {parameter.name}
              </div>
              <div className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {parameter.type}
              </div>
              <div className="text-sm text-muted-foreground">
                {parameter.required ? "Required" : "Optional"}
              </div>
              <div className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                {parameter.description ?? "No description"}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DynamicToolSourceDetails(props: {
  item: StudioKnowledgeItem;
  source: KnowledgeSourceRef | undefined;
}) {
  const details = [
    { label: "Agent", value: props.source?.agentName ?? props.source?.agentId },
    {
      label: "Source",
      value:
        props.source === undefined
          ? undefined
          : `${props.source.source.label ?? sourceLabel(props.source.source.kind)} / ${sourceId(
              props.source.source,
            )}`,
    },
    { label: "Item ID", value: props.item.id },
  ].filter((item): item is { label: string; value: string } => item.value !== undefined);

  if (details.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-3 border-t border-border/80 pt-4">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Source
      </h3>
      <dl className="grid border-y border-border/80 sm:grid-cols-3 sm:divide-x sm:divide-border/80">
        {details.map((detail) => (
          <div className="min-w-0 px-3 py-3 first:pl-0 last:pr-0" key={detail.label}>
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {detail.label}
            </dt>
            <dd className="m-0 mt-1 truncate text-sm font-medium text-foreground">
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function DynamicToolEmptyPanel() {
  return (
    <section className="grid h-full min-h-80 place-items-center border-y border-dashed border-border/80 px-6 text-center">
      <div className="grid max-w-sm gap-2">
        <h2 className="m-0 text-base font-semibold text-foreground">No dynamic tool selected</h2>
        <p className="m-0 text-sm leading-6 text-muted-foreground">
          Select a tool from the index to inspect its definition and parameters.
        </p>
      </div>
    </section>
  );
}

function dynamicToolDefinition(item: StudioKnowledgeItem): {
  name: string | undefined;
  description: string | undefined;
  parameters: unknown;
} {
  const document = isRecord(item.document) ? item.document : undefined;
  const definition = isRecord(document?.definition) ? document.definition : undefined;
  const name =
    typeof definition?.name === "string"
      ? definition.name
      : typeof document?.toolName === "string"
        ? document.toolName
        : item.toolName;
  const description =
    typeof definition?.description === "string" ? definition.description : item.description;

  return {
    name,
    description,
    parameters: definition?.parameters,
  };
}

function dynamicToolParameters(item: StudioKnowledgeItem): DynamicToolParameter[] {
  const definition = dynamicToolDefinition(item);
  const schema = isRecord(definition.parameters) ? definition.parameters : undefined;
  const properties = isRecord(schema?.properties) ? schema.properties : undefined;
  const required = new Set(
    Array.isArray(schema?.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : [],
  );

  if (properties === undefined) {
    return (item.parameterKeys ?? []).map((name) => ({
      name,
      type: "unknown",
      required: false,
      description: undefined,
    }));
  }

  return Object.entries(properties).map(([name, value]) => {
    const property = isRecord(value) ? value : {};
    return {
      name,
      type: schemaTypeLabel(property.type),
      required: required.has(name),
      description: typeof property.description === "string" ? property.description : undefined,
    };
  });
}

function isDynamicToolItem(item: StudioKnowledgeItem): item is StudioKnowledgeItem & {
  kind: "dynamic_tool";
} {
  return item.kind === "dynamic_tool";
}

function dynamicToolStats(items: StudioKnowledgeItem[]): {
  parameterCount: number;
  requiredCount: number;
} {
  return items.reduce(
    (totals, item) => {
      const parameters = dynamicToolParameters(item);
      totals.parameterCount += parameters.length;
      totals.requiredCount += parameters.filter((parameter) => parameter.required).length;
      return totals;
    },
    { parameterCount: 0, requiredCount: 0 },
  );
}

function dynamicToolSignature(toolName: string, parameters: DynamicToolParameter[]): string {
  if (parameters.length === 0) {
    return `${toolName}()`;
  }
  return `${toolName}({ ${parameters
    .map((parameter) => `${parameter.name}${parameter.required ? "" : "?"}: ${parameter.type}`)
    .join(", ")} })`;
}

function KnowledgeMetric(props: { label: string; value: number }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 border border-border/70 bg-background/45 px-2.5 text-xs font-medium text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">{props.value}</span>
      {props.label}
    </span>
  );
}

function schemaTypeLabel(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const labels = value.filter((item): item is string => typeof item === "string");
    return labels.length === 0 ? "unknown" : labels.join(" / ");
  }
  return "unknown";
}

function JsonDetails(props: { title: string; value: unknown }) {
  const display = jsonDisplay(props.value);

  return (
    <details className="group rounded-xl border border-border/80 bg-card/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground marker:hidden">
        <span>{props.title}</span>
        <span className="text-xs normal-case tracking-normal text-muted-foreground group-open:hidden">
          Show
        </span>
        <span className="hidden text-xs normal-case tracking-normal text-muted-foreground group-open:inline">
          Hide
        </span>
      </summary>
      <div className="border-t border-border/70">
        <pre className="m-0 max-h-96 overflow-auto p-4 font-mono text-xs leading-5 text-foreground">
          <code>
            <JsonSyntax text={display} />
          </code>
        </pre>
      </div>
    </details>
  );
}

function jsonDisplay(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify(String(value), null, 2);
  }
}

export function RetrievalLogPanel(props: {
  evidence: NonNullable<StudioKnowledgeSummary["evidence"]>;
  onOpenTrace: (traceId: string) => void;
}) {
  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-border/80 bg-card/55">
      <div className="border-b border-border/80 px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-sm font-semibold text-foreground">Retrieval log</h2>
            <p className="m-0 mt-1 truncate text-xs text-muted-foreground">
              traces / retrieval-evidence
            </p>
          </div>
          <Badge>{props.evidence.length} entries</Badge>
        </div>
      </div>
      <div className="min-h-0 overflow-auto p-4">
        {props.evidence.length === 0 ? (
          <MutedRow text="No retrieval evidence captured yet" />
        ) : null}
        <div className="grid gap-3">
          {props.evidence.map((item) => (
            <article
              className="grid gap-3 rounded-xl border border-border/80 bg-background/45 p-3"
              key={`${item.traceId}:${item.observationId}`}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {item.observationName}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Turn {item.turn}</div>
                </div>
                <Button
                  className="h-auto min-h-0 rounded-lg border border-border bg-muted px-2 py-1 text-xs text-muted-foreground"
                  type="button"
                  variant="ghost"
                  onClick={() => props.onOpenTrace(item.traceId)}
                >
                  Trace
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{item.documentCount} docs</Badge>
                <Badge>{item.toolCount} tools</Badge>
              </div>
              {item.query === undefined ? null : (
                <p className="m-0 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                  <span className=" text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                    Query
                  </span>{" "}
                  {item.query}
                </p>
              )}
              {item.documents.slice(0, 2).map((document) => (
                <p
                  className="m-0 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]"
                  key={`${document.id ?? "doc"}:${document.text ?? ""}`}
                >
                  <span className=" text-foreground">{document.id ?? "document"}</span>{" "}
                  {document.text ?? ""}
                </p>
              ))}
              {item.tools.length === 0 ? null : (
                <p className="m-0 text-xs leading-5 text-muted-foreground">
                  Tools: {item.tools.join(", ")}
                </p>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function JsonBlock(props: { title: string; value: unknown }) {
  return (
    <div className="grid gap-2 border-t border-border/70 pt-3">
      <div className=" text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {props.title}
      </div>
      <JsonValueView value={props.value} />
    </div>
  );
}

export function EmptyState(props: { title: string; text: string }) {
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
    <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground">
      {props.text}
    </div>
  );
}
