import {
  createGraphSearchTool,
  type CreateGraphSearchToolOptions,
  type GraphContext,
  type GraphRetrieveOptions,
  type GraphSearchTool,
} from "@anvia/graph";
import {
  isInt,
  type ManagedTransaction,
  type Record as Neo4jRecord,
  type QueryResult,
  type SessionConfig,
} from "neo4j-driver";
import type { Neo4jClient } from "./client.js";
import {
  abortError,
  positiveInteger,
  quoteIdentifier,
  stableObject,
  throwIfAborted,
} from "./helpers.js";
import {
  assertName,
  assertPropertyName,
  parseNeo4jProperties,
  parseNeo4jPropertyValue,
} from "./schema.js";
import type {
  DeleteNeo4jDocumentsOptions,
  ExistingNeo4jSeed,
  ManagedNeo4jKnowledgeGraphOptions,
  Neo4jFulltextIndex,
  Neo4jGraphEnsureOptions,
  Neo4jGraphEvidenceCapability,
  Neo4jGraphSchema,
  Neo4jGraphValidateOptions,
  Neo4jGraphWriteResult,
  Neo4jKnowledgeGraphOptions,
  Neo4jNodeIdentity,
  Neo4jProperties,
  Neo4jVectorIndex,
  ReplaceNeo4jDocumentsOptions,
} from "./types.js";

type SeedRegistration = Readonly<{
  labels: readonly string[];
  vectorIndex: Neo4jVectorIndex & Readonly<{ property: string }>;
  fulltextIndex?: (Neo4jFulltextIndex & Readonly<{ properties: readonly string[] }>) | undefined;
  entryRelationshipType?: string | undefined;
}>;

type ExpectedConstraint = Readonly<{
  name: string;
  label: string;
  properties: readonly string[];
}>;

type GraphTransaction = Pick<ManagedTransaction, "run">;

export abstract class Neo4jKnowledgeGraphBase<
  Schema extends Neo4jGraphSchema = Neo4jGraphSchema,
  Evidence extends Neo4jGraphEvidenceCapability = Neo4jGraphEvidenceCapability,
> {
  abstract readonly seeds: Readonly<Record<string, SeedRegistration>>;
  abstract readonly evidenceCapability: Evidence;

  protected constructor(
    protected readonly owner: Neo4jClient,
    readonly schema: Schema,
  ) {
    if (schema.kind !== "neo4j-graph-schema" && schema.kind !== "graph-schema") {
      throw new TypeError(
        "Neo4j knowledge graphs require defineGraphSchema() or defineNeo4jGraphSchema().",
      );
    }
  }

  async validate(options: Neo4jGraphValidateOptions = {}): Promise<void> {
    throwIfAborted(options.abortSignal);
    await this.assertSupportedVersion(options.abortSignal);
    const expected = expectedIndexes(this.seeds);
    const names = [...expected.keys()];
    const result = await this.query(
      "SHOW INDEXES YIELD name, state, type, entityType, labelsOrTypes, properties, options WHERE name IN $names RETURN name, state, type, entityType, labelsOrTypes, properties, options",
      { names },
      options.abortSignal,
    );
    const actual = new Map(
      result.records.map((record) => [
        requiredString(record.get("name"), "Neo4j index name"),
        record,
      ]),
    );
    for (const [name, definition] of expected) {
      const record = actual.get(name);
      if (record === undefined) throw new Error(`Neo4j index ${name} does not exist.`);
      validateIndexRecord(record, definition);
    }
  }

  async query(
    text: string,
    parameters: Record<string, unknown>,
    abortSignal?: AbortSignal,
    access: "read" | "write" = "read",
  ): Promise<QueryResult> {
    return this.runTransaction(
      access,
      abortSignal,
      async (transaction) => await transaction.run(text, parameters),
    );
  }

  async retrieve(options: GraphRetrieveOptions<Schema>): Promise<GraphContext> {
    const { retrieveGraphContext } = await import("./retrieve.js");
    return retrieveGraphContext({
      ...options,
      graph: this,
    } as import("./types.js").RetrieveGraphContextOptions<Schema>);
  }

  createSearchTool(options: Omit<CreateGraphSearchToolOptions<Schema>, "graph">): GraphSearchTool {
    return createGraphSearchTool({ ...options, graph: this });
  }

  seed(name: string): SeedRegistration {
    const seed = this.seeds[name];
    if (seed === undefined) throw new TypeError(`Unknown Neo4j graph seed: ${name}`);
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
    const onAbort = () => {
      rejectAbort?.(abortError());
    };
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
    const result = await this.query(
      "CALL dbms.components() YIELD versions RETURN versions[0] AS version LIMIT 1",
      {},
      abortSignal,
    );
    const version = result.records[0]?.get("version");
    if (typeof version !== "string") {
      throw new TypeError("Neo4j returned a non-string server version.");
    }
    if (!supportedVersion(version)) {
      throw new Error(`@anvia/neo4j requires Neo4j 2026.01 or newer; received ${version}.`);
    }
  }
}

export class Neo4jKnowledgeGraph<Schema extends Neo4jGraphSchema> extends Neo4jKnowledgeGraphBase<
  Schema,
  "none"
> {
  readonly evidenceCapability = "none" as const;
  readonly seeds: Readonly<Record<string, SeedRegistration>>;

  constructor(owner: Neo4jClient, options: Neo4jKnowledgeGraphOptions<Schema>) {
    super(owner, options.schema);
    if (Object.keys(options.seeds).length === 0) {
      throw new TypeError("An existing Neo4j knowledge graph requires at least one seed.");
    }
    const seeds: Record<string, SeedRegistration> = {};
    for (const [name, seed] of Object.entries(options.seeds)) {
      assertName(name, "Neo4j seed name");
      seeds[name] = validateExistingSeed(options.schema, seed);
    }
    this.seeds = Object.freeze(seeds);
  }
}

export class ManagedNeo4jKnowledgeGraph<
  Schema extends Neo4jGraphSchema,
