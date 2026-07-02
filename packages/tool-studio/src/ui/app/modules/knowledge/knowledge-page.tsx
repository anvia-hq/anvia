import { RefreshIcon } from "@hugeicons/core-free-icons";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { StudioKnowledgeItemsPage, StudioKnowledgeSummary } from "../../../../types";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import type { KnowledgeTab } from "../shared/types";
import {
  flattenSources,
  type ItemState,
  itemLimit,
  type KnowledgeSourceRef,
  sourceId,
  sourceKindForTab,
  sourceLabel,
  tabLabel,
} from "./knowledge-model";
import { ItemBrowser, RetrievalLogPanel } from "./knowledge-panels";

export function KnowledgePage(props: {
  activeTab: KnowledgeTab;
  enabled: boolean;
  summary: StudioKnowledgeSummary | undefined;
  loading: boolean;
  onOpenTrace: (traceId: string) => void;
  onRefresh: () => void;
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
      const sourceKey = source.key;
      setItemState((current) => ({
        key: sourceKey,
        loading: true,
        inspectable:
          current?.key === sourceKey ? current.inspectable : source.source.inspectable === true,
        items: options.append && current?.key === sourceKey ? current.items : [],
        ...(options.append && current?.key === sourceKey && current.nextCursor !== undefined
          ? { nextCursor: current.nextCursor }
          : {}),
        ...(current?.key === sourceKey && current.totalCount !== undefined
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
        setItemState((current) => {
          if (current?.key !== sourceKey) {
            return current;
          }
          return {
            key: sourceKey,
            loading: false,
            inspectable: page.inspectable,
            items: options.append ? [...current.items, ...page.items] : page.items,
            ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
            ...(page.totalCount === undefined ? {} : { totalCount: page.totalCount }),
            ...(page.message === undefined ? {} : { message: page.message }),
          };
        });
      } catch (error) {
        setItemState((current) => {
          if (current?.key !== sourceKey) {
            return current;
          }
          return {
            key: sourceKey,
            loading: false,
            inspectable: current.inspectable,
            items: current.items,
            error: error instanceof Error ? error.message : String(error),
          };
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!props.enabled || selectedSource === undefined) {
      setItemState(undefined);
      return;
    }
    void loadItems(selectedSource, { append: false });
  }, [loadItems, props.enabled, selectedSource]);

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/55">
      <header className="bg-background/70 pb-3 pl-4 pr-6 pt-4 backdrop-blur">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
          <div className="grid min-w-0 gap-2">
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-tight text-foreground">
              {tabLabel(props.activeTab)}
            </h1>
            <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              {knowledgePageDescription(props.activeTab)}
            </p>
          </div>
          <Button
            className="h-8 min-h-8 gap-2"
            type="button"
            variant="secondary"
            disabled={!props.enabled}
            onClick={props.onRefresh}
          >
            <StudioIcon icon={RefreshIcon} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden pb-6 pl-4 pr-6 pt-0">
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
        <div className="min-w-0 overflow-x-auto border-b border-border/80">
          <div className="flex min-h-11 min-w-max items-center gap-2">
            <span className="mr-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {tabLabel(props.activeTab)}
            </span>
            {props.loading && props.sources.length === 0 ? (
              <span className=" text-xs text-muted-foreground">Loading sources</span>
            ) : null}
            {!props.loading && props.sources.length === 0 ? (
              <span className=" text-xs text-muted-foreground">No knowledge sources</span>
            ) : null}
            {props.sources.map((source) => (
              <button
                className={[
                  "flex h-7 items-center gap-2 rounded-lg border border-border/80 bg-background/45 px-2.5 text-xs font-semibold text-muted-foreground transition duration-200 hover:border-border/80 hover:bg-muted/45 hover:text-foreground focus-visible:border-ring focus-visible:outline-none",
                  props.selectedKey === source.key
                    ? "border-border/80 bg-muted/45 text-foreground"
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

function knowledgePageDescription(tab: KnowledgeTab): string {
  switch (tab) {
    case "static-context":
      return "Browse configured static context exposed to agents.";
    case "dynamic-context":
      return "Inspect dynamic context chunks resolved at runtime.";
    case "dynamic-tools":
      return "Review dynamic tool definitions and parameters.";
    case "retrieval-log":
      return "Inspect retrieval evidence and jump into related traces.";
  }
}
