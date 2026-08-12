import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  StudioEmptyState,
  StudioHeaderMetric,
  StudioPageContent,
  StudioPageHeader,
  StudioPageShell,
} from "../src/ui/app/components/ui/studio";

describe("Studio page primitives", () => {
  it("renders the shared Lens page structure", () => {
    const html = renderToStaticMarkup(
      <StudioPageShell className="grid-rows-[auto_minmax(0,1fr)]">
        <StudioPageHeader
          title="Tools"
          description="Registered tools."
          action={<StudioHeaderMetric label="tools" value={3} />}
        />
        <StudioPageContent>
          <StudioEmptyState title="No tools" text="No tools are registered." />
        </StudioPageContent>
      </StudioPageShell>,
    );

    expect(html).toContain("sm:flex-row sm:items-end sm:justify-between");
    expect(html).toContain("md:px-6 md:pt-6");
    expect(html).toContain("font-heading text-2xl font-medium tracking-tight");
    expect(html).toContain("Registered tools.");
    expect(html).toContain("No tools are registered.");
    expect(html).toContain('data-slot="studio-empty-state"');
    expect(html).toContain('data-size="default"');
    expect(emptyStateClasses(html)).toEqual(expect.arrayContaining(["h-full", "min-h-64"]));
  });

  it("keeps compact panel states local instead of forcing full-height layout", () => {
    const html = renderToStaticMarkup(
      <StudioEmptyState size="compact" title="No logs" text="Run the pipeline first." />,
    );

    expect(html).toContain('data-size="compact"');
    expect(emptyStateClasses(html)).toContain("min-h-32");
    expect(emptyStateClasses(html)).not.toContain("h-full");
  });
});

function emptyStateClasses(html: string): string[] {
  const match = html.match(/data-slot="studio-empty-state" class="([^"]+)"/);
  if (match?.[1] === undefined) {
    throw new Error("Studio empty state class list not found");
  }
  return match[1].split(" ");
}
