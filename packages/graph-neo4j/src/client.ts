import { auth, driver as createDriver, type Driver } from "neo4j-driver";
import { ManagedNeo4jKnowledgeGraph, Neo4jKnowledgeGraph } from "./graph.js";
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
