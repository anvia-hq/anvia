import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContextMeter } from "../src";

const usage = {
  model: { modelId: "gpt-5", context: { contextWindow: 400_000 } },
  usedTokens: 100_000,
  remainingTokens: 300_000,
  usedPercent: 25,
  remainingPercent: 75,
};

afterEach(() => {
  cleanup();
});

describe("ContextMeter", () => {
  it("renders remaining context by default", () => {
    render(<ContextMeter usage={usage} />);

    const meter = screen.getByRole("progressbar", { name: "75% context left" });
    expect(meter.getAttribute("aria-valuenow")).toBe("75");
    expect(screen.getByText("75% context left")).toBeTruthy();
    expect(meter.querySelector<HTMLElement>("[data-anvia-context-meter-value]")?.style.width).toBe(
      "75%",
    );
  });

  it("supports used context and custom content", () => {
    const { rerender } = render(<ContextMeter display="used" usage={usage} />);
    expect(screen.getByRole("progressbar", { name: "25% context used" })).toBeTruthy();

    rerender(<ContextMeter usage={usage}>{(value) => `${value.usedTokens} tokens`}</ContextMeter>);
    expect(screen.getByText("100000 tokens")).toBeTruthy();
  });

  it("renders nothing when usage is unavailable", () => {
    const { container } = render(<ContextMeter />);
    expect(container.childElementCount).toBe(0);
  });
});
