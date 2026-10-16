import { describe, expect, expectTypeOf, it } from "vitest";
import {
  InMemoryVectorStore,
  matchesVectorFilter,
  type VectorFilter,
  vectorFilter,
} from "../src/vector-store";

const metadata = { tenant: "a", priority: 3, archived: false, deletedAt: null };

describe("vector filters", () => {
  it("keeps legacy two-element boolean filters valid", () => {
    const legacy: VectorFilter = {
      type: "and",
      filters: [
        { type: "eq", key: "tenant", value: "a" },
        { type: "gt", key: "priority", value: 2 },
      ],
    };
    expect(matchesVectorFilter(metadata, legacy)).toBe(true);
    expect(
      vectorFilter.and(vectorFilter.eq("tenant", "a"), vectorFilter.lt("priority", 3)),
    ).toEqual({
      type: "and",
      filters: [
        { type: "eq", key: "tenant", value: "a" },
        { type: "lt", key: "priority", value: 3 },
      ],
    });
    expect(
      matchesVectorFilter(
        metadata,
        vectorFilter.or(vectorFilter.lt("priority", 1), vectorFilter.eq("tenant", "a")),
      ),
    ).toBe(true);
  });

  it("rejects empty boolean filter lists at the type level", () => {
    // @ts-expect-error and/or require at least one child filter
    const empty: VectorFilter = { type: "and", filters: [] };
    expect(empty.type).toBe("and");
    expectTypeOf(vectorFilter.and).parameters.toEqualTypeOf<[VectorFilter, ...VectorFilter[]]>();
  });

  it("matches ne including missing keys", () => {
    expect(matchesVectorFilter(metadata, vectorFilter.ne("tenant", "b"))).toBe(true);
    expect(matchesVectorFilter(metadata, vectorFilter.ne("tenant", "a"))).toBe(false);
    expect(matchesVectorFilter(metadata, vectorFilter.ne("deletedAt", null))).toBe(false);
    expect(matchesVectorFilter(metadata, vectorFilter.ne("missing", "x"))).toBe(true);
  });

  it("matches in against listed values", () => {
    expect(matchesVectorFilter(metadata, vectorFilter.in("tenant", ["b", "a"]))).toBe(true);
    expect(matchesVectorFilter(metadata, vectorFilter.in("tenant", ["b"]))).toBe(false);
    expect(matchesVectorFilter(metadata, vectorFilter.in("deletedAt", [null]))).toBe(true);
    expect(matchesVectorFilter(metadata, vectorFilter.in("missing", [null]))).toBe(false);
    expect(matchesVectorFilter(metadata, vectorFilter.in("tenant", []))).toBe(false);
  });

  it("matches inclusive ranges only for comparable values", () => {
    expect(matchesVectorFilter(metadata, vectorFilter.gte("priority", 3))).toBe(true);
    expect(matchesVectorFilter(metadata, vectorFilter.gte("priority", 4))).toBe(false);
    expect(matchesVectorFilter(metadata, vectorFilter.lte("priority", 3))).toBe(true);
    expect(matchesVectorFilter(metadata, vectorFilter.lte("priority", 2))).toBe(false);
    expect(matchesVectorFilter(metadata, vectorFilter.gte("tenant", "a"))).toBe(true);
    expect(matchesVectorFilter(metadata, vectorFilter.gte("priority", "3"))).toBe(false);
    expect(matchesVectorFilter(metadata, vectorFilter.lte("missing", 3))).toBe(false);
    expect(matchesVectorFilter(metadata, vectorFilter.gt("priority", "3"))).toBe(false);
  });

  it("evaluates n-ary and/or filters", () => {
    const and = vectorFilter.and(
      vectorFilter.eq("tenant", "a"),
      vectorFilter.gte("priority", 1),
      vectorFilter.eq("archived", false),
    );
    expect(matchesVectorFilter(metadata, and)).toBe(true);
    expect(
      matchesVectorFilter(
        metadata,
        vectorFilter.and(
          vectorFilter.eq("tenant", "a"),
          vectorFilter.gte("priority", 1),
          vectorFilter.eq("archived", true),
        ),
      ),
    ).toBe(false);
    expect(
      matchesVectorFilter(
        metadata,
        vectorFilter.or(
          vectorFilter.eq("tenant", "x"),
          vectorFilter.eq("tenant", "y"),
          vectorFilter.in("priority", [3]),
        ),
      ),
    ).toBe(true);
    expect(matchesVectorFilter(metadata, vectorFilter.and(vectorFilter.eq("tenant", "a")))).toBe(
      true,
    );
    expect(matchesVectorFilter(metadata, vectorFilter.or(vectorFilter.eq("tenant", "b")))).toBe(
      false,
    );
  });

  it("applies rich filters in the in-memory store", async () => {
    const store = InMemoryVectorStore.fromDocuments<string>({
      documents: [1, 2, 3, 4].map((priority) => ({
        id: `doc-${priority}`,
        document: `doc ${priority}`,
        metadata: { priority, tenant: priority % 2 === 0 ? "even" : "odd" },
        embeddings: [{ document: `doc ${priority}`, vector: [1, 0] }],
      })),
    });
    const results = await store.search({
      vector: [1, 0],
      topK: 10,
      filter: vectorFilter.and(
        vectorFilter.gte("priority", 2),
        vectorFilter.lte("priority", 4),
        vectorFilter.ne("tenant", "odd"),
      ),
    });
    expect(results.map((result) => result.id).sort()).toEqual(["doc-2", "doc-4"]);
  });
});
