import type { VectorMetadata, VectorMetadataValue } from "../embeddings";
import type {
  VectorFilter,
  VectorFilterFieldOperators,
  VectorFilterInput,
  VectorFilterList,
  VectorFilterShorthand,
} from "./types";

export type {
  VectorFilter,
  VectorFilterComparisonOperator,
  VectorFilterFieldOperators,
  VectorFilterInput,
  VectorFilterList,
  VectorFilterOperator,
  VectorFilterShorthand,
} from "./types";

const COMPARISON_TYPES = new Set(["eq", "ne", "gt", "gte", "lt", "lte"]);
const FIELD_OPERATOR_KEYS = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "in"]);

export const vectorFilter = {
  eq(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "eq", key, value };
  },
  ne(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "ne", key, value };
  },
  gt(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "gt", key, value };
  },
  gte(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "gte", key, value };
  },
  lt(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "lt", key, value };
  },
  lte(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "lte", key, value };
  },
  in(key: string, values: readonly VectorMetadataValue[]): VectorFilter {
    return { type: "in", key, values: [...values] };
  },
  and(...filters: VectorFilterList): VectorFilter {
    return { type: "and", filters };
  },
  or(...filters: VectorFilterList): VectorFilter {
    return { type: "or", filters };
  },
  where(shorthand: VectorFilterShorthand): VectorFilter | undefined {
    return shorthandToVectorFilter(shorthand);
  },
};

export function isVectorFilter(value: unknown): value is VectorFilter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const type = record.type;

  if (typeof type !== "string") return false;

  const keys = Object.keys(record);

  if (COMPARISON_TYPES.has(type)) {
    return (
      keys.length === 3 &&
      typeof record.key === "string" &&
      "value" in record &&
      isMetadataValue(record.value)
    );
  }

  if (type === "in") {
    return (
      keys.length === 3 &&
      typeof record.key === "string" &&
      Array.isArray(record.values) &&
      record.values.every(isMetadataValue)
    );
  }

  if (type === "and" || type === "or") {
    return (
      keys.length === 2 &&
      Array.isArray(record.filters) &&
      record.filters.length > 0 &&
      record.filters.every(isVectorFilter)
    );
  }

  return false;
}

export function normalizeVectorFilter(
  filter: VectorFilterInput | undefined,
): VectorFilter | undefined {
  if (filter === undefined) return undefined;

  if (isVectorFilter(filter)) return filter;

  return shorthandToVectorFilter(filter);
}

function shorthandToVectorFilter(shorthand: VectorFilterShorthand): VectorFilter | undefined {
  if (typeof shorthand !== "object" || shorthand === null || Array.isArray(shorthand)) {
    throw new TypeError("Vector filter must be a VectorFilter or plain metadata filter object.");
  }

  const clauses: VectorFilter[] = [];
  for (const [key, condition] of Object.entries(shorthand)) {
    if (condition === undefined) {
      throw new TypeError(`Vector filter condition for key "${key}" must not be undefined.`);
    }

    if (isMetadataValue(condition)) {
      clauses.push(vectorFilter.eq(key, condition));
      continue;
    }

    if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
      throw new TypeError(`Invalid vector filter condition for key "${key}".`);
    }

    const operators = condition as VectorFilterFieldOperators;
    const operatorEntries = Object.entries(operators);

    if (operatorEntries.length === 0) {
      throw new TypeError(
        `Vector filter condition for key "${key}" must specify at least one operator.`,
      );
    }

    for (const [operator, value] of operatorEntries) {
      if (value === undefined) {
        throw new TypeError(
          `Vector filter operator "${operator}" for key "${key}" must not be undefined.`,
        );
      }

      if (!FIELD_OPERATOR_KEYS.has(operator)) {
        throw new TypeError(`Unsupported vector filter operator "${operator}" for key "${key}".`);
      }

      if (operator === "in") {
        if (!Array.isArray(value) || !value.every(isMetadataValue)) {
          throw new TypeError(
            `Vector filter operator "in" for key "${key}" requires metadata values.`,
          );
        }

        clauses.push(vectorFilter.in(key, value));
      } else {
        if (!isMetadataValue(value)) {
          throw new TypeError(
            `Vector filter operator "${operator}" for key "${key}" requires a metadata value.`,
          );
        }

        clauses.push({
          type: operator as "eq" | "ne" | "gt" | "gte" | "lt" | "lte",
          key,
          value,
        });
      }
    }
  }

  if (clauses.length === 0) return undefined;

  if (clauses.length === 1) return clauses[0];

  return { type: "and", filters: clauses as VectorFilterList };
}

function isMetadataValue(value: unknown): value is VectorMetadataValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function matchesVectorFilter(
  metadata: VectorMetadata | undefined,
  filterInput: VectorFilterInput | undefined,
): boolean {
  const filter = normalizeVectorFilter(filterInput);

  if (filter === undefined) {
    return true;
  }

  if (metadata === undefined) {
    return false;
  }

  switch (filter.type) {
    case "eq":
      return metadata[filter.key] === filter.value;
    case "ne":
      return metadata[filter.key] !== filter.value;
    case "gt":
      return (compare(metadata[filter.key], filter.value) ?? 0) > 0;
    case "gte": {
      const result = compare(metadata[filter.key], filter.value);
      return result !== undefined && result >= 0;
    }
    case "lt":
      return (compare(metadata[filter.key], filter.value) ?? 0) < 0;
    case "lte": {
      const result = compare(metadata[filter.key], filter.value);
      return result !== undefined && result <= 0;
    }
    case "in": {
      const value = metadata[filter.key];
      return value !== undefined && filter.values.includes(value);
    }
    case "and":
      return filter.filters.every((child) => matchesVectorFilter(metadata, child));
    case "or":
      return filter.filters.some((child) => matchesVectorFilter(metadata, child));
  }
}

function compare(
  left: VectorMetadataValue | undefined,
  right: VectorMetadataValue,
): number | undefined {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return undefined;
}
