import {
  createGraphSearchTool,
  parseGraphProperties,
  type CreateGraphSearchToolOptions,
  type GraphContext,
  type GraphProperties,
  type GraphRetrieveOptions,
  type GraphSchemaLike,
  type GraphSearchTool,
  type GraphWriteResult,
} from "@anvia/graph";
import {
  int,
  type ManagedTransaction,
  type QueryResult,
  type Record as DriverRecord,
  type SessionConfig,
} from "neo4j-driver";
import type { MemgraphClient } from "./client.js";
import {
  abortError,
  quoteIdentifier,
  stableObject,
  strictProperties,
  throwIfAborted,
} from "./helpers.js";
import {
  assertName,
  constraintMatches,
  createConstraint,
  createLookupIndex,
  createTextIndex,
  createVectorIndex,
  firstString,
  indexMatches,
  recordContains,
  seedRegistration,
  validateExistingSeed,
  validateResources,
  validateVectorRecord,
  type ExpectedConstraint,
  type MemgraphSeedRegistration,
} from "./resources.js";
import type {
  DeleteMemgraphDocumentsOptions,
  ManagedMemgraphKnowledgeGraphOptions,
  MemgraphGraphConflict,
  MemgraphGraphValidateOptions,
  MemgraphKnowledgeGraphOptions,
  ReplaceMemgraphDocumentsOptions,
} from "./types.js";

type GraphTransaction = Pick<ManagedTransaction, "run">;
type Snapshot = Readonly<{
  documents: ReadonlyMap<string, string>;
  chunks: ReadonlyMap<string, string>;
  entities: ReadonlyMap<string, string>;
  relationships: ReadonlyMap<string, string>;
  mentions: ReadonlyMap<string, string>;
}>;
type SnapshotTargets = Readonly<{
  documentIds: readonly string[];
  chunkIds: readonly string[];
  entityKeys: readonly string[];
  relationshipKeys: readonly string[];
}>;

export abstract class MemgraphKnowledgeGraphBase<
  Schema extends GraphSchemaLike = GraphSchemaLike,
  Evidence extends "none" | "chunks" = "none" | "chunks",
