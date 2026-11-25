import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContextMeterPrimitive as ContextMeter } from "../src";

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

    const meter = screen.getByRole("progressbar");
    expect(meter.getAttribute("aria-valuenow")).toBe("75");
  });

  it("supports used context and custom content", () => {
    const { rerender } = render(<ContextMeter display="used" usage={usage} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");

    rerender(<ContextMeter usage={usage}>{(value) => `${value.usedTokens} tokens`}</ContextMeter>);
    expect(screen.getByText("100000 tokens")).toBeTruthy();

    const breakdown = {
      segments: [
        { id: "instructions" as const, tokens: 20_000, characters: 80_000, items: 1 },
        { id: "skills" as const, tokens: 30_000, characters: 120_000, items: 3 },
        { id: "mcpTools" as const, tokens: 50_000, characters: 200_000, items: 8 },
      ],
      estimatedTokens: 100_000,
      reportedInputTokens: 100_000,
    };
    rerender(
      <ContextMeter usage={usage} breakdown={breakdown}>
        {(value, split) => `${value.remainingTokens} free / ${split?.segments.length ?? 0} buckets`}
      </ContextMeter>,
    );
    expect(screen.getByText("300000 free / 3 buckets")).toBeTruthy();
  });

  it("renders nothing when usage is unavailable", () => {
    const { container } = render(<ContextMeter />);
    expect(container.childElementCount).toBe(0);
  });
});
