import { render } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { StreamMarkdown } from "../src/stream";
import { splitStreamMarkdownBlocks } from "../src/stream/markdown-blocks";

describe("StreamMarkdown", () => {
  it("splits top-level blocks without changing source content", () => {
    const markdown = "# Heading\n\nFirst paragraph.\n\n- one\n- two\n";
    const blocks = splitStreamMarkdownBlocks(markdown);

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.map((block) => block.content).join("")).toBe(markdown);
  });

  it("keeps reference definitions in one document", () => {
    const markdown = "Read [the guide][guide].\n\n[guide]: https://example.com\n";
    expect(splitStreamMarkdownBlocks(markdown)).toEqual([{ content: markdown, startOffset: 0 }]);
  });

  it("wraps only the live rendered tail and excludes preformatted code", () => {
    const { container } = render(
      <StreamMarkdown
        content={"```ts\nconst untouched = true;\n```\n\nVisible **formatted tail**"}
        live
      />,
    );

    const revealNodes = container.querySelectorAll("[data-anvia-stream-reveal]");
    expect(revealNodes.length).toBeGreaterThan(0);
    expect(container.querySelector("pre [data-anvia-stream-reveal]")).toBeNull();
    expect(container.querySelector("strong [data-anvia-stream-reveal]")).not.toBeNull();
  });

  it("does not wrap whitespace-only nodes between list items", () => {
    const { container } = render(<StreamMarkdown content={"- first\n- second\n- third"} live />);
    const list = container.querySelector("ul");

    expect(list?.children).toHaveLength(3);
    expect(
      Array.from(list?.childNodes ?? []).filter((node) => node.nodeName === "SPAN"),
    ).toHaveLength(0);
  });

  it("does not rerender completed blocks while the live block grows", () => {
    const paragraph = vi.fn(({ children }: ComponentPropsWithoutRef<"p">) => <p>{children}</p>);
    const components = { p: paragraph };
    const { rerender } = render(
      <StreamMarkdown components={components} content={"Stable paragraph.\n\nGrowing"} live />,
    );

    paragraph.mockClear();
    rerender(
      <StreamMarkdown
        components={components}
        content={"Stable paragraph.\n\nGrowing paragraph"}
        live
      />,
    );

    expect(paragraph).toHaveBeenCalledTimes(1);
  });

  it("renders without reveal wrappers after the live state settles", () => {
    const { container, rerender } = render(<StreamMarkdown content="Settled text" live />);
    expect(container.querySelector("[data-anvia-stream-reveal]")).not.toBeNull();

    rerender(<StreamMarkdown content="Settled text" live={false} />);
    expect(container.querySelector("[data-anvia-stream-reveal]")).toBeNull();
  });
});