> {
  abstract readonly seeds: Readonly<Record<string, MemgraphSeedRegistration>>;
  abstract readonly evidenceCapability: Evidence;

  protected constructor(
    protected readonly owner: MemgraphClient,
    readonly schema: Schema,
  ) {
    if (schema.kind !== "graph-schema") {
      throw new TypeError("Memgraph knowledge graphs require defineGraphSchema().");
    }
  }

  async validate(options: MemgraphGraphValidateOptions = {}): Promise<void> {
    throwIfAborted(options.abortSignal);
    await this.assertSupportedVersion(options.abortSignal);
    const vectors = await this.query(
      "CALL vector_search.show_index_info() YIELD * RETURN *",
      {},
      options.abortSignal,
    );
    const vectorRecords = new Map(
      vectors.records.map((record) => [
        requiredString(record.get("index_name"), "index name"),
        record,
      ]),
    );
    for (const seed of Object.values(this.seeds)) {
      const actual = vectorRecords.get(seed.vectorIndex.name);
      if (actual === undefined) {
        throw new Error(`Memgraph vector index ${seed.vectorIndex.name} does not exist.`);
      }
      validateVectorRecord(actual, seed);
    }
    const expectedTextNames = Object.values(this.seeds).flatMap((seed) =>
      seed.textIndex === undefined ? [] : [seed.textIndex.name],
    );
    if (expectedTextNames.length > 0) {
      const indexes = await this.query("SHOW INDEX INFO", {}, options.abortSignal);
      for (const name of expectedTextNames) {
        if (!indexes.records.some((record) => recordContains(record, name))) {
          throw new Error(`Memgraph text index ${name} does not exist.`);
        }
      }
    }
  }

  async retrieve(options: GraphRetrieveOptions<Schema>): Promise<GraphContext> {
    const { retrieveGraphContext } = await import("./retrieve.js");
    return retrieveGraphContext({ ...options, graph: this });
  }

  createSearchTool(options: Omit<CreateGraphSearchToolOptions<Schema>, "graph">): GraphSearchTool {
    return createGraphSearchTool({ ...options, graph: this });
  }

  async query(
    text: string,
    parameters: Record<string, unknown> = {},
    abortSignal?: AbortSignal,
    access: "read" | "write" = "read",
  ): Promise<QueryResult> {
    throwIfAborted(abortSignal);
    const sessionOptions: SessionConfig = {
      defaultAccessMode: access === "read" ? "READ" : "WRITE",
    };
    if (this.owner.database !== undefined) {
      Object.assign(sessionOptions, { database: this.owner.database });
    }
    const session = this.owner.nativeDriver().session(sessionOptions);
    let rejectAbort: ((error: Error) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => rejectAbort?.(abortError());
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await Promise.race([session.run(text, parameters), aborted]);
      throwIfAborted(abortSignal);
      return result;
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
      await session.close();
    }
  }

  seed(name: string): MemgraphSeedRegistration {
    const seed = this.seeds[name];
    if (seed === undefined) throw new TypeError(`Unknown Memgraph graph seed: ${name}`);
    return seed;
  }

  protected async transaction<T>(
    abortSignal: AbortSignal | undefined,
    run: (transaction: GraphTransaction) => Promise<T>,
  ): Promise<T> {
    return this.runTransaction("write", abortSignal, run);
  }

  private async runTransaction<T>(
    access: "read" | "write",
    abortSignal: AbortSignal | undefined,
    run: (transaction: GraphTransaction) => Promise<T>,
  ): Promise<T> {
    throwIfAborted(abortSignal);
    const sessionOptions: SessionConfig = {
      defaultAccessMode: access === "read" ? "READ" : "WRITE",
    };
    if (this.owner.database !== undefined) {
      Object.assign(sessionOptions, { database: this.owner.database });
    }
    const session = this.owner.nativeDriver().session(sessionOptions);
    const transaction = session.beginTransaction();
    let rejectAbort: ((error: Error) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => rejectAbort?.(abortError());
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    let committing = false;
    try {
      const value = await Promise.race([run(transaction), aborted]);
      throwIfAborted(abortSignal);
      committing = true;
      await transaction.commit();
      return value;
    } catch (error) {
      if (transaction.isOpen()) await transaction.rollback();
      if (!committing && abortSignal?.aborted) throw abortError();
      throw error;
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
      if (transaction.isOpen()) await transaction.rollback();
      await session.close();
    }
  }

  private async assertSupportedVersion(abortSignal?: AbortSignal): Promise<void> {
    const result = await this.query("SHOW VERSION", {}, abortSignal);
    const record = result.records[0];
    const value = record === undefined ? undefined : firstString(record);
    if (value === undefined) throw new TypeError("Memgraph returned a non-string server version.");
    const match = /(?:Memgraph\s+)?v?(\d+)\.(\d+)/i.exec(value);
    if (
      match === null ||
      Number(match[1]) < 3 ||
      (Number(match[1]) === 3 && Number(match[2]) < 6)
    ) {
      throw new Error(`@anvia/memgraph requires Memgraph 3.6 or newer; received ${value}.`);
    }
  }
}

export class MemgraphKnowledgeGraph<
  Schema extends GraphSchemaLike,
> extends MemgraphKnowledgeGraphBase<Schema, "none"> {
  readonly evidenceCapability = "none" as const;
  readonly seeds: Readonly<Record<string, MemgraphSeedRegistration>>;

  constructor(owner: MemgraphClient, options: MemgraphKnowledgeGraphOptions<Schema>) {
    super(owner, options.schema);
    if (Object.keys(options.seeds).length === 0) {
      throw new TypeError("An existing Memgraph knowledge graph requires at least one seed.");
    }
    this.seeds = Object.freeze(
      Object.fromEntries(
        Object.entries(options.seeds).map(([name, seed]) => [
          assertName(name, "Memgraph seed name"),
          validateExistingSeed(options.schema, seed),
        ]),
      ),
    );
  }
}

export class ManagedMemgraphKnowledgeGraph<
  Schema extends GraphSchemaLike,
> extends MemgraphKnowledgeGraphBase<Schema, "chunks"> {
  readonly evidenceCapability = "chunks" as const;
  readonly seeds: Readonly<Record<string, MemgraphSeedRegistration>>;
  readonly resources: ManagedMemgraphKnowledgeGraphOptions<Schema>["resources"];
  private readonly name: string;

  constructor(owner: MemgraphClient, options: ManagedMemgraphKnowledgeGraphOptions<Schema>) {
    super(owner, options.schema);
    this.name = assertName(options.name, "Managed Memgraph graph name");
    this.resources = validateResources(options.resources);
    const chunks = seedRegistration(
      this.resources.labels.chunk,
      this.resources.indexes.chunks.vector,
      "__anvia_embedding",
      this.resources.indexes.chunks.text,
      ["__anvia_text"],
      "ANVIA_MENTIONS",
    );
    const entities = seedRegistration(
      this.resources.labels.entity,
      this.resources.indexes.entities.vector,
      "__anvia_embedding",
      this.resources.indexes.entities.text,
      this.resources.indexes.entities.text?.properties ?? [],
    );
    this.seeds = Object.freeze({ chunks, entities });
  }

  async ensure(options: MemgraphGraphValidateOptions = {}): Promise<void> {
    throwIfAborted(options.abortSignal);
    const constraints = await this.query("SHOW CONSTRAINT INFO", {}, options.abortSignal);
    for (const expected of this.expectedConstraints()) {
      if (!constraints.records.some((record) => constraintMatches(record, expected))) {
        await this.query(createConstraint(expected), {}, options.abortSignal, "write");
      }
    }
    const indexes = await this.query("SHOW INDEX INFO", {}, options.abortSignal);
    for (const expected of this.expectedLookupIndexes()) {
      if (!indexes.records.some((record) => indexMatches(record, expected))) {
        await this.query(createLookupIndex(expected), {}, options.abortSignal, "write");
      }
    }
    const vectors = await this.query(
      "CALL vector_search.show_index_info() YIELD * RETURN *",
      {},
      options.abortSignal,
    );
    for (const seed of Object.values(this.seeds)) {
      const existing = vectors.records.find(
        (record) => record.get("index_name") === seed.vectorIndex.name,
      );
      if (existing === undefined) {
        await this.query(createVectorIndex(seed), {}, options.abortSignal, "write");
      } else {
        validateVectorRecord(existing, seed);
      }
    }
    const refreshedIndexes = await this.query("SHOW INDEX INFO", {}, options.abortSignal);
    for (const seed of Object.values(this.seeds)) {
      if (
        seed.textIndex !== undefined &&
        !refreshedIndexes.records.some((record) => recordContains(record, seed.textIndex?.name))
      ) {
        await this.query(createTextIndex(seed), {}, options.abortSignal, "write");
      }
    }
    await this.validate(options);
  }

  override async validate(options: MemgraphGraphValidateOptions = {}): Promise<void> {
    await super.validate(options);
    const constraints = await this.query("SHOW CONSTRAINT INFO", {}, options.abortSignal);
    for (const expected of this.expectedConstraints()) {
      if (!constraints.records.some((record) => constraintMatches(record, expected))) {
        throw new Error(
          `Memgraph uniqueness constraint :${expected.label}(${expected.properties.join(", ")}) does not exist.`,
        );
      }
    }
  }

  async replaceDocuments(
    options: ReplaceMemgraphDocumentsOptions<Schema>,
  ): Promise<GraphWriteResult> {
    validateReplacement(options, this.resources.indexes, this.schema);
    if (options.documents.length === 0) return emptyWriteResult();
    const documentIds = options.documents.map((document) => document.id);
    const chunksById = new Map(options.chunks.map((chunk) => [chunk.id, chunk.document]));
    const sourceDocuments = (chunkIds: readonly string[]) => [
      ...new Set(
        chunkIds.map((id) => {
          const chunk = chunksById.get(id);
          if (chunk === undefined)
            throw new TypeError(`Graph fact references unknown chunk ${id}.`);
          return chunk.documentId;
        }),
      ),
    ];
    const targets = replacementSnapshotTargets(options);
    return this.transaction(options.abortSignal, async (transaction) => {
      const before = await snapshotGraph(transaction, this.name, this.resources.labels, targets);
      const afterTargets = expandSnapshotTargets(targets, before);
      await removeDocuments(
        transaction,
        this.name,
        this.resources.labels,
        documentIds,
        options.orphanEntities,
      );
      await writeDocuments(transaction, this.resources.labels.document, options.documents);
      await writeChunks(transaction, this.resources.labels, options.chunks);
      await writeEntities(
        transaction,
        this.name,
        this.resources.labels.entity,
        options.entities,
        options.conflict,
        sourceDocuments,
      );
      await writeMentions(transaction, this.resources.labels, options.mentions);
      await writeRelationships(
        transaction,
        this.name,
        this.resources.labels.entity,
        options.relationships,
        options.conflict,
        sourceDocuments,
      );
      const after = await snapshotGraph(
        transaction,
        this.name,
        this.resources.labels,
        afterTargets,
      );
      return diffSnapshots(before, after);
    });
  }

  async deleteDocuments(options: DeleteMemgraphDocumentsOptions): Promise<GraphWriteResult> {
    validateOrphanPolicy(options.orphanEntities);
    const ids = uniqueIds(options.documentIds, "document");
    if (ids.length === 0) return emptyWriteResult();
    const targets = documentSnapshotTargets(ids);
    return this.transaction(options.abortSignal, async (transaction) => {
      const before = await snapshotGraph(transaction, this.name, this.resources.labels, targets);
      const afterTargets = expandSnapshotTargets(targets, before);
      await removeDocuments(
        transaction,
        this.name,
        this.resources.labels,
        ids,
        options.orphanEntities,
      );
      const after = await snapshotGraph(
        transaction,
        this.name,
        this.resources.labels,
        afterTargets,
      );
      return diffSnapshots(before, after);
    });
  }

  private expectedConstraints(): readonly ExpectedConstraint[] {
    return [
      { label: this.resources.labels.document, properties: ["__anvia_id"] },
      { label: this.resources.labels.chunk, properties: ["__anvia_id"] },
      { label: this.resources.labels.entity, properties: ["__anvia_key"] },
      ...Object.entries(this.schema.nodes).map(([label, definition]) => ({
        label,
        properties: definition.identity,
      })),
    ];
  }

  private expectedLookupIndexes(): readonly ExpectedConstraint[] {
    return this.expectedConstraints();
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`Memgraph ${label} must be a string.`);
  return value;
}

function validateReplacement<Schema extends GraphSchemaLike>(
  options: ReplaceMemgraphDocumentsOptions<Schema>,
  indexes: ManagedMemgraphKnowledgeGraphOptions<Schema>["resources"]["indexes"],
  schema: Schema,
): void {
  if (!(["error", "overwrite", "keep-existing"] as const).includes(options.conflict)) {
    throw new TypeError("Unknown Memgraph graph conflict policy.");
  }
  validateOrphanPolicy(options.orphanEntities);
  const documentIds = new Set(
    uniqueIds(
      options.documents.map((item) => item.id),
      "document",
    ),
  );
  const chunkIds = new Set(
    uniqueIds(
      options.chunks.map((item) => item.id),
      "chunk",
    ),
  );
  const entityIds = new Set(
    uniqueIds(
      options.entities.map((item) => item.id),
      "entity",
    ),
  );
  for (const document of options.documents) {
    if (document.properties !== undefined) parseGraphProperties(document.properties, "document");
  }
  for (const chunk of options.chunks) {
    if (chunk.id !== chunk.document.id)
      throw new TypeError("Embedded chunk id must match its document id.");
    if (!documentIds.has(chunk.document.documentId)) {
      throw new TypeError(`Graph chunk ${chunk.id} references unknown document.`);
    }
    if (!Number.isSafeInteger(chunk.document.index) || chunk.document.index < 0) {
      throw new TypeError(`Graph chunk ${chunk.id} index must be a non-negative safe integer.`);
    }
    if (typeof chunk.document.text !== "string") {
      throw new TypeError(`Graph chunk ${chunk.id} text must be a string.`);
    }
    if (chunk.document.metadata !== undefined) {
      parseGraphProperties(chunk.document.metadata, `chunk ${chunk.id} metadata`);
    }
    validateEmbedding(chunk.embeddings, indexes.chunks.vector.dimensions, `chunk ${chunk.id}`);
  }
  const mentioned = new Map<string, Set<string>>();
  for (const mention of options.mentions) {
    if (!chunkIds.has(mention.chunkId) || !entityIds.has(mention.entityKey)) {
      throw new TypeError("Graph mention references an unknown chunk or entity.");
    }
    const chunks = mentioned.get(mention.entityKey) ?? new Set<string>();
    if (chunks.has(mention.chunkId)) throw new TypeError("Duplicate graph mention.");
    chunks.add(mention.chunkId);
    mentioned.set(mention.entityKey, chunks);
  }
  for (const entity of options.entities) {
    if (entity.id !== entity.document.key)
      throw new TypeError("Embedded entity id must match its key.");
    const definition = schema.nodes[entity.document.type];
    if (definition === undefined)
      throw new TypeError(`Unknown graph entity ${entity.document.type}.`);
    const properties = parseGraphProperties(
      definition.properties.parse(entity.document.properties),
      `entity ${entity.id}`,
    );
    const expectedIdentity = Object.fromEntries(
      definition.identity.map((property) => [property, properties[property]]),
    );
    if (stableObject(expectedIdentity) !== stableObject(entity.document.identity)) {
      throw new TypeError(`Graph entity ${entity.id} identity does not match its properties.`);
    }
    validateSourceChunkIds(entity.document.sourceChunkIds, chunkIds, `entity ${entity.id}`);
    const actualMentions = mentioned.get(entity.id) ?? new Set<string>();
    if (
      actualMentions.size !== entity.document.sourceChunkIds.length ||
      entity.document.sourceChunkIds.some((id) => !actualMentions.has(id))
    ) {
      throw new TypeError(
        `Graph entity ${entity.id} source chunks must exactly match its mentions.`,
      );
    }
    validateEmbedding(entity.embeddings, indexes.entities.vector.dimensions, `entity ${entity.id}`);
  }
  const relationshipKeys = new Set<string>();
  for (const relationship of options.relationships) {
    if (relationshipKeys.has(relationship.key))
      throw new TypeError("Duplicate graph relationship key.");
    relationshipKeys.add(relationship.key);
    const definition = schema.relationships[relationship.type];
    if (definition === undefined) {
      throw new TypeError(`Unknown graph relationship ${relationship.type}.`);
    }
    const from = options.entities.find((entity) => entity.id === relationship.from)?.document;
    const to = options.entities.find((entity) => entity.id === relationship.to)?.document;
    if (from === undefined || to === undefined) {
      throw new TypeError(`Graph relationship ${relationship.key} references an unknown entity.`);
    }
    if (from.type !== definition.from || to.type !== definition.to) {
      throw new TypeError(`Graph relationship ${relationship.key} has invalid endpoint types.`);
    }
    parseGraphProperties(
      definition.properties.parse(relationship.properties),
      `relationship ${relationship.key}`,
    );
    validateSourceChunkIds(
      relationship.sourceChunkIds,
      chunkIds,
      `relationship ${relationship.key}`,
    );
    const fromChunks = new Set(from.sourceChunkIds);
    const toChunks = new Set(to.sourceChunkIds);
    if (relationship.sourceChunkIds.some((id) => !fromChunks.has(id) || !toChunks.has(id))) {
      throw new TypeError(
        `Relationship ${relationship.key} provenance must support both endpoint entities.`,
      );
    }
  }
}

function validateEmbedding(
  embeddings: readonly { vector: readonly number[] }[],
  dimensions: number,
  label: string,
): void {
  if (embeddings.length !== 1 || embeddings[0]?.vector.length !== dimensions) {
    throw new TypeError(`${label} requires exactly one ${dimensions}-dimensional embedding.`);
  }
  if (!embeddings[0].vector.every(Number.isFinite)) {
    throw new TypeError(`${label} embedding must contain only finite numbers.`);
  }
}

function validateSourceChunkIds(
  values: readonly string[],
  known: ReadonlySet<string>,
  label: string,
): void {
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new TypeError(`${label} requires unique source chunk ids.`);
  }
  for (const value of values) {
    if (!known.has(value)) throw new TypeError(`${label} references unknown chunk ${value}.`);
  }
}

