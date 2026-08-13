import type { ToolDefinition } from "../completion";
import type { EmbeddedDocument, EmbeddingModel, VectorMetadata } from "../embeddings";
import { embedDocuments } from "../embeddings";
import type {
  VectorFilter,
  VectorInspectPage,
  VectorInspectRequest,
  VectorSearchResult,
  VectorSearchToolOptions,
} from "../vector-store";
import {
  InMemoryVectorStore,
  type VectorSearchIndex,
  type VectorSearchRequest,
} from "../vector-store";
import type { AnyTool, Tool } from "./tool";

export type ToolSearchDocument<Metadata extends VectorMetadata = VectorMetadata> = {
  toolName: string;
  definition: ToolDefinition;
  text: string;
  metadata?: Metadata | undefined;
};

export type EmbedToolsOptions<Metadata extends VectorMetadata = VectorMetadata> = {
  content?: ((tool: AnyTool, definition: ToolDefinition) => string | string[]) | undefined;
  metadata?: ((tool: AnyTool, definition: ToolDefinition) => Metadata | undefined) | undefined;
  concurrency?: number | undefined;
};

export type CreateToolIndexOptions<Metadata extends VectorMetadata = VectorMetadata> =
  EmbedToolsOptions<Metadata> & {
    topK: number;
    threshold?: number | undefined;
    filter?: VectorFilter | undefined;
  };

export interface ToolIndex<Metadata extends VectorMetadata = VectorMetadata>
  extends VectorSearchIndex<ToolSearchDocument<Metadata>, Metadata> {
  readonly kind: "tool-index";
  readonly tools: readonly AnyTool[];
  readonly topK: number;
  readonly threshold?: number | undefined;
  readonly filter?: VectorFilter | undefined;
}

export async function embedTools<Metadata extends VectorMetadata = VectorMetadata>(
  model: EmbeddingModel,
  tools: readonly AnyTool[],
  options: EmbedToolsOptions<Metadata> = {},
): Promise<Array<EmbeddedDocument<ToolSearchDocument<Metadata>, Metadata>>> {
  const toolList = dedupeTools(tools);
  const definitions = await Promise.all(
    toolList.map(async (tool) => ({ tool, definition: await tool.definition("") })),
  );
  const documents = definitions.map(({ tool, definition }) => {
    const content = options.content?.(tool, definition) ?? defaultToolEmbeddingText(definition);
    const texts = Array.isArray(content) ? content : [content];
    const metadata = options.metadata?.(tool, definition);
    const document: ToolSearchDocument<Metadata> = {
      toolName: tool.name,
      definition,
      text: texts.join("\n"),
    };
    if (metadata !== undefined) {
      document.metadata = metadata;
    }
    return { tool, document, texts, metadata };
  });

  return embedDocuments(model, documents, {
    id: (item) => item.tool.name,
    content: (item) => item.texts,
    metadata: (item) => item.metadata,
    concurrency: options.concurrency,
  }).then((embedded) =>
    embedded.map((item) => ({
      ...item,
      document: item.document.document,
    })),
  );
}

export async function createToolIndex<Metadata extends VectorMetadata = VectorMetadata>(
  model: EmbeddingModel,
  tools: readonly AnyTool[],
  options: CreateToolIndexOptions<Metadata>,
): Promise<ToolIndex<Metadata>> {
  const toolList = dedupeTools(tools);
  const embedded = await embedTools(model, toolList, options);
  const index = InMemoryVectorStore.fromDocuments(embedded).index(model);
  return new ToolSearchIndex(index, toolList, options);
}

export function isToolIndex(value: unknown): value is ToolIndex {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "tool-index" &&
    Array.isArray((value as { tools?: unknown }).tools)
  );
}

class ToolSearchIndex<Metadata extends VectorMetadata> implements ToolIndex<Metadata> {
  readonly kind = "tool-index" as const;
  readonly tools: readonly AnyTool[];
  readonly topK: number;
  readonly threshold: number | undefined;
  readonly filter: VectorFilter | undefined;
  readonly inspect?: (
    request: VectorInspectRequest,
  ) => Promise<VectorInspectPage<ToolSearchDocument<Metadata>, Metadata>>;

  constructor(
    private readonly index: VectorSearchIndex<ToolSearchDocument<Metadata>, Metadata>,
    tools: readonly AnyTool[],
    options: CreateToolIndexOptions<Metadata>,
  ) {
    this.tools = Object.freeze([...tools]);
    this.topK = options.topK;
    this.threshold = options.threshold;
    this.filter = options.filter;
    if (index.inspect !== undefined) {
      this.inspect = (request) =>
        index.inspect?.(request) as Promise<
          VectorInspectPage<ToolSearchDocument<Metadata>, Metadata>
        >;
    }
  }

  search(
    request: VectorSearchRequest,
  ): Promise<Array<VectorSearchResult<ToolSearchDocument<Metadata>, Metadata>>> {
    return this.index.search(request);
  }

  searchIds(request: VectorSearchRequest): Promise<Array<{ score: number; id: string }>> {
    return this.index.searchIds(request);
  }

  asTool(options: VectorSearchToolOptions): Tool<{ query: string; topK?: number }, unknown> {
    return this.index.asTool(options);
  }
}

function dedupeTools(tools: readonly AnyTool[]): AnyTool[] {
  const byName = new Map<string, AnyTool>();
  for (const tool of tools) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}

function defaultToolEmbeddingText(definition: ToolDefinition): string[] {
  return [definition.name, definition.description, JSON.stringify(definition.parameters)];
}
