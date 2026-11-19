import type { JsonObject, ToolDefinition } from "../completion";
import type { EmbeddedDocument, EmbeddingModel, VectorMetadata } from "../embeddings";
import { embedDocuments } from "../embeddings";
import { assertFiniteMinScore, assertPositiveSearchLimit } from "../internal/vector-search-options";
import type { RetrySetting } from "../retry";
import {
  InMemoryVectorStore,
  retrieveDocuments,
  type VectorFilter,
  type VectorInspectPage,
  type VectorInspectRequest,
  type VectorSearchResult,
} from "../vector-store";
import type { AnyTool } from "./tool";

export type ToolEmbeddingText = "default" | "compact";

export type ToolSearchDocument<Metadata extends VectorMetadata = VectorMetadata> = {
  toolName: string;
  definition: ToolDefinition;
  text: string;
  metadata?: Metadata | undefined;
};

export type EmbedToolsOptions<Metadata extends VectorMetadata = VectorMetadata> = {
  model: EmbeddingModel;
  tools: readonly AnyTool[];
  content?: ((tool: AnyTool, definition: ToolDefinition) => string | string[]) | undefined;
  embeddingText?: ToolEmbeddingText | undefined;
  metadata?: ((tool: AnyTool, definition: ToolDefinition) => Metadata | undefined) | undefined;
  concurrency?: number | undefined;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
};

export type CreateToolIndexOptions<Metadata extends VectorMetadata = VectorMetadata> =
  EmbedToolsOptions<Metadata> & {
    topK: number;
    minScore?: number | undefined;
    filter?: VectorFilter | undefined;
  };

export interface ToolIndex<Metadata extends VectorMetadata = VectorMetadata> {
  readonly kind: "tool-index";
  readonly tools: readonly AnyTool[];
  readonly topK: number;
  readonly minScore?: number | undefined;
  readonly filter?: VectorFilter | undefined;
  search(options: {
    query: string;
    abortSignal?: AbortSignal | undefined;
  }): Promise<Array<VectorSearchResult<ToolSearchDocument<Metadata>, Metadata>>>;
  inspect?(
    request: VectorInspectRequest,
  ): Promise<VectorInspectPage<ToolSearchDocument<Metadata>, Metadata>>;
}

export async function embedTools<Metadata extends VectorMetadata = VectorMetadata>(
  options: EmbedToolsOptions<Metadata>,
): Promise<{
  documents: Array<EmbeddedDocument<ToolSearchDocument<Metadata>, Metadata>>;
}> {
  const toolList = dedupeTools(options.tools);
  const definitions = await Promise.all(
    toolList.map(async (tool) => ({ tool, definition: await tool.definition("") })),
  );
  const documents = definitions.map(({ tool, definition }) => {
    const content =
      options.content?.(tool, definition) ??
      defaultToolEmbeddingText(definition, options.embeddingText);
    const texts = Array.isArray(content) ? content : [content];
    const metadata = options.metadata?.(tool, definition);
    let document: ToolSearchDocument<Metadata> = {
      toolName: tool.name,
      definition,
      text: texts.join("\n"),
    };
    if (metadata !== undefined) document = { ...document, metadata };
    return { tool, document, texts, metadata };
  });

  const embedded = await embedDocuments({
    model: options.model,
    documents,
    id: (item) => item.tool.name,
    content: (item) => item.texts,
    metadata: (item) => item.metadata,
    concurrency: options.concurrency,
    retries: options.retries,
    abortSignal: options.abortSignal,
  });
  return {
    documents: embedded.documents.map((item) => ({
      ...item,
      document: item.document.document,
    })),
  };
}

export async function createToolIndex<Metadata extends VectorMetadata = VectorMetadata>(
  options: CreateToolIndexOptions<Metadata>,
): Promise<ToolIndex<Metadata>> {
  assertPositiveSearchLimit(options.topK);
  assertFiniteMinScore(options.minScore);
  const tools = dedupeTools(options.tools);
  const { documents } = await embedTools({ ...options, tools });
  const store = InMemoryVectorStore.fromDocuments({ documents });
  return new ToolSearchIndex(store, options.model, tools, options);
}

