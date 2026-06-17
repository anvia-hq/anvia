import type { VectorMetadataValue } from "@anvia/core/embeddings";
import type { VectorFilter } from "@anvia/core/vector-store";
import type { PgVectorWhere } from "./types.js";

export function filterToPgVectorWhere(
  filter: VectorFilter | undefined,
  startIndex = 1,
): PgVectorWhere | undefined {
  if (filter === undefined) {
    return undefined;
  }
  const state = { nextIndex: startIndex };
  const sql = buildFilterSql(filter, state);
  return { sql, values: stateValues(filter) };
}

function buildFilterSql(filter: VectorFilter, state: { nextIndex: number }): string {
  switch (filter.type) {
    case "eq": {
      const keyIndex = state.nextIndex++;
      const valueIndex = state.nextIndex++;
      return `(metadata ->> $${keyIndex}) = $${valueIndex}`;
    }
    case "gt": {
      assertNumericFilterValue(filter.value, filter.type);
      const keyIndex = state.nextIndex++;
      const valueIndex = state.nextIndex++;
      return `(metadata ->> $${keyIndex})::numeric > $${valueIndex}`;
    }
    case "lt": {
      assertNumericFilterValue(filter.value, filter.type);
      const keyIndex = state.nextIndex++;
      const valueIndex = state.nextIndex++;
      return `(metadata ->> $${keyIndex})::numeric < $${valueIndex}`;
    }
    case "and":
      return `(${buildFilterSql(filter.filters[0], state)} AND ${buildFilterSql(
        filter.filters[1],
        state,
      )})`;
    case "or":
      return `(${buildFilterSql(filter.filters[0], state)} OR ${buildFilterSql(
        filter.filters[1],
        state,
      )})`;
    default: {
      const _exhaustive: never = filter;
      throw new Error(`Unknown filter type: ${(_exhaustive as VectorFilter).type}`);
    }
  }
}

function stateValues(filter: VectorFilter): unknown[] {
  switch (filter.type) {
    case "eq":
      return [filter.key, serializeMetadataValue(filter.value)];
    case "gt":
    case "lt":
      assertNumericFilterValue(filter.value, filter.type);
      return [filter.key, filter.value];
    case "and":
    case "or":
      return [...stateValues(filter.filters[0]), ...stateValues(filter.filters[1])];
    default: {
      const _exhaustive: never = filter;
      throw new Error(`Unknown filter type: ${(_exhaustive as VectorFilter).type}`);
    }
  }
}

function serializeMetadataValue(value: VectorMetadataValue): string | null {
  return value === null ? null : String(value);
}

function assertNumericFilterValue(value: VectorMetadataValue, operator: "gt" | "lt"): void {
  if (typeof value !== "number") {
    throw new Error(`PgVector ${operator} filters require numeric metadata values`);
  }
}
