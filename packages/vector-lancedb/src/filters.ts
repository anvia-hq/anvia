import type { VectorFilter } from "@anvia/core/vector-store";
import { metadataColumn } from "./types.js";

export function filterToLanceExpr(filter: VectorFilter | undefined): string | undefined {
  if (filter === undefined) {
    return undefined;
  }

  return translateFilter(filter);
}

function translateFilter(filter: VectorFilter): string {
  switch (filter.type) {
    case "eq": {
      if (filter.value === null) {
        const key = escapeSql(filter.key);
        return `json_contains(${metadataColumn}, '${key}') AND json_get_json(${metadataColumn}, '${key}') = 'null'`;
      }
      const value = metadataValue(filter.key, filter.value);
      if (typeof filter.value === "string") {
        return `${value} = '${escapeSql(filter.value)}'`;
      }
      if (typeof filter.value === "boolean") {
        return `${value} = ${filter.value ? "TRUE" : "FALSE"}`;
      }
      return `${value} = ${filter.value}`;
    }
    case "gt": {
      assertNumericValue(filter.value, filter.type);
      return `${metadataValue(filter.key, filter.value)} > ${filter.value}`;
    }
    case "lt": {
      assertNumericValue(filter.value, filter.type);
      return `${metadataValue(filter.key, filter.value)} < ${filter.value}`;
    }
    case "and":
      return filter.filters.map((f) => `(${translateFilter(f)})`).join(" AND ");
    case "or":
      return filter.filters.map((f) => `(${translateFilter(f)})`).join(" OR ");
  }
}

function metadataValue(key: string, value: string | number | boolean | null): string {
  const escapedKey = escapeSql(key);
  if (typeof value === "string") return `json_get_str(${metadataColumn}, '${escapedKey}')`;
  if (typeof value === "boolean") return `json_get_bool(${metadataColumn}, '${escapedKey}')`;
  return `json_get_float(${metadataColumn}, '${escapedKey}')`;
}

function assertNumericValue(value: unknown, operator: "gt" | "lt"): asserts value is number {
  if (typeof value !== "number") {
    throw new TypeError(`LanceDB ${operator} filters require numeric metadata values`);
  }
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}
