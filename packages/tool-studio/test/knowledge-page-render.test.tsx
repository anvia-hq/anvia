import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ItemState,
  KnowledgeSourceRef,
} from "../src/ui/app/modules/knowledge/knowledge-model";
import { ItemBrowser } from "../src/ui/app/modules/knowledge/knowledge-panels";

describe("KnowledgePage item browser", () => {
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

    expect(html).not.toContain("Stale content");
    expect(html).not.toContain("Stale error");
  });
});
