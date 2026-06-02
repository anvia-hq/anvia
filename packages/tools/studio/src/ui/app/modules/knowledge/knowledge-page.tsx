import { ArrowClockwise } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type {
  StudioAgentKnowledgeConfig,
  StudioKnowledgeItem,
  StudioKnowledgeItemsPage,
  StudioKnowledgeSourceKind,
  StudioKnowledgeSourceSummary,
  StudioKnowledgeSummary,
} from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { JsonValueView } from "../shared/renderers";
import type { KnowledgeTab } from "../shared/types";

const itemLimit = 50;

type KnowledgeSourceRef = {
  key: string;
  agentId: string;
  agentName: string;
  source: StudioKnowledgeSourceSummary;
};

type ItemState = {
  key: string;
  loading: boolean;
  items: StudioKnowledgeItem[];
  nextCursor?: string;
  totalCount?: number;
  inspectable: boolean;
  message?: string;
  error?: string;
};

export function KnowledgePage(props: {
  activeTab: KnowledgeTab;
  enabled: boolean;
  summary: StudioKnowledgeSummary | undefined;
  loading: boolean;
  onOpenTrace: (traceId: string) => void;
  onRefresh: () => void;
  onSelectTab: (tab: KnowledgeTab) => void;
}) {
  const [selectedKey, setSelectedKey] = useState("");
  const [itemState, setItemState] = useState<ItemState | undefined>();

  const agents = props.summary?.agents ?? [];
  const evidence = props.summary?.evidence ?? [];
  const sources = useMemo(() => flattenSources(agents), [agents]);
  const activeSourceKind = sourceKindForTab(props.activeTab);
  const visibleSources = useMemo(
    () =>
      activeSourceKind === undefined
        ? []
        : sources.filter((source) => source.source.kind === activeSourceKind),
    [activeSourceKind, sources],
  );
  const selectedSource =
    visibleSources.find((source) => source.key === selectedKey) ?? visibleSources[0];

  useEffect(() => {
    if (visibleSources.length === 0) {
      setSelectedKey("");
      return;
    }
    if (visibleSources.some((source) => source.key === selectedKey)) {
      return;
    }
    const next =
      visibleSources.find(
        (source) => source.source.inspectable === true && (source.source.itemCount ?? 0) > 0,
      ) ??
      visibleSources.find((source) => source.source.inspectable === true) ??
      visibleSources[0];
    setSelectedKey(next?.key ?? "");
  }, [selectedKey, visibleSources]);

  const loadItems = useCallback(
    async (source: KnowledgeSourceRef, options: { append: boolean; cursor?: string }) => {
      setItemState((current) => ({
        key: source.key,
        loading: true,
        inspectable:
          current?.key === source.key ? current.inspectable : source.source.inspectable === true,
        items: options.append && current?.key === source.key ? current.items : [],
        ...(options.append && current?.key === source.key && current.nextCursor !== undefined
          ? { nextCursor: current.nextCursor }
          : {}),
        ...(current?.key === source.key && current.totalCount !== undefined
          ? { totalCount: current.totalCount }
          : {}),
      }));

      try {
        const params = new URLSearchParams({
          agentId: source.agentId,
          sourceId: sourceId(source.source),
          limit: String(itemLimit),
        });
        if (options.cursor !== undefined) {
          params.set("cursor", options.cursor);
        }
        const response = await fetch(`/knowledge/items?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Knowledge items failed with HTTP ${response.status}`);
        }
        const page = (await response.json()) as StudioKnowledgeItemsPage;
        setItemState((current) => ({
          key: source.key,
          loading: false,
          inspectable: page.inspectable,
          items:
            options.append && current?.key === source.key
              ? [...current.items, ...page.items]
              : page.items,
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          ...(page.totalCount === undefined ? {} : { totalCount: page.totalCount }),
          ...(page.message === undefined ? {} : { message: page.message }),
        }));
      } catch (error) {
        setItemState((current) => ({
          key: source.key,
          loading: false,
          inspectable: current?.inspectable ?? false,
          items: current?.items ?? [],
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedSource === undefined) {
      setItemState(undefined);
      return;
    }
    void loadItems(selectedSource, { append: false });
  }, [loadItems, selectedSource]);

  if (!props.enabled) {
    return (
      <EmptyState
        title="Knowledge unavailable"
        text="No registered agent exposes inspectable context."
      />
    );
  }

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55">
      <header className="bg-background/70 pb-5 pl-0 pr-6 pt-0 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">
              Agent context
            </div>
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              Knowledge
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Browse configured context, dynamic chunks, and retrieval evidence.
            </p>
          </div>
          <Button
            className="h-8 min-h-8 gap-2"
            type="button"
            variant="secondary"
            onClick={props.onRefresh}
          >
            <ArrowClockwise aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden pb-6 pl-0 pr-6 pt-0">
        <KnowledgeTabs
          activeTab={props.activeTab}
          sources={sources}
          evidenceCount={evidence.length}
          onSelectTab={props.onSelectTab}
        />
        {props.activeTab === "retrieval-log" ? (
          <RetrievalLogPanel evidence={evidence} onOpenTrace={props.onOpenTrace} />
        ) : (
          <SourceWorkspace
            sources={visibleSources}
            selectedKey={selectedSource?.key ?? ""}
            loading={props.loading}
            activeTab={props.activeTab}
            onSelect={setSelectedKey}
          >
            <ItemBrowser
              source={selectedSource}
              state={itemState}
              onLoadMore={() => {
                if (selectedSource === undefined) {
                  return;
                }
                void loadItems(
                  selectedSource,
                  itemState?.nextCursor === undefined
                    ? { append: true }
                    : { append: true, cursor: itemState.nextCursor },
                );
              }}
            />
          </SourceWorkspace>
        )}
      </div>
    </section>
  );
}

function KnowledgeTabs(props: {
  activeTab: KnowledgeTab;
  sources: KnowledgeSourceRef[];
  evidenceCount: number;
  onSelectTab: (tab: KnowledgeTab) => void;
}) {
  return (
    <nav
      className="flex min-w-0 gap-7 overflow-x-auto border-b border-border/80"
      aria-label="Knowledge sections"
    >
      {knowledgeTabs.map((tab) => {
        const active = props.activeTab === tab.id;
        return (
          <button
            className={[
              "flex min-h-10 shrink-0 items-center gap-2 border-b px-0 pb-2 pt-1 text-left transition duration-200 hover:text-foreground focus-visible:outline-none",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border",
            ].join(" ")}
            key={tab.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => props.onSelectTab(tab.id)}
          >
            <span className="text-sm font-semibold">{tab.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {tabCountLabel(tab.id, props.sources, props.evidenceCount)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function SourceWorkspace(props: {
  sources: KnowledgeSourceRef[];
  selectedKey: string;
  loading: boolean;
  activeTab: KnowledgeTab;
  onSelect: (key: string) => void;
  children: ReactNode;
}) {
  const showSources = props.sources.length !== 1 || props.loading;
  return (
    <div
      className={[
        "grid min-h-0 gap-3 overflow-hidden",
        showSources ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]",
      ].join(" ")}
    >
      {showSources ? (
        <div className="min-w-0 overflow-x-auto rounded-xl border border-border/80 bg-card/55">
          <div className="flex min-h-11 min-w-max items-center gap-2 px-3">
            <span className="mr-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {tabLabel(props.activeTab)}
            </span>
            {props.loading && props.sources.length === 0 ? (
              <span className="font-mono text-[11px] text-muted-foreground">Loading sources</span>
            ) : null}
            {!props.loading && props.sources.length === 0 ? (
              <span className="font-mono text-[11px] text-muted-foreground">
                No knowledge sources
              </span>
            ) : null}
            {props.sources.map((source) => (
              <button
                className={[
                  "flex h-7 items-center gap-2 rounded-lg border border-border/80 bg-background/45 px-2.5 font-mono text-[11px] font-semibold text-muted-foreground transition duration-200 hover:border-primary/45 hover:bg-primary/10 hover:text-foreground focus-visible:border-ring focus-visible:outline-none",
                  props.selectedKey === source.key
                    ? "border-primary/45 bg-primary/10 text-primary"
                    : "",
                ].join(" ")}
                key={source.key}
                type="button"
                onClick={() => props.onSelect(source.key)}
              >
                <span>{source.source.label ?? sourceLabel(source.source.kind)}</span>
                {source.source.itemCount === undefined ? null : (
                  <span className="text-muted-foreground">{source.source.itemCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

function ItemBrowser(props: {
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
            <p className="m-0 mt-1 truncate font-mono text-xs text-muted-foreground">
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
              <KnowledgeItemCard item={item} key={`${item.kind}:${item.id}`} />
            ))}
          </div>
        </div>
      </div>
      <div className="flex min-h-12 items-center justify-between gap-3 bg-muted/10 px-4 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">
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

function KnowledgeItemCard(props: { item: StudioKnowledgeItem }) {
  return (
    <article className="grid gap-3 rounded-xl border border-border/80 bg-background/55 p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-semibold text-primary">
            {props.item.toolName ?? props.item.id}
          </div>
          <div className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
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

function RetrievalLogPanel(props: {
  evidence: NonNullable<StudioKnowledgeSummary["evidence"]>;
  onOpenTrace: (traceId: string) => void;
}) {
  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-border/80 bg-card/55">
      <div className="border-b border-border/80 px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-sm font-semibold text-foreground">Retrieval log</h2>
            <p className="m-0 mt-1 truncate font-mono text-xs text-muted-foreground">
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
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    Turn {item.turn}
                  </div>
                </div>
                <Button
                  className="h-auto min-h-0 rounded-lg border border-border bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground"
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
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
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
                  <span className="font-mono text-foreground">{document.id ?? "document"}</span>{" "}
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
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {props.title}
      </div>
      <JsonValueView value={props.value} />
    </div>
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
    <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground">
      {props.text}
    </div>
  );
}

function flattenSources(agents: StudioAgentKnowledgeConfig[]): KnowledgeSourceRef[] {
  return agents.flatMap((agent) =>
    agent.sources.map((source, index) => ({
      key: `${agent.agentId}:${sourceId(source, index)}`,
      agentId: agent.agentId,
      agentName: agent.agentName ?? agent.agentId,
      source: withSourceId(source, index),
    })),
  );
}

const knowledgeTabs: Array<{ id: KnowledgeTab; label: string }> = [
  { id: "static-context", label: "Static Context" },
  { id: "dynamic-context", label: "Dynamic Context" },
  { id: "dynamic-tools", label: "Dynamic Tools" },
  { id: "retrieval-log", label: "Retrieval Log" },
];

function withSourceId(
  source: StudioKnowledgeSourceSummary,
  index: number,
): StudioKnowledgeSourceSummary {
  return source.sourceId === undefined
    ? { ...source, sourceId: fallbackSourceId(source, index) }
    : source;
}

function sourceId(source: StudioKnowledgeSourceSummary, index = 0): string {
  return source.sourceId ?? fallbackSourceId(source, index);
}

function fallbackSourceId(source: StudioKnowledgeSourceSummary, index: number): string {
  switch (source.kind) {
    case "static_context":
      return "static-context";
    case "dynamic_context":
      return `dynamic-context-${source.registrationIndex ?? index}`;
    case "dynamic_tools":
      return `dynamic-tools-${source.registrationIndex ?? index}`;
  }
}

function sumKind(sources: StudioKnowledgeSourceSummary[], kind: StudioKnowledgeSourceKind): number {
  return sources
    .filter((source) => source.kind === kind)
    .reduce((total, source) => total + (source.itemCount ?? source.count), 0);
}

function sourceLabel(kind: StudioKnowledgeSourceKind): string {
  switch (kind) {
    case "static_context":
      return "Static context";
    case "dynamic_context":
      return "Dynamic context";
    case "dynamic_tools":
      return "Dynamic tools";
  }
}

function sourceKindForTab(tab: KnowledgeTab): StudioKnowledgeSourceKind | undefined {
  switch (tab) {
    case "static-context":
      return "static_context";
    case "dynamic-context":
      return "dynamic_context";
    case "dynamic-tools":
      return "dynamic_tools";
    case "retrieval-log":
      return undefined;
  }
}

function tabLabel(tab: KnowledgeTab): string {
  return knowledgeTabs.find((item) => item.id === tab)?.label ?? "Knowledge";
}

function tabCountLabel(
  tab: KnowledgeTab,
  sources: KnowledgeSourceRef[],
  evidenceCount: number,
): string {
  const sourceKind = sourceKindForTab(tab);
  if (sourceKind === undefined) {
    return `${evidenceCount} entries`;
  }
  const tabSources = sources.filter((source) => source.source.kind === sourceKind);
  const itemCount = sumKind(
    tabSources.map((source) => source.source),
    sourceKind,
  );
  return `${tabSources.length} sources / ${itemCount} items`;
}

function itemKindLabel(kind: StudioKnowledgeItem["kind"]): string {
  switch (kind) {
    case "static_context":
      return "Static context";
    case "dynamic_context":
      return "Dynamic context";
    case "dynamic_tool":
      return "Dynamic tool";
  }
}