export function isToolIndex(value: unknown): value is ToolIndex {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    kind?: unknown;
    tools?: unknown;
    topK?: unknown;
    search?: unknown;
  };
  return (
    candidate.kind === "tool-index" &&
    Array.isArray(candidate.tools) &&
    typeof candidate.topK === "number" &&
    typeof candidate.search === "function"
  );
}

class ToolSearchIndex<Metadata extends VectorMetadata> implements ToolIndex<Metadata> {
  readonly kind = "tool-index" as const;
  readonly tools: readonly AnyTool[];
  readonly topK: number;
  readonly minScore: number | undefined;
  readonly filter: VectorFilter | undefined;

  constructor(
    private readonly store: InMemoryVectorStore<ToolSearchDocument<Metadata>, Metadata>,
    private readonly model: EmbeddingModel,
    tools: readonly AnyTool[],
    private readonly options: CreateToolIndexOptions<Metadata>,
  ) {
    this.tools = Object.freeze([...tools]);
    this.topK = options.topK;
    this.minScore = options.minScore;
    this.filter = options.filter;
  }

  search(options: {
    query: string;
    abortSignal?: AbortSignal | undefined;
  }): Promise<Array<VectorSearchResult<ToolSearchDocument<Metadata>, Metadata>>> {
    return retrieveDocuments({
      store: this.store,
      model: this.model,
      query: options.query,
      topK: this.topK,
      minScore: this.minScore,
      filter: this.filter,
      retries: this.options.retries,
      abortSignal: options.abortSignal,
    });
  }

  inspect(
    request: VectorInspectRequest,
  ): Promise<VectorInspectPage<ToolSearchDocument<Metadata>, Metadata>> {
    return this.store.inspect(request);
  }
}

function dedupeTools(tools: readonly AnyTool[]): AnyTool[] {
  const byName = new Map<string, AnyTool>();
  for (const tool of tools) byName.set(tool.name, tool);
  return [...byName.values()];
}

function defaultToolEmbeddingText(
  definition: ToolDefinition,
  mode: ToolEmbeddingText = "default",
): string[] {
  if (mode === "compact") return compactToolEmbeddingText(definition);
  return [definition.name, definition.description, JSON.stringify(definition.parameters)];
}

/**
 * Property names and `describe()` text are the words a query shares with a tool, so they are
 * embedded verbatim. Schema scaffolding is dropped because it is identical for every tool and only
 * dilutes the vector. The nested `description` is left alone: `toProviderJsonSchema` runs output
 * schemas in the same parameter slot, so a tool that returns JSON would otherwise be retrievable by
 * its result fields.
 */
function compactToolEmbeddingText(definition: ToolDefinition): string[] {
  const fields: string[] = [];
  const properties = definition.parameters.properties;
  if (isJsonObject(properties)) collectFieldWords(properties, fields);
  return fields.length === 0
    ? [definition.name, definition.description]
    : [definition.name, definition.description, fields.join(" ")];
}

function collectFieldWords(schema: JsonObject, words: string[], depth = 0, limit = 64): void {
  if (depth > 2 || words.length >= limit) return;
  for (const [name, value] of Object.entries(schema as Record<string, unknown>)) {
    if (words.length >= limit) return;
    if (name === "description" || name === "title") {
      if (depth > 0 && typeof value === "string") words.push(value);
      continue;
    }
    words.push(name);
    if (!isJsonObject(value)) continue;
    const description = value.description;
    if (typeof description === "string") words.push(description);
    for (const key of ["properties", "items", "anyOf", "oneOf", "allOf"] as const) {
      const nested = value[key];
      if (isJsonObject(nested)) collectFieldWords(nested, words, depth + 1, limit);
      else if (Array.isArray(nested)) {
        for (const item of nested) {
          if (isJsonObject(item)) collectFieldWords(item, words, depth + 1, limit);
        }
      }
    }
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
