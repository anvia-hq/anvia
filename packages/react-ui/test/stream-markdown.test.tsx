import { fireEvent, render } from "@testing-library/react";
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

  it("keeps a GFM table intact as one rendered block", () => {
    const markdown = "| Name | Status |\n| --- | --- |\n| Stream | Ready |\n";
    expect(splitStreamMarkdownBlocks(markdown)).toEqual([{ content: markdown, startOffset: 0 }]);

    const { container } = render(<StreamMarkdown content={markdown} live />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("tbody")?.textContent).toContain("StreamReady");
  });

  it("wraps only the live rendered tail and excludes preformatted code", () => {
    const { container } = render(
      <StreamMarkdown
        content={"```ts\nconst untouched = true;\n```\n\nVisible **formatted tail**"}
        live
      />,
    );

    const revealNodes = container.querySelectorAll('[data-state="revealing"]');
    expect(revealNodes.length).toBeGreaterThan(0);
    expect(container.querySelector('pre [data-state="revealing"]')).toBeNull();
    expect(container.querySelector('strong [data-state="revealing"]')).not.toBeNull();
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
    expect(container.querySelector('[data-state="revealing"]')).not.toBeNull();

    rerender(<StreamMarkdown content="Settled text" live={false} />);
    expect(container.querySelector('[data-state="revealing"]')).toBeNull();
  });

  it("applies reveal treatment to the initial live tail", () => {
    const { container } = render(
      <StreamMarkdown content="abcdefghijklmnopqrstuvwxyz0123456789" live />,
    );
    const reveals = revealElements(container);

    expect(reveals).toHaveLength(24);
    expect(
      reveals.every(
        (element) => Number(element.style.getPropertyValue("--anvia-stream-reveal-opacity")) <= 1,
      ),
    ).toBe(true);
    expect(reveals.every((element) => element.dataset.state === "revealing")).toBe(true);
  });

  it("does not reanimate settled text when content resumes", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const content = "abcdefghijklmnopqrstuvwxyz0123456789";
    const { container, rerender } = render(<StreamMarkdown content={content} live />);
    const settledNodes = new Set(revealElements(container));

    clock.mockReturnValue(1_200);
    rerender(<StreamMarkdown content={`${content}XYZ`} live />);
    clock.mockRestore();

    const reveals = revealElements(container);
    expect(reveals.map((element) => element.textContent).join("")).toBe("XYZ");
    expect(reveals.every((element) => !settledNodes.has(element))).toBe(true);
  });

  it("preserves active reveal progress and creates lifecycles only for a multi-grapheme suffix", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const content = "abcdefghijklmnopqrstuvwxyz0123456789";
    const { container, rerender } = render(<StreamMarkdown content={content} live />);
    clock.mockReturnValue(1_060);
    rerender(<StreamMarkdown content={`${content}XYZ`} live />);

    const nextNodes = revealElements(container);
    const retained = nextNodes.filter(
      (element) => element.style.getPropertyValue("--anvia-stream-reveal-duration") === "120ms",
    );
    const fresh = nextNodes.filter(
      (element) => element.style.getPropertyValue("--anvia-stream-reveal-duration") === "180ms",
    );
    const retainedDurations = retained.map((element) =>
      element.style.getPropertyValue("--anvia-stream-reveal-duration"),
    );
    const freshDurations = fresh.map((element) =>
      element.style.getPropertyValue("--anvia-stream-reveal-duration"),
    );
    clock.mockRestore();

    expect(retained.length).toBeGreaterThan(0);
    expect(retainedDurations.every((duration) => duration === "120ms")).toBe(true);
    expect(fresh.map((element) => element.textContent).join("")).toBe("XYZ");
    expect(freshDurations.every((duration) => duration === "180ms")).toBe(true);
  });

  it("does not reanimate the existing tail for a one-grapheme append", () => {
    const content = "abcdefghijklmnopqrstuvwxyz0123456789";
    const { container, rerender } = render(<StreamMarkdown content={content} live />);
    settleReveals(container);

    rerender(<StreamMarkdown content={`${content}Z`} live />);

    const reveals = revealElements(container);
    expect(reveals).toHaveLength(1);
    expect(reveals[0]?.textContent).toBe("Z");
  });

  it("keeps emoji and combining sequences in whole reveal graphemes", () => {
    const family = "👨‍👩‍👧‍👦";
    const combining = "e\u0301";
    const { container } = render(
      <StreamMarkdown content={`abcdefghijklmnopqrstuvwxyz${family}${combining}`} live />,
    );
    const revealedText = revealElements(container).map((element) => element.textContent);

    expect(revealedText).toContain(family);
    expect(revealedText).toContain(combining);
    expect(revealedText.slice(-2)).toEqual([family, combining]);
    expect(revealedText).not.toContain("👨");
    expect(revealedText).not.toContain("\u0301");
  });

  it("preserves links, formatting, and entities inside the revealed tail", () => {
    const { container } = render(
      <StreamMarkdown
        content="A sufficiently long prefix for [the guide](https://example.com/docs) and **Tom &amp; Jerry**"
        live
      />,
    );

    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/docs");
    expect(container.querySelector("a")?.textContent).toBe("the guide");
    expect(container.querySelector("strong")?.textContent).toBe("Tom & Jerry");
    expect(container.querySelector('strong [data-state="revealing"]')).not.toBeNull();
  });

  it("resets reveal lifecycle state for non-append replacement", () => {
    const initial = "abcdefghijklmnopqrstuvwxyz0123456789";
    const replacement = "ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210";
    const { container, rerender } = render(<StreamMarkdown content={initial} live />);
    settleReveals(container);

    rerender(<StreamMarkdown content={replacement} live />);

    const replacementReveals = revealElements(container);
    expect(replacementReveals).toHaveLength(24);
    expect(replacementReveals.map((element) => element.textContent).join("")).toBe(
      replacement.slice(-24),
    );
  });

  it("renders all content fully visible when live is false", () => {
    const { container } = render(
      <StreamMarkdown content="abcdefghijklmnopqrstuvwxyz0123456789" live={false} />,
    );

    expect(revealElements(container)).toHaveLength(0);
    expect(container.textContent).toBe("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("keeps completed content settled if the same stream becomes live again", () => {
    const content = "abcdefghijklmnopqrstuvwxyz0123456789";
    const { container, rerender } = render(<StreamMarkdown content={content} live />);

    rerender(<StreamMarkdown content={content} live={false} />);
    rerender(<StreamMarkdown content={`${content}Z`} live />);

    const reveals = revealElements(container);
    expect(reveals).toHaveLength(1);
    expect(reveals[0]?.textContent).toBe("Z");
  });
});

function revealElements(container: HTMLElement): HTMLSpanElement[] {
  return Array.from(container.querySelectorAll<HTMLSpanElement>('[data-state="revealing"]'));
}

function settleReveals(container: HTMLElement): void {
  for (const element of revealElements(container)) {
    fireEvent.animationEnd(element);
  }
}
