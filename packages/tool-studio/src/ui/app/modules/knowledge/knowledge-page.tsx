import { ArrowClockwise } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { StudioKnowledgeItemsPage, StudioKnowledgeSummary } from "../../../../types";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import {
  StudioEmptyState,
  StudioPageContent,
  StudioPageHeader,
  StudioPageShell,
} from "../../components/ui/studio";
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
  const emptyState = knowledgeEmptyState({
    activeTab: props.activeTab,
    enabled: props.enabled,
    evidenceCount: evidence.length,
    loading: props.loading,
    sourceCount: visibleSources.length,
  });

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
      setItemState((current) => {
        const next: ItemState = {
          key: sourceKey,
          loading: true,
          inspectable:
            current?.key === sourceKey ? current.inspectable : source.source.inspectable === true,
          items: options.append && current?.key === sourceKey ? current.items : [],
        };
        if (options.append && current?.key === sourceKey && current.nextCursor !== undefined) {
          next.nextCursor = current.nextCursor;
        }
        if (current?.key === sourceKey && current.totalCount !== undefined) {
          next.totalCount = current.totalCount;
        }
        return next;
      });

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
          const next: ItemState = {
            key: sourceKey,
            loading: false,
            inspectable: page.inspectable,
            items: options.append ? [...current.items, ...page.items] : page.items,
          };
          if (page.nextCursor !== undefined) next.nextCursor = page.nextCursor;
          if (page.totalCount !== undefined) next.totalCount = page.totalCount;
          if (page.message !== undefined) next.message = page.message;
          return next;
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
    <StudioPageShell
      className="grid-rows-[auto_minmax(0,1fr)]"
      aria-label={tabLabel(props.activeTab)}
    >
      <StudioPageHeader
        title={tabLabel(props.activeTab)}
        description={knowledgePageDescription(props.activeTab)}
        action={
          <Button
            className="h-8 min-h-8 gap-2"
            type="button"
            variant="secondary"
            disabled={!props.enabled}
            onClick={props.onRefresh}
          >
            <StudioIcon icon={ArrowClockwise} aria-hidden="true" />
            Refresh
          </Button>
        }
      />
      <StudioPageContent className="grid grid-rows-[minmax(0,1fr)] overflow-hidden">
        {emptyState !== undefined ? (
          <StudioEmptyState className="h-full" title={emptyState.title} text={emptyState.text} />
        ) : props.activeTab === "retrieval-log" ? (
          <RetrievalLogPanel evidence={evidence} onOpenTrace={props.onOpenTrace} />
        ) : (
          <SourceWorkspace
            sources={visibleSources}
            selectedKey={selectedSource?.key ?? ""}
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
      </StudioPageContent>
    </StudioPageShell>
  );
}

function SourceWorkspace(props: {
  sources: KnowledgeSourceRef[];
  selectedKey: string;
  activeTab: KnowledgeTab;
  onSelect: (key: string) => void;
  children: ReactNode;
}) {
  const showSources = props.sources.length > 1;
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

function knowledgeEmptyState(props: {
  activeTab: KnowledgeTab;
  enabled: boolean;
  evidenceCount: number;
  loading: boolean;
  sourceCount: number;
}): { title: string; text: string } | undefined {
  const label = tabLabel(props.activeTab);
  if (!props.enabled) {
    return {
      title: `${label} unavailable`,
      text: "This Studio runtime does not expose knowledge inspection.",
    };
  }
  const itemCount = props.activeTab === "retrieval-log" ? props.evidenceCount : props.sourceCount;
  if (props.loading && itemCount === 0) {
    return { title: `Loading ${label.toLowerCase()}`, text: "Reading knowledge metadata." };
  }
  if (itemCount > 0) {
    return undefined;
  }
  switch (props.activeTab) {
    case "retrieval-log":
      return {
        title: "No retrieval evidence",
        text: "Retrieval activity will appear here after an agent queries a knowledge source.",
      };
    case "static-context":
      return {
        title: "No static context",
        text: "No static context sources are registered in this Studio runtime.",
      };
    case "dynamic-context":
      return {
        title: "No dynamic context",
        text: "No dynamic context sources are registered in this Studio runtime.",
      };
    case "dynamic-tools":
      return {
        title: "No dynamic tools",
        text: "No dynamic tool sources are registered in this Studio runtime.",
      };
  }
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