> extends Neo4jKnowledgeGraphBase<Schema, "chunks"> {
  readonly evidenceCapability = "chunks" as const;
  readonly seeds: Readonly<Record<string, SeedRegistration>>;
  readonly resources: ManagedNeo4jKnowledgeGraphOptions<Schema>["resources"];
  private readonly name: string;

  constructor(owner: Neo4jClient, options: ManagedNeo4jKnowledgeGraphOptions<Schema>) {
    super(owner, options.schema);
    assertName(options.name, "Managed Neo4j graph name");
    this.name = options.name;
    this.resources = validateManagedResources(options.resources);
    let chunks: SeedRegistration = {
      labels: Object.freeze([this.resources.labels.chunk]),
      vectorIndex: Object.freeze({
        ...this.resources.indexes.chunks.vector,
        property: "__anvia_embedding",
      }),
      entryRelationshipType: "ANVIA_MENTIONS",
    };
    if (this.resources.indexes.chunks.fulltext !== undefined) {
      chunks = {
        ...chunks,
        fulltextIndex: Object.freeze({
          ...this.resources.indexes.chunks.fulltext,
          properties: Object.freeze(["__anvia_text"]),
        }),
      };
    }
    let entities: SeedRegistration = {
      labels: Object.freeze([this.resources.labels.entity]),
      vectorIndex: Object.freeze({
        ...this.resources.indexes.entities.vector,
        property: "__anvia_embedding",
      }),
    };
    if (this.resources.indexes.entities.fulltext !== undefined) {
      entities = {
        ...entities,
        fulltextIndex: Object.freeze({
          ...this.resources.indexes.entities.fulltext,
          properties: Object.freeze([
            ...(this.resources.indexes.entities.fulltext.properties ?? []),
          ]),
        }),
      };
    }
    this.seeds = Object.freeze({
      chunks: Object.freeze(chunks),
      entities: Object.freeze(entities),
    });
  }

  async ensure(options: Neo4jGraphEnsureOptions): Promise<void> {
    positiveInteger(options.indexTimeoutMs, "Neo4j index timeout");
    throwIfAborted(options.abortSignal);
    const { labels, indexes } = this.resources;
    const statements = [
      uniquenessConstraint(constraintName(this.name, "document"), labels.document, ["__anvia_id"]),
      uniquenessConstraint(constraintName(this.name, "chunk"), labels.chunk, ["__anvia_id"]),
      uniquenessConstraint(constraintName(this.name, "entity"), labels.entity, ["__anvia_key"]),
      ...Object.entries(this.schema.nodes).map(([type, definition]) =>
        uniquenessConstraint(
          constraintName(this.name, `entity_${type}`),
          type,
          definition.identity,
        ),
      ),
      vectorIndex(indexes.chunks.vector, labels.chunk),
      vectorIndex(indexes.entities.vector, labels.entity),
    ];
    if (indexes.chunks.fulltext !== undefined) {
      statements.push(fulltextIndex(indexes.chunks.fulltext.name, labels.chunk, ["__anvia_text"]));
    }
    if (indexes.entities.fulltext !== undefined) {
      statements.push(
        fulltextIndex(
          indexes.entities.fulltext.name,
          labels.entity,
          indexes.entities.fulltext.properties ?? [],
        ),
      );
    }
    for (const statement of statements)
      await this.query(statement, {}, options.abortSignal, "write");
    await this.query(
      "CALL db.awaitIndexes($timeoutSeconds)",
      { timeoutSeconds: Math.ceil(options.indexTimeoutMs / 1000) },
      options.abortSignal,
    );
    await this.validate({ abortSignal: options.abortSignal });
  }

  override async validate(options: Neo4jGraphValidateOptions = {}): Promise<void> {
    await super.validate(options);
    const expected = this.expectedConstraints();
    const names = expected.map((constraint) => constraint.name);
    const result = await this.query(
      "SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties WHERE name IN $names RETURN name, type, entityType, labelsOrTypes, properties",
      { names },
      options.abortSignal,
    );
    const actual = new Map(
      result.records.map((record) => [
        requiredString(record.get("name"), "Neo4j constraint name"),
        record,
      ]),
    );
    for (const constraint of expected) {
      const record = actual.get(constraint.name);
      if (record === undefined) {
        throw new Error(`Neo4j constraint ${constraint.name} does not exist.`);
      }
      validateConstraintRecord(record, constraint);
    }
  }

  async replaceDocuments(
    options: ReplaceNeo4jDocumentsOptions<Schema>,
  ): Promise<Neo4jGraphWriteResult> {
    validateReplacement(options, this.resources.indexes, this.schema);
    if (options.documents.length === 0) return emptyWriteResult();
    const documentIds = options.documents.map((document) => document.id);
    const chunksById = new Map(options.chunks.map((chunk) => [chunk.id, chunk.document]));
    const sourceDocuments = (sourceChunkIds: readonly string[]) => [
      ...new Set(
        sourceChunkIds.map((chunkId) => {
          const chunk = chunksById.get(chunkId);
          if (chunk === undefined)
            throw new TypeError(`Graph fact references unknown chunk ${chunkId}.`);
          return chunk.documentId;
        }),
      ),
    ];
    return await this.transaction(options.abortSignal, async (transaction) => {
      const targets = replacementSnapshotTargets(options);
      const before = await snapshotGraphState(
        transaction,
        this.name,
        this.resources.labels,
        targets,
      );
      await removeDocuments(
        transaction,
        this.name,
        this.resources.labels,
        documentIds,
        options.orphanEntities,
      );
      await writeDocuments(transaction, this.resources.labels, options.documents);
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
      const after = await snapshotGraphState(
        transaction,
        this.name,
        this.resources.labels,
        expandSnapshotTargets(targets, before),
      );
      return diffGraphSnapshots(before, after);
    });
  }

  async deleteDocuments(options: DeleteNeo4jDocumentsOptions): Promise<Neo4jGraphWriteResult> {
    validateOrphanPolicy(options.orphanEntities);
    const ids = uniqueIds(options.documentIds, "document");
    if (ids.length === 0) return emptyWriteResult();
    return await this.transaction(options.abortSignal, async (transaction) => {
      const targets = emptySnapshotTargets(ids);
      const before = await snapshotGraphState(
        transaction,
        this.name,
        this.resources.labels,
        targets,
      );
      await removeDocuments(
        transaction,
        this.name,
        this.resources.labels,
        ids,
        options.orphanEntities,
      );
      const after = await snapshotGraphState(
        transaction,
        this.name,
        this.resources.labels,
        expandSnapshotTargets(targets, before),
      );
      return diffGraphSnapshots(before, after);
    });
  }

  private expectedConstraints(): readonly ExpectedConstraint[] {
    return [
      {
        name: constraintName(this.name, "document"),
        label: this.resources.labels.document,
        properties: ["__anvia_id"],
      },
      {
        name: constraintName(this.name, "chunk"),
        label: this.resources.labels.chunk,
        properties: ["__anvia_id"],
      },
      {
        name: constraintName(this.name, "entity"),
        label: this.resources.labels.entity,
        properties: ["__anvia_key"],
      },
      ...Object.entries(this.schema.nodes).map(([type, definition]) => ({
        name: constraintName(this.name, `entity_${type}`),
        label: type,
        properties: definition.identity,
      })),
    ];
  }
}

function validateExistingSeed(schema: Neo4jGraphSchema, seed: ExistingNeo4jSeed): SeedRegistration {
  if (seed.nodeTypes.length !== 1) {
    throw new TypeError(
      "Each existing Neo4j seed requires exactly one indexed node type; register additional indexes as separate seeds.",
    );
  }
  for (const type of seed.nodeTypes) {
    if (!(type in schema.nodes))
      throw new TypeError(`Neo4j seed references unknown node type ${type}.`);
  }
  validateVectorIndex(seed.vectorIndex);
  assertPropertyName(seed.vectorIndex.property);
  if (seed.fulltextIndex !== undefined) {
    validateFulltextIndex(seed.fulltextIndex, "Existing Neo4j full-text index");
  }
  let registration: SeedRegistration = {
    labels: Object.freeze([...seed.nodeTypes]),
    vectorIndex: Object.freeze({ ...seed.vectorIndex }),
  };
  if (seed.fulltextIndex !== undefined) {
    registration = {
      ...registration,
      fulltextIndex: Object.freeze({
        ...seed.fulltextIndex,
        properties: Object.freeze([...seed.fulltextIndex.properties]),
      }),
    };
  }
  return Object.freeze(registration);
}

