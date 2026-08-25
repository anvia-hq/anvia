import { createGraphSearchTool } from "@anvia/graph";
import type { GraphSchemaLike } from "@anvia/graph";
import type { CreateMemgraphGraphSearchToolOptions, MemgraphGraphSearchTool } from "./types.js";

export function createMemgraphGraphSearchTool<Schema extends GraphSchemaLike>(
  options: CreateMemgraphGraphSearchToolOptions<Schema>,
): MemgraphGraphSearchTool {
  return createGraphSearchTool(options);
}