function validateOrphanPolicy(value: unknown): asserts value is "delete" | "keep" {
  if (value !== "delete" && value !== "keep") {
    throw new TypeError("Unknown Memgraph orphan entity policy.");
  }
}

function uniqueIds(values: readonly string[], label: string): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`Graph ${label} id must be a non-empty string.`);
    }
    if (ids.has(value)) throw new TypeError(`Duplicate graph ${label} id: ${value}`);
    ids.add(value);
  }
  return [...ids];
}

async function removeDocuments(
  transaction: GraphTransaction,
  graphName: string,
  labels: { document: string; chunk: string; entity: string },
  documentIds: readonly string[],
  orphanEntities: "delete" | "keep",
): Promise<void> {
  const chunks = await transaction.run(
    `MATCH (d:${quoteIdentifier(labels.document)})-[:${quoteIdentifier("ANVIA_HAS_CHUNK")}]->(c:${quoteIdentifier(labels.chunk)})
WHERE d.${quoteIdentifier("__anvia_id")} IN $documentIds
RETURN collect(c.${quoteIdentifier("__anvia_id")}) AS chunkIds`,
    { documentIds },
  );
  const value = chunks.records[0]?.get("chunkIds");
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TypeError("Memgraph replacement returned malformed chunk ids.");
  }
  const chunkIds = value;
  await transaction.run(
    `MATCH ()-[r]->()
WHERE r.${quoteIdentifier("__anvia_graph")} = $graph AND
      any(id IN r.${quoteIdentifier("__anvia_source_document_ids")} WHERE id IN $documentIds)
SET r.${quoteIdentifier("__anvia_source_document_ids")} = [id IN r.${quoteIdentifier("__anvia_source_document_ids")} WHERE NOT id IN $documentIds],
    r.${quoteIdentifier("__anvia_source_chunk_ids")} = [id IN coalesce(r.${quoteIdentifier("__anvia_source_chunk_ids")}, []) WHERE NOT id IN $chunkIds]
WITH r WHERE size(r.${quoteIdentifier("__anvia_source_document_ids")}) = 0 DELETE r`,
    { graph: graphName, documentIds, chunkIds },
  );
  await transaction.run(
    `MATCH (d:${quoteIdentifier(labels.document)})
WHERE d.${quoteIdentifier("__anvia_id")} IN $documentIds
OPTIONAL MATCH (d)-[:${quoteIdentifier("ANVIA_HAS_CHUNK")}]->(c:${quoteIdentifier(labels.chunk)})
DETACH DELETE c, d`,
    { documentIds },
  );
  await transaction.run(
    `MATCH (e:${quoteIdentifier(labels.entity)})
WHERE e.${quoteIdentifier("__anvia_graph")} = $graph AND
      any(id IN coalesce(e.${quoteIdentifier("__anvia_source_document_ids")}, []) WHERE id IN $documentIds)
SET e.${quoteIdentifier("__anvia_source_document_ids")} = [id IN e.${quoteIdentifier("__anvia_source_document_ids")} WHERE NOT id IN $documentIds],
    e.${quoteIdentifier("__anvia_source_chunk_ids")} = [id IN coalesce(e.${quoteIdentifier("__anvia_source_chunk_ids")}, []) WHERE NOT id IN $chunkIds]
WITH e WHERE $deleteOrphans AND size(e.${quoteIdentifier("__anvia_source_document_ids")}) = 0
DETACH DELETE e`,
    { graph: graphName, documentIds, chunkIds, deleteOrphans: orphanEntities === "delete" },
  );
}

