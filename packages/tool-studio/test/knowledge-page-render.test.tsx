import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KnowledgePage } from "../src/ui/app/modules/knowledge/knowledge-page";
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
    expect(html).not.toContain("No knowledge sources");
    expect(html).not.toContain("traces / retrieval-evidence");
    expect(html).not.toContain("min-h-11 min-w-max");
  });
});
