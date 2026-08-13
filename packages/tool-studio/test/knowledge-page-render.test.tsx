import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ItemState,
  KnowledgeSourceRef,
} from "../src/ui/app/modules/knowledge/knowledge-model";
import { KnowledgePage } from "../src/ui/app/modules/knowledge/knowledge-page";
import { ItemBrowser } from "../src/ui/app/modules/knowledge/knowledge-panels";
import type { KnowledgeTab } from "../src/ui/app/modules/shared/types";

describe("KnowledgePage empty states", () => {
  it.each([
    ["static-context", "No static context"],
    ["dynamic-context", "No dynamic context"],
    ["dynamic-tools", "No dynamic tools"],
    ["retrieval-log", "No retrieval evidence"],
  ] satisfies Array<
    [KnowledgeTab, string]
  >)("replaces the inner %s panel with one empty state", (activeTab, emptyTitle) => {
    const html = renderToStaticMarkup(
      <KnowledgePage
        activeTab={activeTab}
        enabled
        loading={false}
        summary={{ agents: [], evidence: [] }}
        onOpenTrace={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain(emptyTitle);
    expect(html.match(/data-slot="studio-empty-state"/g)).toHaveLength(1);
    expect(html).toContain('data-size="default"');
    expect(emptyStateClasses(html)).toEqual(expect.arrayContaining(["h-full", "min-h-64"]));
    expect(html).not.toContain("No knowledge sources");
    expect(html).not.toContain("traces / retrieval-evidence");
    expect(html).not.toContain("min-h-11 min-w-max");
  });

  it.each([
    [false, false, "Static Context unavailable"],
    [true, true, "Loading static context"],
  ])("keeps unavailable and loading states free of the inner source header", (enabled, loading, title) => {
    const html = renderToStaticMarkup(
      <KnowledgePage
        activeTab="static-context"
        enabled={enabled}
        loading={loading}
        summary={{ agents: [], evidence: [] }}
        onOpenTrace={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain(title);
    expect(html.match(/data-slot="studio-empty-state"/g)).toHaveLength(1);
    expect(html).not.toContain("No knowledge sources");
    expect(html).not.toContain("min-h-11 min-w-max");
  });

  it("does not render items or errors from the previously selected source", () => {
    const source: KnowledgeSourceRef = {
      key: "support:dynamic-context-1",
      agentId: "support",
      agentName: "Support",
      source: {
        sourceId: "dynamic-context-1",
        kind: "dynamic_context",
        count: 0,
        inspectable: true,
      },
    };
    const staleState: ItemState = {
      key: "support:dynamic-context-0",
      loading: false,
      inspectable: true,
      items: [{ id: "stale", kind: "dynamic_context", text: "Stale content" }],
      error: "Stale error",
    };
    const html = renderToStaticMarkup(
      <ItemBrowser source={source} state={staleState} onLoadMore={vi.fn()} />,
    );

    expect(html).toContain("Loading items");
    expect(html).not.toContain("Stale content");
    expect(html).not.toContain("Stale error");
    expect(html).toContain("0 loaded");
  });
});

function emptyStateClasses(html: string): string[] {
  const match = html.match(/data-slot="studio-empty-state" class="([^"]+)"/);
  if (match?.[1] === undefined) {
    throw new Error("Studio empty state class list not found");
  }
  return match[1].split(" ");
}