async function writeDocuments(
  transaction: GraphTransaction,
  label: string,
  documents: readonly { id: string; properties?: GraphProperties | undefined }[],
): Promise<void> {
  await transaction.run(
    `UNWIND $rows AS row
MERGE (d:${quoteIdentifier(label)} {${quoteIdentifier("__anvia_id")}: row.id})
SET d += row.properties`,
    { rows: documents.map((item) => ({ id: item.id, properties: item.properties ?? {} })) },
  );
}

async function writeChunks(
  transaction: GraphTransaction,
  labels: { document: string; chunk: string },
  chunks: ReplaceMemgraphDocumentsOptions<GraphSchemaLike>["chunks"],
): Promise<void> {
  const rows = chunks.map((chunk) => ({
    id: chunk.id,
    documentId: chunk.document.documentId,
    index: int(chunk.document.index),
    text: chunk.document.text,
    metadata: chunk.document.metadata ?? {},
    embedding: chunk.embeddings[0]?.vector,
  }));
  await transaction.run(
    `UNWIND $rows AS row
MATCH (d:${quoteIdentifier(labels.document)} {${quoteIdentifier("__anvia_id")}: row.documentId})
CREATE (c:${quoteIdentifier(labels.chunk)} {${quoteIdentifier("__anvia_id")}: row.id,
  ${quoteIdentifier("__anvia_document_id")}: row.documentId,
  ${quoteIdentifier("__anvia_index")}: row.index,
  ${quoteIdentifier("__anvia_text")}: row.text,
  ${quoteIdentifier("__anvia_embedding")}: row.embedding})
SET c += row.metadata
CREATE (d)-[:${quoteIdentifier("ANVIA_HAS_CHUNK")}]->(c)`,
    { rows },
  );
  const pairs = [...rows]
    .sort(
      (left, right) =>
        left.documentId.localeCompare(right.documentId) ||
        left.index.toNumber() - right.index.toNumber(),
    )
    .flatMap((row, index, all) => {
      const next = all[index + 1];
      return next !== undefined && next.documentId === row.documentId
        ? [{ from: row.id, to: next.id }]
        : [];
    });
  if (pairs.length > 0) {
    await transaction.run(
      `UNWIND $rows AS row
MATCH (a:${quoteIdentifier(labels.chunk)} {${quoteIdentifier("__anvia_id")}: row.from}),
      (b:${quoteIdentifier(labels.chunk)} {${quoteIdentifier("__anvia_id")}: row.to})
CREATE (a)-[:${quoteIdentifier("ANVIA_NEXT_CHUNK")}]->(b)`,
      { rows: pairs },
    );
  }
}

