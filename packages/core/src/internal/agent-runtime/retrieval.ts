import { type Agent, getAgentToolState } from "../../agent/agent";
import { isContextIndex } from "../../agent/context-index";
import type { Document, ToolDefinition } from "../../completion/index";

export async function fetchContextDocuments(
  agent: Agent,
  ragText: string | undefined,
): Promise<Document[]> {
  const documents: Document[] = [];
  for (const input of agent.context) {
    if (!isContextIndex(input)) {
      documents.push(input);
      continue;
    }
    if (ragText === undefined || ragText.length === 0) {
      continue;
    }
    const results = await input.index.search({
      query: ragText,
      topK: input.topK,
      threshold: input.threshold,
      filter: input.filter,
    });
    for (const result of results) {
      const formatted = input.format?.(result);
      if (formatted !== undefined) {
        documents.push(formatted);
      } else {
        const metadata = formatMetadata(result.metadata);
        const document: Document = {
          id: result.id,
          text:
            typeof result.document === "string"
              ? result.document
              : JSON.stringify(result.document, null, 2),
        };
        if (metadata !== undefined) {
          document.additionalProps = metadata;
        }
        documents.push(document);
      }
    }
  }
  return documents;
}

export async function fetchToolDefinitions(
  agent: Agent,
  ragText: string | undefined,
): Promise<ToolDefinition[]> {
  const state = getAgentToolState(agent);
  const staticDefinitions = await Promise.all(
    state.staticTools.map((tool) => tool.definition(ragText ?? "")),
  );
  if (ragText === undefined || ragText.length === 0 || state.toolIndexes.length === 0) {
    return staticDefinitions;
  }

  const definitions = [...staticDefinitions];
  const names = new Set(staticDefinitions.map((definition) => definition.name));
  for (const index of state.toolIndexes) {
    const results = await index.search({
      query: ragText,
      topK: index.topK,
      threshold: index.threshold,
      filter: index.filter,
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
