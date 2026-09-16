import { describe, expect, it } from "vitest";
import { finalResponseEntryIds } from "../src/ui/app/modules/playground/final-response";
import type { TranscriptEntry } from "../src/ui/app/modules/shared/types";

const entries: TranscriptEntry[] = [
  { entryId: 1, kind: "message", role: "user", text: "Search" },
  { entryId: 2, kind: "message", role: "assistant", text: "Searching" },
  { entryId: 3, kind: "tool", toolName: "search", args: "{}", result: "Found" },
  { entryId: 4, kind: "message", role: "assistant", text: "Answer" },
  { entryId: 5, kind: "message", role: "user", text: "Next" },
  { entryId: 6, kind: "message", role: "assistant", text: "Another answer" },
];

describe("final response selection", () => {
  it("selects only the final response of each completed exchange", () => {
    expect([...finalResponseEntryIds(entries, false)]).toEqual([4, 6]);
  });
  it("keeps earlier actions while hiding the current streaming exchange", () => {
    expect([...finalResponseEntryIds(entries, true)]).toEqual([4]);
  });
  it("does not promote commentary before an unfinished tool to a final response", () => {
    expect([...finalResponseEntryIds(entries.slice(0, 3), false)]).toEqual([]);
  });
  it("does not select a pending response", () => {
    expect([
      ...finalResponseEntryIds(
        [...entries, { entryId: 7, kind: "message", role: "assistant", text: "", tone: "pending" }],
        false,
      ),
    ]).toEqual([4]);
  });
});