async function writeEntities<Schema extends GraphSchemaLike>(
  transaction: GraphTransaction,
  graphName: string,
  entityLabel: string,
  entities: ReplaceMemgraphDocumentsOptions<Schema>["entities"],
  conflict: ReplaceMemgraphDocumentsOptions<Schema>["conflict"],
  sourceDocuments: (sourceChunkIds: readonly string[]) => readonly string[],
): Promise<void> {
  const grouped = groupBy(entities, (entity) => entity.document.type);
  for (const [type, values] of grouped) {
    const rows = values.map((entity) => ({
      key: entity.id,
      properties: entity.document.properties,
      embedding: entity.embeddings[0]?.vector,
      sourceDocumentIds: sourceDocuments(entity.document.sourceChunkIds),
      sourceChunkIds: entity.document.sourceChunkIds,
    }));
    if (conflict === "error") {
      await assertEntityConflicts(transaction, entityLabel, rows);
    }
    const propertySet = conflictPropertySet("e", conflict);
    const embedding = entityEmbeddingExpression(conflict);
    await transaction.run(
      `UNWIND $rows AS row
MERGE (e:${quoteIdentifier(entityLabel)}:${quoteIdentifier(type)} {${quoteIdentifier("__anvia_key")}: row.key})
${propertySet}
SET e.${quoteIdentifier("__anvia_key")} = row.key,
    e.${quoteIdentifier("__anvia_graph")} = $graph,
    e.${quoteIdentifier("__anvia_embedding")} = ${embedding},
    e.${quoteIdentifier("__anvia_source_document_ids")} = reduce(all = existingDocumentIds, id IN row.sourceDocumentIds | CASE WHEN id IN all THEN all ELSE all + id END),
    e.${quoteIdentifier("__anvia_source_chunk_ids")} = reduce(all = existingChunkIds, id IN row.sourceChunkIds | CASE WHEN id IN all THEN all ELSE all + id END)`,
      { rows, graph: graphName },
    );
  }
}