function validateManagedResources<Schema extends Neo4jGraphSchema>(
  resources: ManagedNeo4jKnowledgeGraphOptions<Schema>["resources"],
): ManagedNeo4jKnowledgeGraphOptions<Schema>["resources"] {
  const labels = Object.values(resources.labels);
  for (const label of labels) assertName(label, "Neo4j managed label");
  if (new Set(labels).size !== labels.length)
    throw new TypeError("Managed Neo4j graph labels must be distinct.");
  const indexes = [resources.indexes.chunks.vector, resources.indexes.entities.vector];
  for (const index of indexes) validateVectorIndex(index);
  const names = [
    ...indexes.map((index) => index.name),
    resources.indexes.chunks.fulltext?.name,
    resources.indexes.entities.fulltext?.name,
  ].filter((name): name is string => name !== undefined);
  if (new Set(names).size !== names.length)
    throw new TypeError("Managed Neo4j index names must be unique.");
  if (resources.indexes.entities.fulltext !== undefined) {
    const properties = resources.indexes.entities.fulltext.properties ?? [];
    if (properties.length === 0)
      throw new TypeError("Entity full-text indexes require explicit properties.");
  }
  if (resources.indexes.chunks.fulltext !== undefined) {
    validateFulltextIndex(
      { ...resources.indexes.chunks.fulltext, properties: ["__anvia_text"] },
      "Chunk full-text index",
      true,
    );
  }
  if (resources.indexes.entities.fulltext !== undefined) {
    validateFulltextIndex(
      {
        ...resources.indexes.entities.fulltext,
        properties: resources.indexes.entities.fulltext.properties ?? [],
      },
      "Entity full-text index",
    );
  }
  const copyFulltext = (fulltext: Neo4jFulltextIndex): Neo4jFulltextIndex => {
    let copy: Neo4jFulltextIndex = { ...fulltext };
    if (fulltext.properties !== undefined) {
      copy = { ...copy, properties: Object.freeze([...fulltext.properties]) };
    }
    return Object.freeze(copy);
  };
  let chunks: (typeof resources)["indexes"]["chunks"] = Object.freeze({
    vector: Object.freeze({ ...resources.indexes.chunks.vector }),
  });
  if (resources.indexes.chunks.fulltext !== undefined) {
    chunks = Object.freeze({
      ...chunks,
      fulltext: copyFulltext(resources.indexes.chunks.fulltext),
    });
  }
  let entities: (typeof resources)["indexes"]["entities"] = Object.freeze({
    vector: Object.freeze({ ...resources.indexes.entities.vector }),
  });
  if (resources.indexes.entities.fulltext !== undefined) {
    entities = Object.freeze({
      ...entities,
      fulltext: copyFulltext(resources.indexes.entities.fulltext),
    });
  }
  return Object.freeze({
    labels: Object.freeze({ ...resources.labels }),
    indexes: Object.freeze({
      chunks,
      entities,
    }),
  });
}

function validateVectorIndex(index: Neo4jVectorIndex): void {
  assertName(index.name, "Neo4j vector index name");
  positiveInteger(index.dimensions, "Neo4j vector dimensions", 4096);
  if (index.similarity !== "cosine" && index.similarity !== "euclidean") {
    throw new TypeError("Neo4j vector similarity must be cosine or euclidean.");
  }
}

function validateFulltextIndex(
  index: Neo4jFulltextIndex & Readonly<{ properties: readonly string[] }>,
  label: string,
  allowReservedProperties = false,
): void {
  assertName(index.name, `${label} name`);
  if (index.properties.length === 0 || new Set(index.properties).size !== index.properties.length) {
    throw new TypeError(`${label} requires unique properties.`);
  }
  for (const property of index.properties) {
    if (allowReservedProperties) assertName(property, `${label} property`);
    else assertPropertyName(property);
  }
}

type ExpectedIndex =
  | Readonly<{
      kind: "vector";
      name: string;
      labels: readonly string[];
      properties: readonly string[];
      dimensions: number;
      similarity: "cosine" | "euclidean";
    }>
  | Readonly<{
      kind: "fulltext";
      name: string;
      labels: readonly string[];
      properties: readonly string[];
    }>;

function expectedIndexes(
  seeds: Readonly<Record<string, SeedRegistration>>,
): Map<string, ExpectedIndex> {
  const expected = new Map<string, ExpectedIndex>();
  const register = (index: ExpectedIndex) => {
    const previous = expected.get(index.name);
    if (previous !== undefined && stableObject(previous) !== stableObject(index)) {
      throw new TypeError(`Neo4j index ${index.name} has conflicting registrations.`);
    }
    expected.set(index.name, index);
  };
  for (const seed of Object.values(seeds)) {
    register({
      kind: "vector",
      name: seed.vectorIndex.name,
      labels: seed.labels,
      properties: [seed.vectorIndex.property],
      dimensions: seed.vectorIndex.dimensions,
      similarity: seed.vectorIndex.similarity,
    });
    if (seed.fulltextIndex !== undefined) {
      register({
        kind: "fulltext",
        name: seed.fulltextIndex.name,
        labels: seed.labels,
        properties: seed.fulltextIndex.properties,
      });
    }
  }
  return expected;
}

function validateIndexRecord(record: Neo4jRecord, expected: ExpectedIndex): void {
  const state = requiredString(record.get("state"), `Neo4j index ${expected.name} state`);
  if (state !== "ONLINE") throw new Error(`Neo4j index ${expected.name} is ${state}, not ONLINE.`);
  const type = requiredString(record.get("type"), `Neo4j index ${expected.name} type`);
  const entityType = requiredString(
    record.get("entityType"),
    `Neo4j index ${expected.name} entity type`,
  );
  const labels = requiredStringArray(
    record.get("labelsOrTypes"),
    `Neo4j index ${expected.name} labels`,
  );
  const properties = requiredStringArray(
    record.get("properties"),
    `Neo4j index ${expected.name} properties`,
  );
  if (
    entityType !== "NODE" ||
    type !== expected.kind.toUpperCase() ||
    !sameStrings(labels, expected.labels) ||
    !sameStrings(properties, expected.properties)
  ) {
    throw new Error(`Neo4j index ${expected.name} does not match its registration.`);
  }
  if (expected.kind === "vector") {
    const options = requiredObject(record.get("options"), `Neo4j index ${expected.name} options`);
    const config = requiredObject(
      options.indexConfig,
      `Neo4j index ${expected.name} vector configuration`,
    );
    const dimensions = requiredSafeInteger(
      config["vector.dimensions"],
      `Neo4j index ${expected.name} dimensions`,
    );
    const similarity = requiredString(
      config["vector.similarity_function"],
      `Neo4j index ${expected.name} similarity`,
    ).toLowerCase();
    if (dimensions !== expected.dimensions || similarity !== expected.similarity) {
      throw new Error(`Neo4j index ${expected.name} has incompatible vector configuration.`);
    }
  }
}

