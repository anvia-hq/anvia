import type { ToolDefinition } from "../completion";
import type { EmbeddingModel, VectorMetadata } from "../embeddings";
import { createToolIndex, type ToolIndex } from "./dynamic-tools";
import type { AnyTool, ToolCallContext } from "./tool";

export type SearchEntity<Metadata extends VectorMetadata = VectorMetadata> = {
  id: string;
  /** What the model matches against: title, one-line summary, aliases. */
  text: string;
  /** Returned on a hit: the body, path or command the model needs to act on. */
  detail?: string | undefined;
  metadata?: Metadata | undefined;
};

export type SearchHit<Metadata extends VectorMetadata = VectorMetadata> = {
  id: string;
  score: number;
  text: string;
  detail?: string | undefined;
  metadata?: Metadata | undefined;
};

export type SearchToolOptions<Metadata extends VectorMetadata = VectorMetadata> = {
  /** The tool the model calls, e.g. `search_runbooks`. */
  name: string;
  description?: string | undefined;
  /** The retrievable entries. A promise resolves once, on first use. */
  entities: readonly SearchEntity<Metadata>[] | Promise<readonly SearchEntity<Metadata>[]>;
  /** Supplying a model makes matching semantic; without one it matches terms. */
  model?: EmbeddingModel | undefined;
  /** Hits returned per call. Default 5. */
  topK?: number | undefined;
  /** Semantic mode only: results below this score are dropped, so a miss returns nothing. */
  minScore?: number | undefined;
  /** Renders the hits for the model. Defaults to one block per hit. */
  format?: ((hits: readonly SearchHit<Metadata>[]) => string) | undefined;
};

/**
 * One tool that searches its own domain, instead of one tool per entity behind a vector index.
 *
 * A flat index ranks a generic tool like `search_runbooks` by its own name and description, so a
 * query about a deployment checklist never reaches it. Searching the *entries* and handing their
 * text back does. The result is a `ToolIndex`, so it registers through `Agent.tools` like any
 * other.
 *
 * The "current query" a `ToolDefinition` may render is the turn's text, not what the model typed:
 * definitions are built before the call. Use `format` for the result and keep the parameter
 * description generic.
 */
export function searchTool<Metadata extends VectorMetadata = VectorMetadata>(
  options: SearchToolOptions<Metadata>,
): ToolIndex<Metadata> {
  const name = options.name.trim();
  if (name.length === 0) throw new TypeError("Search tool name must not be empty.");
  const topK = options.topK ?? 5;
  if (!Number.isSafeInteger(topK) || topK <= 0) {
    throw new RangeError("Search tool topK must be a positive safe integer.");
  }
  if (options.minScore !== undefined) {
    if (!Number.isFinite(options.minScore)) {
      throw new RangeError("Search tool minScore must be a finite number.");
    }
    if (options.model === undefined) {
      throw new TypeError(
        "Search tool minScore requires a model: vocabulary overlap scores are not comparable to embedding scores.",
      );
    }
  }
  const entities = loadEntities(options.entities);
  const format = options.format ?? defaultFormat;

  const lookup = async (
    query: string,
    abortSignal?: AbortSignal,
  ): Promise<SearchHit<Metadata>[]> => {
    const loaded = await entities;
    const hits =
      options.model === undefined
        ? rankByTerms(loaded, query, topK)
        : await rankByEmbedding(loaded, query, options, topK, abortSignal);
    return hits;
  };

  const tool: AnyTool = {
    name,
    definition: async (): Promise<ToolDefinition> => ({
      name,
      description: options.description ?? `Search ${name.replaceAll("_", " ")}.`,
      parameters: SEARCH_PARAMETERS,
    }),
    call: async (args: unknown) => {
      const query = searchQuery(name, args);
      return format(await lookup(query));
    },
  };

  // The shared channel: the index searches, and the tool answers from the result of the query the
  // agent just made for this turn. Both sides key on the query text, so a concurrent run with
  // different text does not see this one's hits.
  const recent = new Map<string, SearchHit<Metadata>[]>();
  const index: Mutable<ToolIndex<Metadata>> = {
    kind: "tool-index",
    tools: [tool],
    topK,
    search: async ({ query, abortSignal }) => {
      const results = await lookup(query, abortSignal);
      recent.set(query, results);
      const definition = await tool.definition(query);
      return results.map((hit) => ({
        id: hit.id,
        score: hit.score,
        document: { toolName: name, definition, text: hit.text },
      }));
    },
  };
  if (options.minScore !== undefined) index.minScore = options.minScore;
  if (options.model !== undefined) index.embeddingModel = options.model;

  tool.call = async (args: unknown, context?: ToolCallContext) => {
    const query = searchQuery(name, args);
    const hits = recent.get(query) ?? (await lookup(query, context?.abortSignal));
    return format(hits);
  };
  return index as ToolIndex<Metadata>;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const SEARCH_PARAMETERS = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "What to look for. Use the words the entries are likely to use themselves.",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

function loadEntities<Metadata extends VectorMetadata>(
  entities: SearchToolOptions<Metadata>["entities"],
): Promise<readonly SearchEntity<Metadata>[]> {
  return Promise.resolve(entities).then((list) => {
    const seen = new Set<string>();
    for (const entity of list) {
      if (entity.id.trim().length === 0)
        throw new TypeError("Search entities require a non-empty id.");
      if (seen.has(entity.id)) throw new TypeError(`Duplicate search entity id "${entity.id}".`);
      seen.add(entity.id);
    }
    return list;
  });
}

function searchQuery(name: string, args: unknown): string {
  if (typeof args !== "object" || args === null) {
    throw new TypeError(`Search tool "${name}" expects an object argument.`);
  }
  const query = (args as { query?: unknown }).query;
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new TypeError(`Search tool "${name}" requires a non-empty "query" string.`);
  }
  return query;
}

