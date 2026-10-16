import type { VectorMetadataValue } from "@anvia/core/embeddings";
import type { VectorFilter } from "@anvia/core/vector-store";
import type { PgVectorWhere } from "./types.js";

type FilterState = { nextIndex: number; values: unknown[] };

const numericOperators = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;

export function filterToPgVectorWhere(
  filter: VectorFilter | undefined,
  startIndex = 1,
): PgVectorWhere | undefined {
  if (filter === undefined) {
    return undefined;
  }
  const state: FilterState = { nextIndex: startIndex, values: [] };
  const sql = buildFilterSql(filter, state);
  return { sql, values: state.values };
}

function buildFilterSql(filter: VectorFilter, state: FilterState): string {
  switch (filter.type) {
    case "eq":
      return equalitySql(filter.key, filter.value, state);
    case "ne": {
      if (filter.value === null) {
        return `NOT ${equalitySql(filter.key, filter.value, state)}`;
      }
      const keyIndex = bind(state, filter.key);
      const valueIndex = bind(state, serializeMetadataValue(filter.value));
      return `(metadata ->> $${keyIndex}) IS DISTINCT FROM $${valueIndex}`;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      assertNumericFilterValue(filter.value, filter.type);
      const keyIndex = bind(state, filter.key);
      const valueIndex = bind(state, filter.value);
      return `(metadata ->> $${keyIndex})::numeric ${numericOperators[filter.type]} $${valueIndex}`;
    }
    case "in": {
      if (filter.values.length === 0) {
        throw new Error(`PgVector in filter for ${filter.key} requires at least one value`);
      }
      const nonNull = filter.values.filter((value) => value !== null);
      const parts: string[] = [];
      if (nonNull.length > 0) {
        const keyIndex = bind(state, filter.key);
        const valueIndex = bind(state, nonNull.map(serializeMetadataValue));
        parts.push(`(metadata ->> $${keyIndex}) = ANY($${valueIndex}::text[])`);
      }
      if (nonNull.length < filter.values.length) {
        parts.push(equalitySql(filter.key, null, state));
      }
      return parts.length > 1 ? `(${parts.join(" OR ")})` : parts.join("");
    }
    case "and":
    case "or": {
      const parts = filter.filters.map((child) => buildFilterSql(child, state));
      return `(${parts.join(filter.type === "and" ? " AND " : " OR ")})`;
    }
    default: {
      const _exhaustive: never = filter;
      throw new Error(`Unknown filter type: ${(_exhaustive as VectorFilter).type}`);
    }
  }
}

function equalitySql(key: string, value: VectorMetadataValue, state: FilterState): string {
  const keyIndex = bind(state, key);
  if (value === null) {
    return `(metadata ? $${keyIndex} AND metadata -> $${keyIndex} = 'null'::jsonb)`;
  }
  const valueIndex = bind(state, serializeMetadataValue(value));
  return `(metadata ->> $${keyIndex}) = $${valueIndex}`;
}

function bind(state: FilterState, value: unknown): number {
  state.values.push(value);
  return state.nextIndex++;
}

function serializeMetadataValue(value: VectorMetadataValue): string | null {
  return value === null ? null : String(value);
}

function assertNumericFilterValue(
  value: VectorMetadataValue,
  operator: keyof typeof numericOperators,
): void {
  if (typeof value !== "number") {
    throw new Error(`PgVector ${operator} filters require numeric metadata values`);
  }
}
