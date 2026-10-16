import { describe, expect, it } from "vitest";
import { filterToQdrantFilter } from "../src/index.js";

describe("filterToQdrantFilter", () => {
  it("maps ne to must_not and in to match any", () => {
    expect(filterToQdrantFilter({ type: "ne", key: "tenant", value: "a" })).toEqual({
      must_not: [{ key: "tenant", match: { value: "a" } }],
    });
    expect(filterToQdrantFilter({ type: "in", key: "tenant", values: ["a", "b"] })).toEqual({
      must: [{ key: "tenant", match: { any: ["a", "b"] } }],
    });
  });

  it("maps inclusive ranges", () => {
    expect(filterToQdrantFilter({ type: "gte", key: "priority", value: 2 })).toEqual({
      must: [{ key: "priority", range: { gte: 2 } }],
    });
    expect(filterToQdrantFilter({ type: "lte", key: "priority", value: 5 })).toEqual({
      must: [{ key: "priority", range: { lte: 5 } }],
    });
  });

  it("translates n-ary and/or filters", () => {
    expect(
      filterToQdrantFilter({
        type: "or",
        filters: [
          { type: "eq", key: "a", value: 1 },
          { type: "eq", key: "b", value: 2 },
          { type: "ne", key: "c", value: 3 },
        ],
      }),
    ).toEqual({
      should: [
        { must: [{ key: "a", match: { value: 1 } }] },
        { must: [{ key: "b", match: { value: 2 } }] },
        { must_not: [{ key: "c", match: { value: 3 } }] },
      ],
    });
  });

  it("rejects empty in filters", () => {
    expect(() => filterToQdrantFilter({ type: "in", key: "tenant", values: [] })).toThrow(
      /Qdrant "in" filter/,
    );
  });

  it("accepts all-integer in filters", () => {
    expect(filterToQdrantFilter({ type: "in", key: "priority", values: [1, 2] })).toEqual({
      must: [{ key: "priority", match: { any: [1, 2] } }],
    });
  });

  it.each([
    ["booleans", [true, false]],
    ["floats", [1.5, 2]],
    ["null", [null]],
    ["mixed strings and integers", ["a", 1]],
  ])("rejects in filters with %s", (_label, values) => {
    expect(() => filterToQdrantFilter({ type: "in", key: "tenant", values })).toThrow(
      /Qdrant "in" filters only support all-string or all-integer values \(field tenant\)/,
    );
  });
});
