import { describe, expect, it } from "vitest";
import { filterToRedisQuery } from "../src/index.js";

const metadataSchema = { tenant: "tag", priority: "numeric" } as const;

describe("filterToRedisQuery", () => {
  it("maps ne to negated tag and numeric matches", () => {
    expect(
      filterToRedisQuery({ filter: { type: "ne", key: "tenant", value: "a" }, metadataSchema }),
    ).toBe("(-(@tenant:{s\\:a}))");
    expect(
      filterToRedisQuery({ filter: { type: "ne", key: "priority", value: 3 }, metadataSchema }),
    ).toBe("(-(@priority:[3 3]))");
  });

  it("maps in to tag unions and numeric alternatives", () => {
    expect(
      filterToRedisQuery({
        filter: { type: "in", key: "tenant", values: ["a", "b"] },
        metadataSchema,
      }),
    ).toBe("(@tenant:{s\\:a | s\\:b})");
    expect(
      filterToRedisQuery({
        filter: { type: "in", key: "priority", values: [1, 2] },
        metadataSchema,
      }),
    ).toBe("((@priority:[1 1]) | (@priority:[2 2]))");
  });

  it("maps inclusive numeric ranges", () => {
    expect(
      filterToRedisQuery({ filter: { type: "gte", key: "priority", value: 2 }, metadataSchema }),
    ).toBe("(@priority:[2 +inf])");
    expect(
      filterToRedisQuery({ filter: { type: "lte", key: "priority", value: 5 }, metadataSchema }),
    ).toBe("(@priority:[-inf 5])");
  });

  it("translates n-ary and/or filters", () => {
    expect(
      filterToRedisQuery({
        filter: {
          type: "and",
          filters: [
            { type: "eq", key: "tenant", value: "a" },
            { type: "gte", key: "priority", value: 1 },
            { type: "lte", key: "priority", value: 3 },
          ],
        },
        metadataSchema,
      }),
    ).toBe("((@tenant:{s\\:a}) (@priority:[1 +inf]) (@priority:[-inf 3]))");
  });

  it("rejects filters Redis cannot express", () => {
    expect(() =>
      filterToRedisQuery({ filter: { type: "gte", key: "tenant", value: "a" }, metadataSchema }),
    ).toThrow(/must be declared as numeric metadata/);
    expect(() =>
      filterToRedisQuery({ filter: { type: "in", key: "tenant", values: [] }, metadataSchema }),
    ).toThrow(/Redis "in" filter/);
  });
});
