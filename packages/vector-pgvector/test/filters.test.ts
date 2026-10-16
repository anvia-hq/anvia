import { describe, expect, it } from "vitest";
import { filterToPgVectorWhere } from "../src/index.js";

describe("filterToPgVectorWhere", () => {
  it("maps ne with SQL null-safe comparison", () => {
    expect(filterToPgVectorWhere({ type: "ne", key: "tenant", value: "a" }, 2)).toEqual({
      sql: "(metadata ->> $2) IS DISTINCT FROM $3",
      values: ["tenant", "a"],
    });
    expect(filterToPgVectorWhere({ type: "ne", key: "archivedAt", value: null })).toEqual({
      sql: "NOT (metadata ? $1 AND metadata -> $1 = 'null'::jsonb)",
      values: ["archivedAt"],
    });
  });

  it("maps in to ANY with serialized text values and JSON null handling", () => {
    expect(filterToPgVectorWhere({ type: "in", key: "priority", values: [1, 2] }, 2)).toEqual({
      sql: "(metadata ->> $2) = ANY($3::text[])",
      values: ["priority", ["1", "2"]],
    });
    expect(filterToPgVectorWhere({ type: "in", key: "tenant", values: ["a", null] })).toEqual({
      sql: "((metadata ->> $1) = ANY($2::text[]) OR (metadata ? $3 AND metadata -> $3 = 'null'::jsonb))",
      values: ["tenant", ["a"], "tenant"],
    });
  });

  it("maps inclusive numeric ranges", () => {
    expect(filterToPgVectorWhere({ type: "gte", key: "priority", value: 2 })).toEqual({
      sql: "(metadata ->> $1)::numeric >= $2",
      values: ["priority", 2],
    });
    expect(filterToPgVectorWhere({ type: "lte", key: "priority", value: 5 })).toEqual({
      sql: "(metadata ->> $1)::numeric <= $2",
      values: ["priority", 5],
    });
  });

  it("translates n-ary and/or filters with sequential placeholders", () => {
    expect(
      filterToPgVectorWhere(
        {
          type: "or",
          filters: [
            { type: "eq", key: "a", value: "x" },
            { type: "gte", key: "b", value: 2 },
            { type: "and", filters: [{ type: "ne", key: "c", value: true }] },
          ],
        },
        2,
      ),
    ).toEqual({
      sql: "((metadata ->> $2) = $3 OR (metadata ->> $4)::numeric >= $5 OR ((metadata ->> $6) IS DISTINCT FROM $7))",
      values: ["a", "x", "b", 2, "c", "true"],
    });
  });

  it("keeps legacy binary filter output stable", () => {
    expect(
      filterToPgVectorWhere({
        type: "and",
        filters: [
          { type: "eq", key: "a", value: "x" },
          { type: "lt", key: "b", value: 3 },
        ],
      }),
    ).toEqual({
      sql: "((metadata ->> $1) = $2 AND (metadata ->> $3)::numeric < $4)",
      values: ["a", "x", "b", 3],
    });
  });

  it("rejects filters PgVector cannot express", () => {
    expect(() => filterToPgVectorWhere({ type: "gte", key: "tenant", value: "a" })).toThrow(
      /PgVector gte filters require numeric metadata values/,
    );
    expect(() => filterToPgVectorWhere({ type: "in", key: "tenant", values: [] })).toThrow(
      /PgVector in filter/,
    );
  });
});