function conflictPropertySet(variable: "e" | "r", conflict: MemgraphGraphConflict): string {
  const sourceDocuments = quoteIdentifier("__anvia_source_document_ids");
  const sourceChunks = quoteIdentifier("__anvia_source_chunk_ids");
  const existingSources = `WITH ${variable}, row,
     coalesce(${variable}.${sourceDocuments}, []) AS existingDocumentIds,
     coalesce(${variable}.${sourceChunks}, []) AS existingChunkIds`;
  if (conflict === "keep-existing") {
    return `ON CREATE SET ${variable} += row.properties
${existingSources}`;
  }
  if (conflict === "overwrite") {
    return `${existingSources}
SET ${variable} = row.properties`;
  }
  return `${existingSources}
SET ${variable} += row.properties`;
}

function entityEmbeddingExpression(conflict: MemgraphGraphConflict): string {
  if (conflict === "keep-existing") {
    return `coalesce(e.${quoteIdentifier("__anvia_embedding")}, row.embedding)`;
  }
  return "row.embedding";
}

async function assertEntityConflicts(
  transaction: GraphTransaction,
  entityLabel: string,
  rows: readonly { key: string; properties: GraphProperties }[],
): Promise<void> {
  const result = await transaction.run(
    `UNWIND $keys AS key
MATCH (e:${quoteIdentifier(entityLabel)} {${quoteIdentifier("__anvia_key")}: key})
RETURN key, properties(e) AS properties`,
    { keys: rows.map((row) => row.key) },
  );
  const incoming = new Map(rows.map((row) => [row.key, row.properties]));
  for (const record of result.records) {
    const key = requiredString(record.get("key"), "entity key");
    if (
      stableObject(applicationProperties(record.get("properties"))) !==
      stableObject(incoming.get(key) ?? {})
    ) {
      throw new Error(`Memgraph entity ${key} conflicts with existing properties.`);
    }
  }
}

