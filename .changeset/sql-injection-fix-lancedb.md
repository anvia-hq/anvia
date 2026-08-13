---
"@anvia/lancedb": patch
---

**SECURITY FIX: SQL Injection in filter construction**

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
