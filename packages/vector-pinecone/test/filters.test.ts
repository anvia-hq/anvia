import { describe, expect, it } from "vitest";
import { filterToPineconeFilter } from "../src/index.js";

describe("filterToPineconeFilter", () => {
  it("maps comparison and membership operators to native Pinecone operators", () => {
    expect(filterToPineconeFilter({ type: "ne", key: "tenant", value: "a" })).toEqual({
      tenant: { $ne: "a" },
    });
    expect(filterToPineconeFilter({ type: "gte", key: "priority", value: 2 })).toEqual({
      priority: { $gte: 2 },
    });
    expect(filterToPineconeFilter({ type: "lte", key: "priority", value: 5 })).toEqual({
      priority: { $lte: 5 },
    });
    expect(filterToPineconeFilter({ type: "in", key: "tenant", values: ["a", "b"] })).toEqual({
      tenant: { $in: ["a", "b"] },
    });
  });

  it("translates n-ary and/or filters", () => {
    expect(
      filterToPineconeFilter({
        type: "and",
        filters: [
          { type: "eq", key: "a", value: 1 },
          { type: "gte", key: "b", value: 2 },
          { type: "lte", key: "b", value: 4 },
        ],
      }),
    ).toEqual({ $and: [{ a: { $eq: 1 } }, { b: { $gte: 2 } }, { b: { $lte: 4 } }] });
  });

  it("rejects empty in filters", () => {
    expect(() => filterToPineconeFilter({ type: "in", key: "tenant", values: [] })).toThrow(
      /Pinecone "in" filter/,
    );
  });
});