function validateConstraintRecord(record: Neo4jRecord, expected: ExpectedConstraint): void {
  const type = requiredString(record.get("type"), `Neo4j constraint ${expected.name} type`);
  const entityType = requiredString(
    record.get("entityType"),
    `Neo4j constraint ${expected.name} entity type`,
  );
  const labels = requiredStringArray(
    record.get("labelsOrTypes"),
    `Neo4j constraint ${expected.name} labels`,
  );
  const properties = requiredStringArray(
    record.get("properties"),
    `Neo4j constraint ${expected.name} properties`,
  );
  if (
    entityType !== "NODE" ||
    type !== "UNIQUENESS" ||
    !sameStrings(labels, [expected.label]) ||
    !sameStrings(properties, expected.properties)
  ) {
    throw new Error(`Neo4j constraint ${expected.name} does not match its registration.`);
  }
}

function requiredObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TypeError(`${label} must be a string array.`);
  }
  return [...value];
}

function requiredSafeInteger(value: unknown, label: string): number {
  if (isInt(value)) {
    if (!value.inSafeRange()) throw new TypeError(`${label} must be a safe integer.`);
    return value.toNumber();
  }
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer.`);
  return value as number;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function supportedVersion(value: string): boolean {
  const match = /^(\d{4})\.(\d+)/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year > 2026 || (year === 2026 && month >= 1);
}

function constraintName(graph: string, resource: string): string {
  return `anvia_${graph}_${resource}_identity`;
}

function uniquenessConstraint(name: string, label: string, properties: readonly string[]): string {
  const expression =
    properties.length === 1
      ? `n.${quoteIdentifier(properties[0] as string)}`
      : `(${properties.map((property) => `n.${quoteIdentifier(property)}`).join(", ")})`;
  return `CREATE CONSTRAINT ${quoteIdentifier(name)} IF NOT EXISTS FOR (n:${quoteIdentifier(label)}) REQUIRE ${expression} IS UNIQUE`;
}

function vectorIndex(index: Neo4jVectorIndex, label: string): string {
  return `CREATE VECTOR INDEX ${quoteIdentifier(index.name)} IF NOT EXISTS FOR (n:${quoteIdentifier(label)}) ON (n.${quoteIdentifier("__anvia_embedding")}) OPTIONS {indexConfig: {\`vector.dimensions\`: ${index.dimensions}, \`vector.similarity_function\`: '${index.similarity}'}}`;
}

function fulltextIndex(name: string, label: string, properties: readonly string[]): string {
  if (properties.length === 0) throw new TypeError(`Full-text index ${name} requires properties.`);
  return `CREATE FULLTEXT INDEX ${quoteIdentifier(name)} IF NOT EXISTS FOR (n:${quoteIdentifier(label)}) ON EACH [${properties.map((property) => `n.${quoteIdentifier(property)}`).join(", ")}]`;
}

function validateReplacement<Schema extends Neo4jGraphSchema>(
  options: ReplaceNeo4jDocumentsOptions<Schema>,
  indexes: ManagedNeo4jKnowledgeGraphOptions<Schema>["resources"]["indexes"],
  schema: Schema,
): void {
  if (
    !Array.isArray(options.documents) ||
    !Array.isArray(options.chunks) ||
    !Array.isArray(options.entities) ||
    !Array.isArray(options.relationships) ||
    !Array.isArray(options.mentions)
  ) {
    throw new TypeError("Neo4j replacement collections must be arrays.");
  }
  if (
    options.conflict !== "error" &&
    options.conflict !== "overwrite" &&
    options.conflict !== "keep-existing"
  ) {
    throw new TypeError("Neo4j conflict policy must be error, overwrite, or keep-existing.");
  }
  validateOrphanPolicy(options.orphanEntities);
  const documentIds = uniqueIds(
    options.documents.map((document, index) => {
      requiredObject(document, `Neo4j document at index ${index}`);
      return document.id;
    }),
    "document",
  );
  const documentSet = new Set(documentIds);
  const chunkIds = uniqueIds(
    options.chunks.map((chunk, index) => {
      requiredObject(chunk, `Neo4j chunk at index ${index}`);
      requiredObject(chunk.document, `Neo4j chunk document at index ${index}`);
      return chunk.id;
    }),
    "chunk",
  );
  const chunkSet = new Set(chunkIds);
  const entityIds = uniqueIds(
    options.entities.map((entity, index) => {
      requiredObject(entity, `Neo4j entity at index ${index}`);
      requiredObject(entity.document, `Neo4j entity document at index ${index}`);
      return entity.id;
    }),
    "entity",
  );
  const entitySet = new Set(entityIds);
  for (const document of options.documents)
    parseNeo4jProperties(document.properties ?? {}, `document ${document.id}`);
  const chunkPositions = new Set<string>();
  for (const chunk of options.chunks) {
    if (!documentSet.has(chunk.document.documentId))
      throw new TypeError(`Chunk ${chunk.id} references an unknown document.`);
    if (chunk.document.id !== chunk.id)
      throw new TypeError(`Embedded chunk ${chunk.id} has a mismatched document id.`);
    if (!Number.isSafeInteger(chunk.document.index) || chunk.document.index < 0) {
      throw new TypeError(`Chunk ${chunk.id} index must be a non-negative safe integer.`);
    }
    if (typeof chunk.document.text !== "string") {
      throw new TypeError(`Chunk ${chunk.id} text must be a string.`);
    }
    const position = `${chunk.document.documentId}\u0000${chunk.document.index}`;
    if (chunkPositions.has(position)) {
      throw new TypeError(
        `Document ${chunk.document.documentId} contains duplicate chunk index ${chunk.document.index}.`,
      );
    }
    chunkPositions.add(position);
    singleEmbedding(chunk.embeddings, indexes.chunks.vector.dimensions, `chunk ${chunk.id}`);
    parseNeo4jProperties(chunk.document.metadata ?? {}, `chunk ${chunk.id} metadata`);
  }
  const entityTypes = new Map<string, string>();
  const entitySourceChunks = new Map<string, ReadonlySet<string>>();
  for (const entity of options.entities) {
    if (entity.document.key !== entity.id)
      throw new TypeError(`Embedded entity ${entity.id} has a mismatched key.`);
    singleEmbedding(entity.embeddings, indexes.entities.vector.dimensions, `entity ${entity.id}`);
    const type = entity.document.type;
    if (typeof type !== "string") throw new TypeError(`Entity ${entity.id} type must be a string.`);
    const definition = schema.nodes[type];
    if (definition === undefined)
      throw new TypeError(`Entity ${entity.id} has unknown type ${type}.`);
    const properties = parseExactSchemaProperties(
      definition.properties,
      entity.document.properties,
      `entity ${entity.id} properties`,
    );
    const identity = parseIdentity(entity.document.identity, definition.identity, properties, type);
    const expectedKey = `${type}:${stableObject(identity)}`;
    if (entity.id !== expectedKey) {
      throw new TypeError(`Entity ${entity.id} does not match its canonical identity key.`);
    }
    const sourceChunkIds = validateSourceChunkIds(
      entity.document.sourceChunkIds,
      chunkSet,
      `entity ${entity.id}`,
    );
    entityTypes.set(entity.id, type);
    entitySourceChunks.set(entity.id, new Set(sourceChunkIds));
  }
  uniqueIds(
    options.relationships.map((relationship, index) => {
      requiredObject(relationship, `Neo4j relationship at index ${index}`);
      return relationship.key;
    }),
    "relationship",
  );
  for (const relationship of options.relationships) {
    const definition = schema.relationships[relationship.type];
    if (definition === undefined) {
      throw new TypeError(
        `Relationship ${relationship.key} has unknown type ${relationship.type}.`,
      );
    }
    if (!entitySet.has(relationship.from) || !entitySet.has(relationship.to)) {
      throw new TypeError(`Relationship ${relationship.key} references an unknown entity.`);
    }
    if (
      entityTypes.get(relationship.from) !== definition.from ||
      entityTypes.get(relationship.to) !== definition.to
    ) {
      throw new TypeError(`Relationship ${relationship.key} has incompatible endpoint types.`);
    }
    const properties = parseExactSchemaProperties(
      definition.properties,
      relationship.properties,
      `relationship ${relationship.key} properties`,
    );
    const identity = identityFromProperties(
      definition.identity ?? [],
      properties,
      relationship.type,
    );
    const expectedKey = `${relationship.type}:${relationship.from}->${relationship.to}:${stableObject(identity)}`;
    if (relationship.key !== expectedKey) {
      throw new TypeError(`Relationship ${relationship.key} does not match its canonical key.`);
    }
    const sourceChunkIds = validateSourceChunkIds(
      relationship.sourceChunkIds,
      chunkSet,
      `relationship ${relationship.key}`,
    );
    const fromSources = entitySourceChunks.get(relationship.from);
    const toSources = entitySourceChunks.get(relationship.to);
    if (
      fromSources === undefined ||
      toSources === undefined ||
      sourceChunkIds.some((chunkId) => !fromSources.has(chunkId) || !toSources.has(chunkId))
    ) {
      throw new TypeError(
        `Relationship ${relationship.key} source chunks must support both endpoint entities.`,
      );
    }
  }
  const mentionKeys = new Set<string>();
  const mentionChunksByEntity = new Map<string, Set<string>>();
  for (const [index, mention] of options.mentions.entries()) {
    requiredObject(mention, `Neo4j mention at index ${index}`);
    if (!chunkSet.has(mention.chunkId) || !entitySet.has(mention.entityKey)) {
      throw new TypeError(`Mention at index ${index} references an unknown chunk or entity.`);
    }
    const key = `${mention.chunkId}\u0000${mention.entityKey}`;
    if (mentionKeys.has(key)) throw new TypeError(`Duplicate Neo4j mention at index ${index}.`);
    mentionKeys.add(key);
    const chunks = mentionChunksByEntity.get(mention.entityKey);
    if (chunks === undefined)
      mentionChunksByEntity.set(mention.entityKey, new Set([mention.chunkId]));
    else chunks.add(mention.chunkId);
  }
  for (const entityId of entityIds) {
    const sources = [...(entitySourceChunks.get(entityId) ?? [])];
    const mentions = [...(mentionChunksByEntity.get(entityId) ?? [])];
    if (!sameStrings(sources, mentions)) {
      throw new TypeError(`Entity ${entityId} source chunks must exactly match its mentions.`);
    }
  }
}

function parseExactSchemaProperties(
  schema: Neo4jGraphSchema["nodes"][string]["properties"],
  value: unknown,
  label: string,
): Neo4jProperties {
  const input = parseNeo4jProperties(value, label);
  const result = schema.safeParse(value);
  if (!result.success) throw new TypeError(`${label} does not match the graph schema.`);
  const output = parseNeo4jProperties(result.data, `${label} output`);
  if (stableObject(input) !== stableObject(output)) {
    throw new TypeError(`${label} must not be coerced, defaulted, transformed, or stripped.`);
  }
  return input;
}

function parseIdentity(
  value: unknown,
  keys: readonly string[],
  properties: Neo4jProperties,
  type: string,
): Neo4jNodeIdentity {
  const identity = identityFromProperties(
    keys,
    parseNeo4jProperties(value, `${type} identity`),
    type,
  );
  if (!sameStrings(Object.keys(identity), keys)) {
    throw new TypeError(`Entity ${type} identity must contain exactly its declared properties.`);
  }
  for (const key of keys) {
    if (identity[key] !== properties[key]) {
      throw new TypeError(`Entity ${type} identity property ${key} does not match its properties.`);
    }
  }
  return identity;
}

function identityFromProperties(
  keys: readonly string[],
  properties: Neo4jProperties,
  type: string,
): Neo4jNodeIdentity {
  const identity: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    const value = properties[key];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new TypeError(`Identity property ${key} for ${type} must be a primitive value.`);
    }
    identity[key] = value;
  }
  return identity;
}

