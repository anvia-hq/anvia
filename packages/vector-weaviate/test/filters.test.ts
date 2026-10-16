import { describe, expect, it, vi } from "vitest";
import { filterToWeaviateWhere } from "../src/index.js";

vi.mock("weaviate-client", () => ({ default: { connectToCustom: vi.fn() } }));

describe("filterToWeaviateWhere", () => {
  it("maps comparison operators to native Weaviate operators", () => {
    expect(filterToWeaviateWhere({ type: "ne", key: "tenant", value: "a" })).toEqual({
      operator: "NotEqual",
      target: { property: "tenant" },
      value: "a",
    });
    expect(filterToWeaviateWhere({ type: "gte", key: "priority", value: 2 })).toEqual({
      operator: "GreaterThanEqual",
      target: { property: "priority" },
      value: 2,
    });
    expect(filterToWeaviateWhere({ type: "lte", key: "priority", value: 5 })).toEqual({
      operator: "LessThanEqual",
      target: { property: "priority" },
      value: 5,
    });
  });

  it("maps in to ContainsAny", () => {
    expect(filterToWeaviateWhere({ type: "in", key: "tenant", values: ["a", "b"] })).toEqual({
      operator: "ContainsAny",
      target: { property: "tenant" },
      value: ["a", "b"],
    });
  });

  it("translates n-ary and/or filters", () => {
    expect(
      filterToWeaviateWhere({
        type: "and",
        filters: [
          { type: "eq", key: "a", value: 1 },
          { type: "eq", key: "b", value: 2 },
          { type: "eq", key: "c", value: 3 },
        ],
      }),
    ).toMatchObject({ operator: "And", filters: [{ value: 1 }, { value: 2 }, { value: 3 }] });
  });

  it("rejects in filters Weaviate cannot express", () => {
    expect(() => filterToWeaviateWhere({ type: "in", key: "tenant", values: [] })).toThrow(
      /Weaviate "in" filter/,
    );
    expect(() => filterToWeaviateWhere({ type: "in", key: "tenant", values: ["a", null] })).toThrow(
      /Weaviate does not support null values in "in" filters/,
    );
  });
});
