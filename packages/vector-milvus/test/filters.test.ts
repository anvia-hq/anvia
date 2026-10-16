import { describe, expect, it } from "vitest";
import { filterToMilvusExpr } from "../src/index.js";

describe("filterToMilvusExpr", () => {
  it("maps comparison operators to native Milvus expressions", () => {
    expect(filterToMilvusExpr({ type: "ne", key: "tenant", value: "a" })).toBe('tenant != "a"');
    expect(filterToMilvusExpr({ type: "gte", key: "priority", value: 2 })).toBe("priority >= 2");
    expect(filterToMilvusExpr({ type: "lte", key: "priority", value: 5 })).toBe("priority <= 5");
  });

  it("maps in to a Milvus list expression with escaped literals", () => {
    expect(filterToMilvusExpr({ type: "in", key: "tenant", values: ["a", 'b"c'] })).toBe(
      'tenant in ["a", "b\\"c"]',
    );
    expect(filterToMilvusExpr({ type: "in", key: "priority", values: [1, 2] })).toBe(
      "priority in [1, 2]",
    );
  });

  it("translates n-ary and/or filters", () => {
    expect(
      filterToMilvusExpr({
        type: "or",
        filters: [
          { type: "eq", key: "a", value: 1 },
          { type: "eq", key: "b", value: 2 },
          { type: "ne", key: "c", value: 3 },
        ],
      }),
    ).toBe("(a == 1) || (b == 2) || (c != 3)");
  });

  it("validates keys and rejects in filters Milvus cannot express", () => {
    expect(() => filterToMilvusExpr({ type: "in", key: "a or b", values: [1] })).toThrow(
      /Invalid metadata filter key/,
    );
    expect(() => filterToMilvusExpr({ type: "in", key: "tenant", values: [] })).toThrow(
      /Milvus "in" filter/,
    );
    expect(() => filterToMilvusExpr({ type: "in", key: "tenant", values: [null] })).toThrow(
      /Milvus does not support null values in "in" filters/,
    );
    expect(() => filterToMilvusExpr({ type: "gte", key: "n", value: Number.NaN })).toThrow(
      /Invalid metadata filter value/,
    );
  });
});
