import type { ToolDefinition } from "../completion";
import type { EmbeddedDocument, EmbeddingModel, VectorMetadata } from "../embeddings";
import { embedDocuments } from "../embeddings";
import type {
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
import { ToolSet } from "./tool-set";

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

export interface DynamicToolIndex<Metadata extends VectorMetadata = VectorMetadata>
  extends VectorSearchIndex<ToolSearchDocument<Metadata>, Metadata> {
  readonly toolSet: ToolSet;
}

export async function embedTools<Metadata extends VectorMetadata = VectorMetadata>(
  model: EmbeddingModel,
  tools: AnyTool[] | ToolSet,
  options: EmbedToolsOptions<Metadata> = {},
): Promise<Array<EmbeddedDocument<ToolSearchDocument<Metadata>, Metadata>>> {
  const toolList = Array.isArray(tools) ? tools : tools.values();
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
  tools: AnyTool[] | ToolSet,
  options: EmbedToolsOptions<Metadata> = {},
): Promise<DynamicToolIndex<Metadata>> {
  const toolSet = Array.isArray(tools) ? ToolSet.fromTools(tools) : tools;
  const embedded = await embedTools(model, toolSet, options);
  const index = InMemoryVectorStore.fromDocuments(embedded).index(model);
  return new DynamicToolSearchIndex(index, toolSet);
}

export function isDynamicToolIndex(value: unknown): value is DynamicToolIndex {
  return (
    typeof value === "object" &&
    value !== null &&
    "toolSet" in value &&
    (value as { toolSet?: unknown }).toolSet instanceof ToolSet
  );
}

class DynamicToolSearchIndex<Metadata extends VectorMetadata>
  implements DynamicToolIndex<Metadata>
{
  readonly inspect?: (
    request: VectorInspectRequest,
  ) => Promise<VectorInspectPage<ToolSearchDocument<Metadata>, Metadata>>;

  constructor(
    private readonly index: VectorSearchIndex<ToolSearchDocument<Metadata>, Metadata>,
    readonly toolSet: ToolSet,
  ) {
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

function defaultToolEmbeddingText(definition: ToolDefinition): string[] {
  return [definition.name, definition.description, JSON.stringify(definition.parameters)];
}