function validateSourceChunkIds(
  value: readonly string[],
  chunkIds: ReadonlySet<string>,
  label: string,
): string[] {
  const ids = uniqueIds(value, `${label} source chunk`);
  if (ids.length === 0) throw new TypeError(`${label} requires source chunk provenance.`);
  for (const id of ids) {
    if (!chunkIds.has(id)) throw new TypeError(`${label} references unknown source chunk ${id}.`);
  }
  return ids;
}

function validateOrphanPolicy(value: unknown): asserts value is "delete" | "keep" {
  if (value !== "delete" && value !== "keep") {
    throw new TypeError("Neo4j orphan entity policy must be delete or keep.");
  }
}

function singleEmbedding(
  embeddings: readonly { vector: number[] }[],
  dimensions: number,
  label: string,
): number[] {
  if (!Array.isArray(embeddings)) throw new TypeError(`${label} embeddings must be an array.`);
  if (embeddings.length !== 1) throw new TypeError(`${label} requires exactly one embedding.`);
  const vector = embeddings[0]?.vector;
  if (vector === undefined || vector.length !== dimensions || !vector.every(Number.isFinite)) {
    throw new TypeError(`${label} has an invalid ${dimensions}-dimension embedding.`);
  }
  return vector;
}

function uniqueIds(ids: readonly string[], label: string): string[] {
  if (!Array.isArray(ids)) throw new TypeError(`Neo4j ${label} ids must be an array.`);
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0)
      throw new TypeError(`Neo4j ${label} ids must be non-empty strings.`);
    if (seen.has(id)) throw new TypeError(`Duplicate Neo4j ${label} id: ${id}`);
    seen.add(id);
  }
  return [...seen];
}

