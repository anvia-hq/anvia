import type { VectorFilter } from "@anvia/core/vector-store";

export function filterToLanceExpr(filter: VectorFilter | undefined): string | undefined {
  if (filter === undefined) {
    return undefined;
  }

  return translateFilter(filter);
}

function translateFilter(filter: VectorFilter): string {
  switch (filter.type) {
    case "eq":
      if (typeof filter.value === "string") {
        return `${sanitizeColumnName(filter.key)} = '${escapeSql(filter.value)}'`;
      }
      if (typeof filter.value === "boolean") {
        return `${sanitizeColumnName(filter.key)} = ${filter.value ? "TRUE" : "FALSE"}`;
      }
      if (filter.value === null) {
        return `${sanitizeColumnName(filter.key)} IS NULL`;
      }
      return `${sanitizeColumnName(filter.key)} = ${sanitizeNumericValue(filter.value)}`;
    case "gt":
      return `${sanitizeColumnName(filter.key)} > ${sanitizeNumericValue(filter.value)}`;
    case "lt":
      return `${sanitizeColumnName(filter.key)} < ${sanitizeNumericValue(filter.value)}`;
    case "and":
      return filter.filters.map((f) => `(${translateFilter(f)})`).join(" AND ");
    case "or":
      return filter.filters.map((f) => `(${translateFilter(f)})`).join(" OR ");
  }
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Sanitize column name to prevent SQL injection.
 * Only allows alphanumeric characters, underscores, and dots (for nested fields).
 * Throws an error if the column name contains potentially dangerous characters.
 */
function sanitizeColumnName(columnName: string): string {
  // Allow alphanumeric, underscore, and dot (for nested field access)
  // Reject any SQL keywords, operators, or special characters that could be used for injection
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(columnName)) {
    throw new Error(
      `Invalid column name: "${columnName}". Column names must start with a letter or underscore, ` +
        `and contain only alphanumeric characters, underscores, and dots for nested fields.`,
    );
  }

  // Additional check: reject SQL keywords that could be used maliciously
  const sqlKeywords = [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "CREATE",
    "ALTER",
    "EXEC",
    "EXECUTE",
    "UNION",
    "WHERE",
    "FROM",
    "TABLE",
    "DATABASE",
    "SCHEMA",
    "INDEX",
    "VIEW",
    "TRIGGER",
    "PROCEDURE",
    "FUNCTION",
  ];

  // Check each segment of the column name (for nested fields like user.name)
  const segments = columnName.split(".");
  for (const segment of segments) {
    const upperSegment = segment.toUpperCase();
    for (const keyword of sqlKeywords) {
      if (upperSegment === keyword) {
        throw new Error(
          `Invalid column name: "${columnName}". Column name segment "${segment}" cannot be a SQL keyword.`,
        );
      }
    }
  }

  return columnName;
}

/**
 * Sanitize numeric value to prevent injection via numeric fields.
 * Ensures the value is a safe number without any SQL injection attempts.
 */
function sanitizeNumericValue(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error(
      `Invalid numeric value: "${value}". Expected a number but received ${typeof value}.`,
    );
  }

  if (!Number.isFinite(value)) {
    throw new Error(
      `Invalid numeric value: "${value}". Value must be a finite number (not NaN, Infinity, or -Infinity).`,
    );
  }

  return value;
}
