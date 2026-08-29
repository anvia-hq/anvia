import { createHash } from "node:crypto";
import { auth, driver as createDriver, type Driver } from "neo4j-driver";
import {
  ManagedNeo4jKnowledgeGraph,
  neo4jTenantScope,
  Neo4jKnowledgeGraph,
  type Neo4jTenantScope,
} from "./graph.js";
import type {
  ManagedNeo4jKnowledgeGraphOptions,
  Neo4jClientOptions,
  Neo4jGraphSchema,
  Neo4jKnowledgeGraphOptions,
} from "./types.js";

export class Neo4jClient {
  private readonly driver: Driver;
  private readonly ownsDriver: boolean;
  private closed = false;
  readonly database: string | undefined;

  constructor(options: Neo4jClientOptions) {
    this.database = options.database;
    if ("driver" in options) {
      this.driver = options.driver;
      this.ownsDriver = false;
    } else {
      if (typeof options.uri !== "string" || options.uri.length === 0) {
        throw new TypeError("Neo4jClient uri must be a non-empty string.");
      }
      if (
        typeof options.auth.username !== "string" ||
        options.auth.username.length === 0 ||
        typeof options.auth.password !== "string"
      ) {
        throw new TypeError("Neo4jClient requires explicit username and password credentials.");
      }
      this.driver = createDriver(
        options.uri,
        auth.basic(options.auth.username, options.auth.password),
      );
      this.ownsDriver = true;
    }
  }

  managedKnowledgeGraph<Schema extends Neo4jGraphSchema>(
    options: ManagedNeo4jKnowledgeGraphOptions<Schema>,
  ): ManagedNeo4jKnowledgeGraph<Schema> {
    this.assertOpen();
    return new ManagedNeo4jKnowledgeGraph(this, options);
  }

  tenant(tenantId: string): Neo4jTenant {
    this.assertOpen();
    return new Neo4jTenant(this, neo4jTenantScope(tenantNamespace(tenantId)));
  }

  knowledgeGraph<Schema extends Neo4jGraphSchema>(
    options: Neo4jKnowledgeGraphOptions<Schema>,
  ): Neo4jKnowledgeGraph<Schema> {
    this.assertOpen();
    return new Neo4jKnowledgeGraph(this, options);
  }

  nativeDriver(): Driver {
    this.assertOpen();
    return this.driver;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.ownsDriver) await this.driver.close();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Neo4jClient is closed.");
  }
}

export class Neo4jTenant {
  constructor(
    private readonly owner: Neo4jClient,
    private readonly scope: Neo4jTenantScope,
  ) {}

  get namespace(): string {
    return this.scope.namespace;
  }

  managedKnowledgeGraph<Schema extends Neo4jGraphSchema>(
    options: ManagedNeo4jKnowledgeGraphOptions<Schema>,
  ): ManagedNeo4jKnowledgeGraph<Schema> {
    this.owner.nativeDriver();
    return new ManagedNeo4jKnowledgeGraph(this.owner, options, this.scope);
  }
}

function tenantNamespace(tenantId: string): string {
  if (typeof tenantId !== "string" || tenantId.trim().length === 0)
    throw new TypeError("Neo4j tenant id must be a non-empty string.");
  return createHash("sha256").update(tenantId).digest("hex");
}
