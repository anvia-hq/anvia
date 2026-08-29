import { quoteIdentifier } from "./helpers.js";

export type Neo4jManagedScope = Readonly<{
  graph: string;
  namespace?: string | undefined;
}>;

export function managedScopeParameters(
  scope: Neo4jManagedScope | undefined,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return scope === undefined
    ? parameters
    : { graph: scope.graph, namespace: scope.namespace ?? null, ...parameters };
}

export function managedScopePredicate(
  scope: Neo4jManagedScope | undefined,
  variable: string,
  prefix: " WHERE" | " AND" | "WHERE" | "AND",
): string {
  if (scope === undefined) return "";
  return `${prefix} ${variable}.${quoteIdentifier("__anvia_graph")} = $graph${namespacePredicate(scope, variable, " AND")}`;
}

export function namespacePredicate(
  scope: Neo4jManagedScope,
  variable: string,
  prefix: " WHERE" | " AND" | "WHERE" | "AND",
): string {
  return scope.namespace === undefined
    ? ""
    : `${prefix} ${variable}.${quoteIdentifier("__anvia_namespace")} = $namespace`;
}

export function tenantScopePredicate(
  scope: Neo4jManagedScope,
  variable: string,
  prefix: " WHERE" | " AND" | "WHERE" | "AND",
): string {
  return scope.namespace === undefined ? "" : managedScopePredicate(scope, variable, prefix);
}

export function managedPathPredicate(
  scope: Neo4jManagedScope | undefined,
  relationships: boolean,
): string {
  if (scope === undefined) return "";
  const item = `item.${quoteIdentifier("__anvia_graph")} = $graph${namespacePredicate(scope, "item", " AND")}`;
  const nodes = ` AND all(item IN nodes(path) WHERE ${item})`;
  return relationships ? `${nodes}\n  AND all(item IN relationships(path) WHERE ${item})` : nodes;
}

export function namespaceMapEntry(scope: Neo4jManagedScope): string {
  return scope.namespace === undefined
    ? ""
    : `, ${quoteIdentifier("__anvia_namespace")}: $namespace`;
}

export function tenantMapEntries(scope: Neo4jManagedScope): string {
  return scope.namespace === undefined
    ? ""
    : `, ${quoteIdentifier("__anvia_graph")}: $graph, ${quoteIdentifier("__anvia_namespace")}: $namespace`;
}

export function tenantRelationshipProperties(scope: Neo4jManagedScope): string {
  return scope.namespace === undefined
    ? ""
    : ` {${quoteIdentifier("__anvia_graph")}: $graph, ${quoteIdentifier("__anvia_namespace")}: $namespace}`;
}
