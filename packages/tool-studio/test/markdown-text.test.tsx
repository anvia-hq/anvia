import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "../src/ui/app/modules/shared/renderers";

describe("Studio MarkdownText", () => {
  it("uses the stream renderer and marks only live content for tail reveal", () => {
    const live = renderToStaticMarkup(
      <MarkdownText live size="base" text={"First paragraph.\n\nLive tail"} />,
    );
    const settled = renderToStaticMarkup(<MarkdownText text="Settled response" />);

    expect(live).toContain("data-anvia-stream-markdown");
    expect(live).toContain("data-anvia-stream-reveal");
    expect(live).toContain("First paragraph.");
    expect(live.replace(/<[^>]+>/g, "")).toContain("Live tail");
    expect(settled).toContain("data-anvia-stream-markdown");
    expect(settled).not.toContain("data-anvia-stream-reveal");
  });
});