async function writeMentions(
  transaction: GraphTransaction,
  labels: { chunk: string; entity: string },
  mentions: readonly { chunkId: string; entityKey: string }[],
): Promise<void> {
  if (mentions.length === 0) return;
  await transaction.run(
    `UNWIND $rows AS row
MATCH (c:${quoteIdentifier(labels.chunk)} {${quoteIdentifier("__anvia_id")}: row.chunkId}),
      (e:${quoteIdentifier(labels.entity)} {${quoteIdentifier("__anvia_key")}: row.entityKey})
MERGE (c)-[:${quoteIdentifier("ANVIA_MENTIONS")}]->(e)`,
    { rows: mentions },
  );
}

async function writeRelationships<Schema extends GraphSchemaLike>(
  transaction: GraphTransaction,
  graphName: string,
  entityLabel: string,
  relationships: ReplaceMemgraphDocumentsOptions<Schema>["relationships"],
  conflict: ReplaceMemgraphDocumentsOptions<Schema>["conflict"],
  sourceDocuments: (sourceChunkIds: readonly string[]) => readonly string[],
): Promise<void> {
  const grouped = groupBy(relationships, (relationship) => relationship.type);
  for (const [type, values] of grouped) {
    const rows = values.map((relationship) => ({
      key: relationship.key,
      from: relationship.from,
      to: relationship.to,
      properties: relationship.properties,
      sourceDocumentIds: sourceDocuments(relationship.sourceChunkIds),
      sourceChunkIds: relationship.sourceChunkIds,
    }));
    if (conflict === "error") {
      const existing = await transaction.run(
        `UNWIND $keys AS key
MATCH ()-[r:${quoteIdentifier(type)} {${quoteIdentifier("__anvia_key")}: key}]->()
RETURN key, properties(r) AS properties`,
        { keys: rows.map((row) => row.key) },
      );
      const incoming = new Map(rows.map((row) => [row.key, row.properties]));
      for (const record of existing.records) {
        const key = requiredString(record.get("key"), "relationship key");
        if (
          stableObject(applicationProperties(record.get("properties"))) !==
          stableObject(incoming.get(key) ?? {})
        ) {
          throw new Error(`Memgraph relationship ${key} conflicts with existing properties.`);
        }
      }
    }
    const propertySet = conflictPropertySet("r", conflict);
    await transaction.run(
      `UNWIND $rows AS row
MATCH (a:${quoteIdentifier(entityLabel)} {${quoteIdentifier("__anvia_key")}: row.from}),
      (b:${quoteIdentifier(entityLabel)} {${quoteIdentifier("__anvia_key")}: row.to})
MERGE (a)-[r:${quoteIdentifier(type)} {${quoteIdentifier("__anvia_key")}: row.key}]->(b)
${propertySet}
SET r.${quoteIdentifier("__anvia_key")} = row.key,
    r.${quoteIdentifier("__anvia_graph")} = $graph,
    r.${quoteIdentifier("__anvia_source_document_ids")} = reduce(all = existingDocumentIds, id IN row.sourceDocumentIds | CASE WHEN id IN all THEN all ELSE all + id END),
    r.${quoteIdentifier("__anvia_source_chunk_ids")} = reduce(all = existingChunkIds, id IN row.sourceChunkIds | CASE WHEN id IN all THEN all ELSE all + id END)`,
      { rows, graph: graphName },
    );
  }
}

async function snapshotGraph(
  transaction: GraphTransaction,
  graphName: string,
  labels: { document: string; chunk: string; entity: string },
  targets: SnapshotTargets,
): Promise<Snapshot> {
  const parameters = {
    graph: graphName,
    documentIds: targets.documentIds,
    chunkIds: targets.chunkIds,
    entityKeys: targets.entityKeys,
    relationshipKeys: targets.relationshipKeys,
  };
  const [documents, chunks, entities, relationships, mentions] = await Promise.all([
    transaction.run(
      `MATCH (n:${quoteIdentifier(labels.document)})
WHERE n.${quoteIdentifier("__anvia_id")} IN $documentIds
RETURN n.${quoteIdentifier("__anvia_id")} AS key, properties(n) AS properties`,
      parameters,
    ),
    transaction.run(
      `MATCH (n:${quoteIdentifier(labels.chunk)})
WHERE n.${quoteIdentifier("__anvia_id")} IN $chunkIds
   OR n.${quoteIdentifier("__anvia_document_id")} IN $documentIds
RETURN n.${quoteIdentifier("__anvia_id")} AS key, properties(n) AS properties`,
      parameters,
    ),
    transaction.run(
      `MATCH (n:${quoteIdentifier(labels.entity)})
WHERE n.${quoteIdentifier("__anvia_graph")} = $graph
  AND (n.${quoteIdentifier("__anvia_key")} IN $entityKeys
       OR any(documentId IN coalesce(n.${quoteIdentifier("__anvia_source_document_ids")}, [])
              WHERE documentId IN $documentIds))
RETURN n.${quoteIdentifier("__anvia_key")} AS key, labels(n) AS labels, properties(n) AS properties`,
      parameters,
    ),
    transaction.run(
      `MATCH ()-[r]->()
WHERE r.${quoteIdentifier("__anvia_graph")} = $graph
  AND (r.${quoteIdentifier("__anvia_key")} IN $relationshipKeys
       OR any(documentId IN coalesce(r.${quoteIdentifier("__anvia_source_document_ids")}, [])
              WHERE documentId IN $documentIds))
RETURN r.${quoteIdentifier("__anvia_key")} AS key, type(r) AS type, properties(r) AS properties`,
      parameters,
    ),
    transaction.run(
      `MATCH (c:${quoteIdentifier(labels.chunk)})-[:${quoteIdentifier("ANVIA_MENTIONS")}]->(e:${quoteIdentifier(labels.entity)})
WHERE e.${quoteIdentifier("__anvia_graph")} = $graph
  AND (c.${quoteIdentifier("__anvia_id")} IN $chunkIds
       OR c.${quoteIdentifier("__anvia_document_id")} IN $documentIds
       OR e.${quoteIdentifier("__anvia_key")} IN $entityKeys)
RETURN c.${quoteIdentifier("__anvia_id")} AS chunkId, e.${quoteIdentifier("__anvia_key")} AS entityKey`,
      parameters,
    ),
  ]);
  return {
    documents: snapshotProperties(documents.records),
    chunks: snapshotProperties(chunks.records),
    entities: snapshotProperties(entities.records, "labels"),
    relationships: snapshotProperties(relationships.records, "type"),
    mentions: new Map(
      mentions.records.map((record) => {
        const chunkId = requiredString(record.get("chunkId"), "mention chunk id");
        const entityKey = requiredString(record.get("entityKey"), "mention entity key");
        const key = `${chunkId}\u0000${entityKey}`;
        return [key, key];
      }),
    ),
  };
}