function entityText(entity: SearchEntity): string {
  return entity.detail === undefined ? entity.text : `${entity.text}\n${entity.detail}`;
}

async function rankByEmbedding<Metadata extends VectorMetadata>(
  entities: readonly SearchEntity<Metadata>[],
  query: string,
  options: SearchToolOptions<Metadata>,
  topK: number,
  abortSignal: AbortSignal | undefined,
): Promise<SearchHit<Metadata>[]> {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const createOptions: Parameters<typeof createToolIndex>[0] = {
    model: options.model!,
    tools: entities.map((entity) => entryTool(entity)),
    topK,
    embeddingText: "compact",
    content: (_tool, definition) => byId.get(definition.name)!.text,
  };
  if (options.minScore !== undefined) createOptions.minScore = options.minScore;
  const index = await createToolIndex(createOptions);
  const results = await index.search({ query, abortSignal });
  return results.map((result) => toHit(byId.get(result.document.toolName)!, result.score));
}

function entryTool<Metadata extends VectorMetadata>(entity: SearchEntity<Metadata>): AnyTool {
  return {
    name: entity.id,
    definition: async () => ({
      name: entity.id,
      description: entity.text,
      parameters: { type: "object", properties: {} },
    }),
    call: async () => entityText(entity),
  };
}

function toHit<Metadata extends VectorMetadata>(
  entity: SearchEntity<Metadata>,
  score: number,
): SearchHit<Metadata> {
  const hit: SearchHit<Metadata> = { id: entity.id, score, text: entity.text };
  if (entity.detail !== undefined) hit.detail = entity.detail;
  if (entity.metadata !== undefined) hit.metadata = entity.metadata;
  return hit;
}

const STOP_WORDS = new Set(
  "a an and any are as at be can do for from how i in is it me my of on or the to what when where which who why with".split(
    " ",
  ),
);

function rankByTerms<Metadata extends VectorMetadata>(
  entities: readonly SearchEntity<Metadata>[],
  query: string,
  topK: number,
): SearchHit<Metadata>[] {
  const terms = tokens(query);
  if (terms.length === 0) return [];
  const hits: SearchHit<Metadata>[] = [];
  for (const entity of entities) {
    const words = tokens(entityText(entity));
    const matched = terms.filter((term) => words.some((word) => word.startsWith(term)));
    if (matched.length === 0) continue;
    hits.push(toHit(entity, matched.length / terms.length));
  }
  hits.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return hits.slice(0, topK);
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function defaultFormat(hits: readonly SearchHit[]): string {
  if (hits.length === 0) return "No matching entries.";
  return hits.map((hit) => entityText(hit)).join("\n\n");
}
