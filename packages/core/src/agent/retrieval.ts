import type { Document, ToolDefinition } from "../completion/index";
import { compact } from "../internal/compact";
import type { Agent } from "./agent";

export async function fetchDynamicContext(
  agent: Agent,
  ragText: string | undefined,
): Promise<Document[]> {
  if (ragText === undefined || ragText.length === 0 || agent.dynamicContexts.length === 0) {
    return [];
  }

  const documents: Document[] = [];
  for (const registration of agent.dynamicContexts) {
    const results = await registration.index.search({
      query: ragText,
      topK: registration.options.topK,
      threshold: registration.options.threshold,
      filter: registration.options.filter,
    });
    for (const result of results) {
      const formatted = registration.options.format?.(result);
      if (formatted !== undefined) {
        documents.push(formatted);
      } else {
        const metadata = formatMetadata(result.metadata);
        documents.push(compact({
          id: result.id,
          text:
            typeof result.document === "string"
              ? result.document
              : JSON.stringify(result.document, null, 2),
          additionalProps: metadata,
        }) as Document);
      }
    }
  }
  return documents;
}

export async function fetchToolDefinitions(
  agent: Agent,
  ragText: string | undefined,
): Promise<ToolDefinition[]> {
  const staticDefinitions = await agent.toolSet.getToolDefinitions(ragText);
  if (ragText === undefined || ragText.length === 0 || agent.dynamicTools.length === 0) {
    return staticDefinitions;
  }

  const definitions = [...staticDefinitions];
  const names = new Set(staticDefinitions.map((definition) => definition.name));
  for (const registration of agent.dynamicTools) {
    const results = await registration.index.search({
      query: ragText,
      topK: registration.options.topK,
      threshold: registration.options.threshold,
      filter: registration.options.filter,
    });
    for (const result of results) {
      if (names.has(result.document.toolName)) {
        continue;
      }
      names.add(result.document.toolName);
      definitions.push(result.document.definition);
    }
  }
  return definitions;
}

function formatMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)]));
}