function replacementSnapshotTargets<Schema extends GraphSchemaLike>(
  options: ReplaceMemgraphDocumentsOptions<Schema>,
): SnapshotTargets {
  return {
    documentIds: options.documents.map((document) => document.id),
    chunkIds: options.chunks.map((chunk) => chunk.id),
    entityKeys: options.entities.map((entity) => entity.id),
    relationshipKeys: options.relationships.map((relationship) => relationship.key),
  };
}

function documentSnapshotTargets(documentIds: readonly string[]): SnapshotTargets {
  return { documentIds, chunkIds: [], entityKeys: [], relationshipKeys: [] };
}

function expandSnapshotTargets(targets: SnapshotTargets, snapshot: Snapshot): SnapshotTargets {
  const chunkIds = new Set([...targets.chunkIds, ...snapshot.chunks.keys()]);
  const entityKeys = new Set([...targets.entityKeys, ...snapshot.entities.keys()]);
  for (const mention of snapshot.mentions.keys()) {
    const separator = mention.indexOf("\u0000");
    if (separator === -1) continue;
    chunkIds.add(mention.slice(0, separator));
    entityKeys.add(mention.slice(separator + 1));
  }
  return {
    documentIds: targets.documentIds,
    chunkIds: [...chunkIds],
    entityKeys: [...entityKeys],
    relationshipKeys: [...new Set([...targets.relationshipKeys, ...snapshot.relationships.keys()])],
  };
}

function snapshotProperties(
  records: readonly DriverRecord[],
  discriminator?: string,
): Map<string, string> {
  return new Map(
    records.map((record) => {
      const key = requiredString(record.get("key"), "snapshot key");
      const properties = record.get("properties");
      if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
        throw new TypeError("Memgraph snapshot properties must be an object.");
      }
      const snapshot: Record<string, unknown> = {
        properties: properties as Record<string, unknown>,
      };
      if (discriminator !== undefined) {
        snapshot[discriminator] = record.get(discriminator);
      }
      return [key, stableObject(snapshot)];
    }),
  );
}

function diffSnapshots(before: Snapshot, after: Snapshot): GraphWriteResult {
  return {
    documents: diffMaps(before.documents, after.documents),
    chunks: diffMaps(before.chunks, after.chunks),
    entities: diffMaps(before.entities, after.entities),
    relationships: diffMaps(before.relationships, after.relationships),
    mentions: diffMaps(before.mentions, after.mentions),
  };
}

function diffMaps(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>) {
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let unchanged = 0;
  for (const [key, value] of after) {
    const previous = before.get(key);
    if (previous === undefined) created += 1;
    else if (previous === value) unchanged += 1;
    else updated += 1;
  }
  for (const key of before.keys()) if (!after.has(key)) deleted += 1;
  return { created, updated, deleted, unchanged };
}

function emptyWriteResult(): GraphWriteResult {
  const empty = { created: 0, updated: 0, deleted: 0, unchanged: 0 };
  return {
    documents: empty,
    chunks: empty,
    entities: empty,
    relationships: empty,
    mentions: empty,
  };
}

function applicationProperties(value: unknown): GraphProperties {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Memgraph properties must be an object.");
  }
  return strictProperties(
    Object.fromEntries(
      Object.entries(value).filter(([property]) => !property.startsWith("__anvia_")),
    ),
    "Memgraph application properties",
  );
}

function groupBy<Value, Key>(
  values: readonly Value[],
  key: (value: Value) => Key,
): Map<Key, Value[]> {
  const groups = new Map<Key, Value[]>();
  for (const value of values) {
    const item = key(value);
    const group = groups.get(item) ?? [];
    group.push(value);
    groups.set(item, group);
  }
  return groups;
}
