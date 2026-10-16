import { describe, expect, it } from "vitest";
import { filterToChromaWhere } from "../src/index.js";

describe("filterToChromaWhere", () => {
  it("maps comparison and membership operators to native Chroma operators", () => {
    expect(filterToChromaWhere({ type: "ne", key: "tenant", value: "a" })).toEqual({
      tenant: { $ne: "a" },
    });
    expect(filterToChromaWhere({ type: "gte", key: "priority", value: 2 })).toEqual({
      priority: { $gte: 2 },
    });
    expect(filterToChromaWhere({ type: "lte", key: "priority", value: 5 })).toEqual({
      priority: { $lte: 5 },
    });
    expect(filterToChromaWhere({ type: "in", key: "tenant", values: ["a", "b"] })).toEqual({
      tenant: { $in: ["a", "b"] },
    });
  });

  it("translates n-ary and/or filters and unwraps single-child lists", () => {
    expect(
      filterToChromaWhere({
        type: "or",
        filters: [
          { type: "eq", key: "a", value: 1 },
          { type: "eq", key: "b", value: 2 },
          { type: "eq", key: "c", value: 3 },
        ],
      }),
    ).toEqual({ $or: [{ a: { $eq: 1 } }, { b: { $eq: 2 } }, { c: { $eq: 3 } }] });
    expect(
      filterToChromaWhere({ type: "and", filters: [{ type: "eq", key: "a", value: 1 }] }),
    ).toEqual({ a: { $eq: 1 } });
  });

  it("rejects empty in filters", () => {
    expect(() => filterToChromaWhere({ type: "in", key: "tenant", values: [] })).toThrow(
      /Chroma "in" filter/,
    );
  });
});
