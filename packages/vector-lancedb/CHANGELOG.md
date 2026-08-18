# @anvia/lancedb

## 0.2.7

### Patch Changes

- f1d078c: **SECURITY FIX: SQL Injection in filter construction**

  Fixed critical SQL injection vulnerability in `filterToLanceExpr()` function that allowed attackers to inject malicious SQL through column names and numeric values.

  **Vulnerability Details:**

  - Column names (`filter.key`) were directly interpolated into SQL expressions without validation
  - Numeric values in `gt`/`lt` filters were not validated for type safety
  - Attackers could inject SQL keywords, special characters, and malicious payloads

  **Security Improvements:**

  - Added `sanitizeColumnName()` function that validates column names using strict regex pattern
  - Rejects SQL keywords (SELECT, DROP, DELETE, etc.) in column names
  - Rejects special SQL characters (quotes, semicolons, dashes, etc.)
  - Added `sanitizeNumericValue()` to ensure only finite numbers are used
  - Supports safe nested field access with dot notation (e.g., `user.name`)
  - Comprehensive test coverage for injection attempts

  **Breaking Changes:**

  - Column names must now follow strict naming rules: start with letter/underscore, contain only alphanumeric/underscore/dots
  - Non-finite numeric values (NaN, Infinity) now throw errors instead of being silently accepted
  - SQL keywords cannot be used as column names

  **Migration:**

  - Existing valid column names (alphanumeric with underscores and dots) continue to work
  - Invalid column names will now throw clear error messages
  - No action required for applications using standard column naming conventions

## 0.2.6

### Patch Changes

- 615b767: Publish the updated upstream runtime dependencies.

## 0.2.5

### Patch Changes

- 433f642: Simplify optional vector query and result construction while preserving vector store behavior.

## 0.2.4

### Patch Changes

- 8f7ba97: Update upstream runtime dependencies for provider, vector, and observability adapters.

## 0.2.3

### Patch Changes

- 2559d04: Refresh upstream runtime dependencies and make pipeline construction schema-first.
- Updated dependencies [2559d04]
  - @anvia/core@0.7.1

## 0.2.2

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.2.1

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.2.0

### Minor Changes

- 473af86: Add Weaviate, Redis, and LanceDB vector store adapters.

  - `@anvia/weaviate` -- Weaviate v3 client adapter with `collections` API and `nearVector` queries.
  - `@anvia/redis` -- Redis vector store using RediSearch `FT.CREATE`/`FT.SEARCH` with HNSW indexing.
  - `@anvia/lancedb` -- Embedded LanceDB adapter with columnar storage and SQL-like filters.
