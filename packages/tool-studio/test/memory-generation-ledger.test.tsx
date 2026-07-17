import { AssistantContent, Message } from "@anvia/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudioMemoryMessageRecord } from "../src/types";
import {
  MemoryGenerationLedger,
  memoryGenerationRows,
} from "../src/ui/app/modules/memory/memory-generation-ledger";

const usage = {
  inputTokens: 12,
  outputTokens: 4,
  totalTokens: 16,
  cachedInputTokens: 3,
  cacheCreationInputTokens: 1,
};

describe("MemoryGenerationLedger", () => {
  it("derives per-response generation details and preserves legacy assistant rows", () => {
    const records: StudioMemoryMessageRecord[] = [
      record(0, Message.user("hello")),
      record(
        1,
        Message.assistant("Stored answer", {
          metadata: {
            anvia: {
              generation: {
                provider: "openai",
                model: "gpt-test",
                usage,
              },
            },
          },
        }),
      ),
      record(2, Message.assistant([AssistantContent.toolCall("call_1", "lookup", {})])),
    ];

    expect(memoryGenerationRows(records)).toEqual([
      {
        position: 1,
        runId: "run_1",
        turn: 2,
        createdAt: "2026-07-18T00:00:00.000Z",
        preview: "Stored answer",
        generation: { provider: "openai", model: "gpt-test", usage },
      },
      {
        position: 2,
        runId: "run_2",
        turn: 3,
        createdAt: "2026-07-18T00:00:00.000Z",
        preview: "Tool call: lookup",
        generation: undefined,
      },
    ]);
  });

  it("renders model and token metrics while keeping missing telemetry explicit", () => {
    const records: StudioMemoryMessageRecord[] = [
      record(
        0,
        Message.assistant("Stored answer", {
          metadata: {
            anvia: {
              generation: {
                provider: "openai",
                model: "gpt-test",
                usage,
              },
            },
          },
        }),
      ),
      record(1, Message.assistant("Legacy answer")),
    ];

    const html = renderToStaticMarkup(<MemoryGenerationLedger records={records} />);

    expect(html).toContain("Assistant responses");
    expect(html).toContain("openai");
    expect(html).toContain("gpt-test");
    expect(html).toContain("total 16 tokens");
    expect(html).toContain("cached 3");
    expect(html).toContain("Usage unavailable");
    expect(html).toContain("Legacy answer");
  });
});

function record(
  position: number,
  message: StudioMemoryMessageRecord["message"],
): StudioMemoryMessageRecord {
  return {
    position,
    runId: `run_${position}`,
    turn: position + 1,
    createdAt: "2026-07-18T00:00:00.000Z",
    message,
  };
}