type SnapshotTargets = Readonly<{
  documentIds: readonly string[];
  chunkIds: readonly string[];
  entityKeys: readonly string[];
  relationshipKeys: readonly string[];
  mentions: readonly Readonly<{ chunkId: string; entityKey: string }>[];
}>;

type GraphSnapshot = Readonly<{
  documents: ReadonlyMap<string, string>;
  chunks: ReadonlyMap<string, string>;
  entities: ReadonlyMap<string, string>;
  relationships: ReadonlyMap<string, string>;
  mentions: ReadonlyMap<string, string>;
}>;

function replacementSnapshotTargets(
  options: ReplaceNeo4jDocumentsOptions<Neo4jGraphSchema>,
): SnapshotTargets {
  return {
    documentIds: options.documents.map((document) => document.id),
    chunkIds: options.chunks.map((chunk) => chunk.id),
    entityKeys: options.entities.map((entity) => entity.id),
    relationshipKeys: options.relationships.map((relationship) => relationship.key),
    mentions: options.mentions,
  };
}

function emptySnapshotTargets(documentIds: readonly string[]): SnapshotTargets {
  return {
    documentIds,
    chunkIds: [],
    entityKeys: [],
    relationshipKeys: [],
    mentions: [],
  };
}

function expandSnapshotTargets(targets: SnapshotTargets, snapshot: GraphSnapshot): SnapshotTargets {
  const mentions = new Map(
    targets.mentions.map((mention) => [mentionKey(mention.chunkId, mention.entityKey), mention]),
  );
  for (const key of snapshot.mentions.keys()) {
    const separator = key.indexOf("\u0000");
    if (separator < 0) throw new TypeError("Stored Neo4j mention has an invalid identity.");
    mentions.set(key, { chunkId: key.slice(0, separator), entityKey: key.slice(separator + 1) });
  }
  return {
    documentIds: targets.documentIds,
    chunkIds: [...new Set([...targets.chunkIds, ...snapshot.chunks.keys()])],
    entityKeys: [...new Set([...targets.entityKeys, ...snapshot.entities.keys()])],
    relationshipKeys: [...new Set([...targets.relationshipKeys, ...snapshot.relationships.keys()])],
    mentions: [...mentions.values()],
  };
}

async function snapshotGraphState(
  transaction: GraphTransaction,
  graphName: string,
  labels: { document: string; chunk: string; entity: string },
  targets: SnapshotTargets,
): Promise<GraphSnapshot> {
  const documentsResult = await transaction.run(
    `MATCH (d:${quoteIdentifier(labels.document)})
WHERE d.${quoteIdentifier("__anvia_id")} IN $documentIds
RETURN d.${quoteIdentifier("__anvia_id")} AS key, properties(d) AS properties`,
    { documentIds: targets.documentIds },
  );
  const chunksResult = await transaction.run(
    `MATCH (c:${quoteIdentifier(labels.chunk)})
OPTIONAL MATCH (d:${quoteIdentifier(labels.document)})-[:${quoteIdentifier("ANVIA_HAS_CHUNK")}]->(c)
WITH c, d WHERE c.${quoteIdentifier("__anvia_id")} IN $chunkIds OR d.${quoteIdentifier("__anvia_id")} IN $documentIds
RETURN c.${quoteIdentifier("__anvia_id")} AS key, properties(c) AS properties`,
    { chunkIds: targets.chunkIds, documentIds: targets.documentIds },
  );
  const entitiesResult = await transaction.run(
    `MATCH (e:${quoteIdentifier(labels.entity)})
WHERE e.${quoteIdentifier("__anvia_graph")} = $graph AND (
  e.${quoteIdentifier("__anvia_key")} IN $entityKeys OR
  any(id IN coalesce(e.${quoteIdentifier("__anvia_source_document_ids")}, []) WHERE id IN $documentIds)
)
RETURN e.${quoteIdentifier("__anvia_key")} AS key, labels(e) AS labels, properties(e) AS properties`,
    { graph: graphName, entityKeys: targets.entityKeys, documentIds: targets.documentIds },
  );
  const relationshipsResult = await transaction.run(
    `MATCH ()-[r]->()
WHERE r.${quoteIdentifier("__anvia_graph")} = $graph AND (
  r.${quoteIdentifier("__anvia_key")} IN $relationshipKeys OR
  any(id IN coalesce(r.${quoteIdentifier("__anvia_source_document_ids")}, []) WHERE id IN $documentIds)
)
RETURN r.${quoteIdentifier("__anvia_key")} AS key,
       type(r) AS type,
       startNode(r).${quoteIdentifier("__anvia_key")} AS source,
       endNode(r).${quoteIdentifier("__anvia_key")} AS target,
       properties(r) AS properties`,
    {
      graph: graphName,
      relationshipKeys: targets.relationshipKeys,
      documentIds: targets.documentIds,
    },
  );
  const mentionsResult = await transaction.run(
    `MATCH (c:${quoteIdentifier(labels.chunk)})-[:${quoteIdentifier("ANVIA_MENTIONS")}]->(e:${quoteIdentifier(labels.entity)})
OPTIONAL MATCH (d:${quoteIdentifier(labels.document)})-[:${quoteIdentifier("ANVIA_HAS_CHUNK")}]->(c)
WITH c, e, d WHERE d.${quoteIdentifier("__anvia_id")} IN $documentIds OR
  any(item IN $mentions WHERE item.chunkId = c.${quoteIdentifier("__anvia_id")} AND item.entityKey = e.${quoteIdentifier("__anvia_key")})
RETURN c.${quoteIdentifier("__anvia_id")} AS chunkId, e.${quoteIdentifier("__anvia_key")} AS entityKey`,
    { documentIds: targets.documentIds, mentions: targets.mentions },
  );
  return {
    documents: snapshotProperties(documentsResult.records, "document"),
    chunks: snapshotProperties(chunksResult.records, "chunk"),
    entities: snapshotProperties(entitiesResult.records, "entity", true),
    relationships: snapshotRelationships(relationshipsResult.records),
    mentions: snapshotMentions(mentionsResult.records),
  };
}

function snapshotProperties(
  records: readonly Neo4jRecord[],
  resource: string,
  includeLabels = false,
): Map<string, string> {
  const output = new Map<string, string>();
  for (const record of records) {
    const key = requiredString(record.get("key"), `Neo4j ${resource} snapshot key`);
    if (output.has(key))
      throw new TypeError(`Neo4j ${resource} snapshot contains duplicate ${key}.`);
    const properties = normalizedSnapshotProperties(
      record.get("properties"),
      `Neo4j ${resource} snapshot`,
    );
    const labels = includeLabels
      ? requiredStringArray(record.get("labels"), `Neo4j ${resource} snapshot labels`).sort()
      : [];
    output.set(key, stableObject({ labels: labels.join("\u0000"), properties }));
  }
  return output;
}

