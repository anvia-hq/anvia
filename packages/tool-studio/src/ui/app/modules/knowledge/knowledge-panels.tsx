import type { StudioKnowledgeItem, StudioKnowledgeSummary } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { isRecord } from "../shared/object";
import { JsonSyntax, JsonValueView } from "../shared/renderers";
import {
  type ItemState,
  itemKindLabel,
  type KnowledgeSourceRef,
  sourceId,
} from "./knowledge-model";

export function ItemBrowser(props: {
  source: KnowledgeSourceRef | undefined;
  state: ItemState | undefined;
  onLoadMore: () => void;
}) {
  const state = props.state;
  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-border/80 bg-card/55">
      <div className="border-b border-border/80 px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-sm font-semibold text-foreground">
              {props.source?.source.label ?? "Knowledge items"}
            </h2>
            <p className="m-0 mt-1 truncate text-xs text-muted-foreground">
              {props.source === undefined
                ? "No source selected"
                : `${props.source.agentId} / ${sourceId(props.source.source)}`}
            </p>
          </div>
          {state?.totalCount === undefined ? null : <Badge>{state.totalCount} total</Badge>}
        </div>
      </div>
      <div className="min-h-0 overflow-auto">
        <div className="p-4">
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
      <div className="flex min-h-12 items-center justify-between gap-3 bg-muted/10 px-4 py-2">
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
    return <DynamicToolCard item={props.item} source={props.source} />;
  }

  return (
    <article className="grid gap-3 rounded-xl border border-border/80 bg-background/55 p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">
            {props.item.toolName ?? props.item.id}
          </div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {itemKindLabel(props.item.kind)}
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

function DynamicToolCard(props: {
  item: StudioKnowledgeItem;
  source: KnowledgeSourceRef | undefined;
}) {
  const definition = dynamicToolDefinition(props.item);
  const parameters = dynamicToolParameters(props.item);
  const description = definition.description ?? props.item.description;
  const hasStructuredDefinition =
    definition.name !== undefined || description !== undefined || parameters.length > 0;

  return (
    <article className="grid gap-5 rounded-2xl border border-border/80 bg-background/55 p-5">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-base font-semibold text-foreground">
            {definition.name ?? props.item.toolName ?? props.item.id}
          </h3>
          <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Dynamic tool
          </div>
        </div>
        <Badge>{parameters.length} params</Badge>
      </div>

      {description === undefined || description.length === 0 ? null : (
        <p className="m-0 max-w-4xl text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          {description}
        </p>
      )}

      {hasStructuredDefinition || props.item.text === undefined ? null : (
        <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
          {props.item.text}
        </p>
      )}

      <DynamicToolParameters parameters={parameters} />

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

function DynamicToolParameters(props: { parameters: DynamicToolParameter[] }) {
  return (
    <section className="grid gap-3 border-t border-border/70 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Parameters
        </h4>
        <span className="text-xs font-medium text-muted-foreground">
          {props.parameters.length === 0 ? "No parameters" : `${props.parameters.length} defined`}
        </span>
      </div>
      {props.parameters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-4 py-3 text-sm text-muted-foreground">
          This tool does not declare input parameters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card/35">
          <div className="overflow-x-auto">
            <table className="w-full min-w-full border-separate border-spacing-0 text-left">
              <thead className="bg-muted/20">
                <tr>
                  <th className="border-b border-border/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Name
                  </th>
                  <th className="border-b border-border/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Type
                  </th>
                  <th className="border-b border-border/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Required
                  </th>
                  <th className="border-b border-border/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                {props.parameters.map((parameter) => (
                  <tr key={parameter.name}>
                    <td className="border-b border-border/70 px-4 py-3 text-sm font-semibold leading-6 text-foreground [overflow-wrap:anywhere]">
                      {parameter.name}
                    </td>
                    <td className="border-b border-border/70 px-4 py-3 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                      {parameter.type}
                    </td>
                    <td className="border-b border-border/70 px-4 py-3 text-sm leading-6 text-muted-foreground">
                      {parameter.required ? "Yes" : "No"}
                    </td>
                    <td className="border-b border-border/70 px-4 py-3 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                      {parameter.description ?? "No description"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          : `${props.source.source.label} / ${sourceId(props.source.source)}`,
    },
    { label: "Item ID", value: props.item.id },
  ].filter((item): item is { label: string; value: string } => item.value !== undefined);

  if (details.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-3 border-t border-border/70 pt-4">
      <h4 className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Source
      </h4>
      <dl className="grid gap-2 sm:grid-cols-3">
        {details.map((detail) => (
          <div
            className="min-w-0 rounded-xl border border-border/70 bg-card/25 p-3"
            key={detail.label}
          >
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
