import { describe, expect, it } from "vitest";
import { quoteIdentifier } from "../src/helpers.js";

describe("Memgraph identifier quoting", () => {
  it("wraps identifiers in backticks and doubles embedded backticks", () => {
    expect(quoteIdentifier("Support Document")).toBe("`Support Document`");
    expect(quoteIdentifier("we`ird")).toBe("`we``ird`");
  });

  it("rejects an empty identifier", () => {
    expect(() => quoteIdentifier("")).toThrow(TypeError);
  });

  it("rejects a NUL byte, matching the Neo4j helper", () => {
    expect(() => quoteIdentifier("Support\u0000Document")).toThrow(TypeError);
  });
});
