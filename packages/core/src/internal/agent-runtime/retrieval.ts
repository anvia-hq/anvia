import type { Agent } from "../../agent/agent";
import { getAgentToolState } from "../../agent/tool-state";
import { isVectorContext, type VectorContext } from "../../agent/vector-context";
import type { CompletionModel, Document, ToolDefinition } from "../../completion/index";
import { retrieveDocuments } from "../../vector-store";

export async function fetchContextDocuments<Output, M extends CompletionModel, ContextDocument>(
  agent: Agent<Output, M, ContextDocument>,
  ragText: string | undefined,
  abortSignal?: AbortSignal | undefined,
  /**
   * Wraps each vector context's retrieval (`index` is its position in `agent.context`). A runtime
   * that replays a turn can return the persisted documents without calling `retrieve`.
   */
  selectContext?: (index: number, retrieve: () => Promise<Document[]>) => Promise<Document[]>,
): Promise<Document[]> {
  const documents: Document[] = [];
  for (const [index, input] of agent.context.entries()) {
    if (!isVectorContext(input)) {
      documents.push(input);
      continue;
    }
    if (ragText === undefined || ragText.length === 0) continue;
    const retrieve = () => retrieveContext(input, ragText, abortSignal);
    documents.push(
      ...(selectContext !== undefined ? await selectContext(index, retrieve) : await retrieve()),
    );
  }
  return documents;
}

async function retrieveContext(
  input: VectorContext,
  ragText: string,
  abortSignal: AbortSignal | undefined,
): Promise<Document[]> {
  const documents: Document[] = [];
  const request = {
    query: ragText,
    topK: input.topK,
    minScore: input.minScore,
    filter: input.filter,
    retries: input.retries,
    abortSignal,
  };
  const results =
    "models" in input && input.models !== undefined
      ? await retrieveDocuments({
          ...request,
          store: input.store,
          models: input.models,
          fusion: input.fusion,
        })
      : await retrieveDocuments({ ...request, store: input.store, model: input.model });
  for (const result of results) {
    const formatted = input.format?.(result);
    if (formatted !== undefined) {
      documents.push(formatted);
      continue;
    }
    const metadata = formatMetadata(result.metadata);
    const document: Document = {
      id: result.id,
      text:
        typeof result.document === "string"
          ? result.document
          : JSON.stringify(result.document, null, 2),
    };
    if (metadata !== undefined) document.additionalProps = metadata;
    documents.push(document);
  }
  return documents;
}

/**
 * A tool an index returned for this turn's text. Tool names are unique across an agent's sources,
 * so a match is always offered; the flag existed for a repeat that cannot occur.
 */
export type ToolSelectionMatch = {
  toolName: string;
  /** The index's position in the agent's tool list. */
  index: number;
  score: number;
};

export type FetchedToolDefinitions = {
  definitions: ToolDefinition[];
  matches: ToolSelectionMatch[];
};

export async function fetchToolDefinitions<Output, M extends CompletionModel, ContextDocument>(
  agent: Agent<Output, M, ContextDocument>,
  ragText: string | undefined,
  abortSignal?: AbortSignal | undefined,
): Promise<FetchedToolDefinitions> {
  const state = getAgentToolState(agent);
  const staticDefinitions = await Promise.all(
    state.staticTools.map((tool) => tool.definition(ragText ?? "")),
  );
  if (ragText === undefined || ragText.length === 0 || state.toolIndexes.length === 0) {
    return { definitions: staticDefinitions, matches: [] };
  }

  const definitions = [...staticDefinitions];
  const matches: ToolSelectionMatch[] = [];
  const names = new Set(staticDefinitions.map((definition) => definition.name));
  for (const [indexPosition, index] of state.toolIndexes.entries()) {
    const results = await index.search({ query: ragText, abortSignal });
    for (const result of results) {
      const toolName = result.document.toolName;
      const tool = index.tools.find((candidate) => candidate.name === toolName);
      if (tool === undefined) continue;
      if (names.has(toolName)) continue;
      matches.push({ toolName, index: indexPosition, score: result.score });
      names.add(toolName);
      definitions.push(await tool.definition(ragText));
    }
  }
  return { definitions, matches };
}

function formatMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (metadata === undefined) return undefined;
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)]));
}