function snapshotRelationships(records: readonly Neo4jRecord[]): Map<string, string> {
  const output = new Map<string, string>();
  for (const record of records) {
    const key = requiredString(record.get("key"), "Neo4j relationship snapshot key");
    if (output.has(key))
      throw new TypeError(`Neo4j relationship snapshot contains duplicate ${key}.`);
    output.set(
      key,
      stableObject({
        source: requiredString(record.get("source"), "Neo4j relationship snapshot source"),
        target: requiredString(record.get("target"), "Neo4j relationship snapshot target"),
        type: requiredString(record.get("type"), "Neo4j relationship snapshot type"),
        properties: normalizedSnapshotProperties(
          record.get("properties"),
          "Neo4j relationship snapshot",
        ),
      }),
    );
  }
  return output;
}

function snapshotMentions(records: readonly Neo4jRecord[]): Map<string, string> {
  const output = new Map<string, string>();
  for (const record of records) {
    const key = mentionKey(
      requiredString(record.get("chunkId"), "Neo4j mention chunk id"),
      requiredString(record.get("entityKey"), "Neo4j mention entity key"),
    );
    if (output.has(key)) throw new TypeError(`Neo4j mention snapshot contains duplicate ${key}.`);
    output.set(key, key);
  }
  return output;
}

function normalizedSnapshotProperties(value: unknown, label: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} properties must be an object.`);
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    normalized[key] = parseNeo4jPropertyValue(
      normalizeSnapshotDriverValue(item, `${label}.${key}`),
      `${label}.${key}`,
    );
  }
  for (const property of ["__anvia_source_document_ids", "__anvia_source_chunk_ids"]) {
    const items = normalized[property];
    if (items !== undefined) {
      if (!Array.isArray(items) || !items.every((item) => typeof item === "string")) {
        throw new TypeError(`${label}.${property} must be a string array.`);
      }
      normalized[property] = [...new Set(items)].sort();
    }
  }
  return stableObject(normalized);
}

function normalizeSnapshotDriverValue(value: unknown, label: string): unknown {
  if (isInt(value)) {
    if (!value.inSafeRange()) throw new TypeError(`${label} contains an unsafe Neo4j integer.`);
    return value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeSnapshotDriverValue(item, `${label}[${index}]`));
  }
  return value;
}

function mentionKey(chunkId: string, entityKey: string): string {
  return `${chunkId}\u0000${entityKey}`;
}

function diffGraphSnapshots(before: GraphSnapshot, after: GraphSnapshot): Neo4jGraphWriteResult {
  return {
    documents: diffSnapshotMaps(before.documents, after.documents),
    chunks: diffSnapshotMaps(before.chunks, after.chunks),
    entities: diffSnapshotMaps(before.entities, after.entities),
    relationships: diffSnapshotMaps(before.relationships, after.relationships),
    mentions: diffSnapshotMaps(before.mentions, after.mentions),
  };
}

function diffSnapshotMaps(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): Neo4jGraphWriteResult["documents"] {
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let unchanged = 0;
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(key);
    const next = after.get(key);
    if (previous === undefined) created += 1;
    else if (next === undefined) deleted += 1;
    else if (previous === next) unchanged += 1;
    else updated += 1;
  }
  return { created, updated, deleted, unchanged };
}

function emptyWriteResult(): Neo4jGraphWriteResult {
  const empty = () => ({ created: 0, updated: 0, deleted: 0, unchanged: 0 });
  return {
    documents: empty(),
    chunks: empty(),
    entities: empty(),
    relationships: empty(),
    mentions: empty(),
  };
}

async function removeDocuments(
  transaction: GraphTransaction,
  graphName: string,
  labels: { document: string; chunk: string; entity: string },
  documentIds: readonly string[],
  orphanEntities: "delete" | "keep",
): Promise<void> {
  const chunks = await transaction.run(
    `MATCH (d:${quoteIdentifier(labels.document)})-[:${quoteIdentifier("ANVIA_HAS_CHUNK")}]->(c:${quoteIdentifier(labels.chunk)}) WHERE d.${quoteIdentifier("__anvia_id")} IN $documentIds RETURN collect(c.${quoteIdentifier("__anvia_id")}) AS chunkIds`,
    { documentIds },
  );
  const chunkIdsValue = chunks.records[0]?.get("chunkIds");
  const chunkIds = requiredStringArray(chunkIdsValue, "Neo4j replacement chunk ids");
  await transaction.run(
    `MATCH ()-[r]->() WHERE r.${quoteIdentifier("__anvia_graph")} = $graph AND any(id IN r.${quoteIdentifier("__anvia_source_document_ids")} WHERE id IN $documentIds)
SET r.${quoteIdentifier("__anvia_source_document_ids")} = [id IN r.${quoteIdentifier("__anvia_source_document_ids")} WHERE NOT id IN $documentIds]
SET r.${quoteIdentifier("__anvia_source_chunk_ids")} = [id IN coalesce(r.${quoteIdentifier("__anvia_source_chunk_ids")}, []) WHERE NOT id IN $chunkIds]
WITH r WHERE size(r.${quoteIdentifier("__anvia_source_document_ids")}) = 0 DELETE r`,
    { graph: graphName, documentIds, chunkIds },
  );
  await transaction.run(
    `MATCH (d:${quoteIdentifier(labels.document)}) WHERE d.${quoteIdentifier("__anvia_id")} IN $documentIds
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
    {
      graph: graphName,
      documentIds,
      chunkIds,
      deleteOrphans: orphanEntities === "delete",
    },
  );
}

async function writeDocuments(
  transaction: GraphTransaction,
  labels: { document: string },
  documents: readonly { id: string; properties?: Neo4jProperties | undefined }[],
): Promise<void> {
  await transaction.run(
    `UNWIND $rows AS row MERGE (d:${quoteIdentifier(labels.document)} {${quoteIdentifier("__anvia_id")}: row.id}) SET d += row.properties`,
    {
      rows: documents.map((document) => ({
        id: document.id,
        properties: document.properties ?? {},
      })),
    },
  );
}

