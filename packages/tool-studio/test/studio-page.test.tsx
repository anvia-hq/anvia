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
    expect(html).toContain("h-full min-h-64");
  });
});