async function writeChunks(
  transaction: GraphTransaction,
  labels: { document: string; chunk: string },
  chunks: ReplaceNeo4jDocumentsOptions<Neo4jGraphSchema>["chunks"],
): Promise<void> {
  const rows = chunks.map((chunk) => ({
    id: chunk.id,
    documentId: chunk.document.documentId,
    index: chunk.document.index,
    text: chunk.document.text,
    metadata: chunk.document.metadata ?? {},
    embedding: chunk.embeddings[0]?.vector,
  }));
  await transaction.run(
    `UNWIND $rows AS row
MATCH (d:${quoteIdentifier(labels.document)} {${quoteIdentifier("__anvia_id")}: row.documentId})
CREATE (c:${quoteIdentifier(labels.chunk)} {${quoteIdentifier("__anvia_id")}: row.id, ${quoteIdentifier("__anvia_document_id")}: row.documentId, ${quoteIdentifier("__anvia_index")}: row.index, ${quoteIdentifier("__anvia_text")}: row.text, ${quoteIdentifier("__anvia_embedding")}: row.embedding})
SET c += row.metadata
CREATE (d)-[:${quoteIdentifier("ANVIA_HAS_CHUNK")}]->(c)`,
    { rows },
  );
  const pairs = [...rows]
    .sort(
      (left, right) => left.documentId.localeCompare(right.documentId) || left.index - right.index,
    )
    .flatMap((row, index, all) => {
      const next = all[index + 1];
      return next !== undefined && next.documentId === row.documentId
        ? [{ from: row.id, to: next.id }]
        : [];
    });
  if (pairs.length > 0) {
    await transaction.run(
      `UNWIND $rows AS row MATCH (a:${quoteIdentifier(labels.chunk)} {${quoteIdentifier("__anvia_id")}: row.from}), (b:${quoteIdentifier(labels.chunk)} {${quoteIdentifier("__anvia_id")}: row.to}) CREATE (a)-[:${quoteIdentifier("ANVIA_NEXT_CHUNK")}]->(b)`,
      { rows: pairs },
    );
  }
}

async function writeEntities<Schema extends Neo4jGraphSchema>(
  transaction: GraphTransaction,
  graphName: string,
  entityLabel: string,
  entities: ReplaceNeo4jDocumentsOptions<Schema>["entities"],
  conflict: ReplaceNeo4jDocumentsOptions<Schema>["conflict"],
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
    if (conflict === "error") await assertEntityConflicts(transaction, entityLabel, rows);
    const propertySet =
      conflict === "keep-existing"
        ? `ON CREATE SET e += row.properties
WITH e, row,
     coalesce(e.${quoteIdentifier("__anvia_source_document_ids")}, []) AS existingDocumentIds,
     coalesce(e.${quoteIdentifier("__anvia_source_chunk_ids")}, []) AS existingChunkIds`
        : `WITH e, row,
     coalesce(e.${quoteIdentifier("__anvia_source_document_ids")}, []) AS existingDocumentIds,
     coalesce(e.${quoteIdentifier("__anvia_source_chunk_ids")}, []) AS existingChunkIds
${conflict === "overwrite" ? "SET e = row.properties" : "SET e += row.properties"}`;
    await transaction.run(
      `UNWIND $rows AS row
MERGE (e:${quoteIdentifier(entityLabel)}:${quoteIdentifier(type)} {${quoteIdentifier("__anvia_key")}: row.key})
${propertySet}
SET e.${quoteIdentifier("__anvia_key")} = row.key,
    e.${quoteIdentifier("__anvia_graph")} = $graph,
    e.${quoteIdentifier("__anvia_embedding")} = ${conflict === "keep-existing" ? `coalesce(e.${quoteIdentifier("__anvia_embedding")}, row.embedding)` : "row.embedding"},
    e.${quoteIdentifier("__anvia_source_document_ids")} = reduce(all = existingDocumentIds, id IN row.sourceDocumentIds | CASE WHEN id IN all THEN all ELSE all + id END),
    e.${quoteIdentifier("__anvia_source_chunk_ids")} = reduce(all = existingChunkIds, id IN row.sourceChunkIds | CASE WHEN id IN all THEN all ELSE all + id END)`,
      { rows, graph: graphName },
    );
  }
}

async function assertEntityConflicts(
  transaction: GraphTransaction,
  entityLabel: string,
  rows: readonly { key: string; properties: Neo4jProperties }[],
): Promise<void> {
  const result = await transaction.run(
    `UNWIND $keys AS key MATCH (e:${quoteIdentifier(entityLabel)} {${quoteIdentifier("__anvia_key")}: key}) RETURN key, properties(e) AS properties`,
    { keys: rows.map((row) => row.key) },
  );
  const incoming = new Map(rows.map((row) => [row.key, row.properties]));
  for (const record of result.records) {
    const key = requiredString(record.get("key"), "Neo4j entity key");
    const existing = applicationProperties(record.get("properties"));
    if (stableObject(existing) !== stableObject(incoming.get(key) ?? {})) {
      throw new Error(`Neo4j entity ${key} conflicts with existing properties.`);
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
MATCH (c:${quoteIdentifier(labels.chunk)} {${quoteIdentifier("__anvia_id")}: row.chunkId}), (e:${quoteIdentifier(labels.entity)} {${quoteIdentifier("__anvia_key")}: row.entityKey})
MERGE (c)-[:${quoteIdentifier("ANVIA_MENTIONS")}]->(e)`,
    { rows: mentions },
  );
}

async function writeRelationships<Schema extends Neo4jGraphSchema>(
  transaction: GraphTransaction,
  graphName: string,
  entityLabel: string,
  relationships: readonly import("./types.js").Neo4jGraphRelationship<Schema>[],
  conflict: ReplaceNeo4jDocumentsOptions<Schema>["conflict"],
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
        `UNWIND $keys AS key MATCH ()-[r:${quoteIdentifier(type)} {${quoteIdentifier("__anvia_key")}: key}]->() RETURN key, properties(r) AS properties`,
        { keys: rows.map((row) => row.key) },
      );
      const incoming = new Map(rows.map((row) => [row.key, row.properties]));
      for (const record of existing.records) {
        const key = requiredString(record.get("key"), "Neo4j relationship key");
        if (
          stableObject(applicationProperties(record.get("properties"))) !==
          stableObject(incoming.get(key) ?? {})
        ) {
          throw new Error(`Neo4j relationship ${key} conflicts with existing properties.`);
        }
      }
    }
    const propertySet =
      conflict === "keep-existing"
        ? `ON CREATE SET r += row.properties
WITH r, row,
     coalesce(r.${quoteIdentifier("__anvia_source_document_ids")}, []) AS existingDocumentIds,
     coalesce(r.${quoteIdentifier("__anvia_source_chunk_ids")}, []) AS existingChunkIds`
        : `WITH r, row,
     coalesce(r.${quoteIdentifier("__anvia_source_document_ids")}, []) AS existingDocumentIds,
     coalesce(r.${quoteIdentifier("__anvia_source_chunk_ids")}, []) AS existingChunkIds
${conflict === "overwrite" ? "SET r = row.properties" : "SET r += row.properties"}`;
    await transaction.run(
      `UNWIND $rows AS row
MATCH (a:${quoteIdentifier(entityLabel)} {${quoteIdentifier("__anvia_key")}: row.from}), (b:${quoteIdentifier(entityLabel)} {${quoteIdentifier("__anvia_key")}: row.to})
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

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  return value;
}

function applicationProperties(value: unknown): Neo4jProperties {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return parseNeo4jProperties(
    Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("__anvia_"))),
    "stored Neo4j properties",
  );
}

function groupBy<Value, Key>(
  values: readonly Value[],
  keyFor: (value: Value) => Key,
): Map<Key, Value[]> {
  const groups = new Map<Key, Value[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [value]);
    else group.push(value);
  }
  return groups;
}
