import { auth, driver as createDriver, type Driver } from "neo4j-driver";
import { ManagedMemgraphKnowledgeGraph, MemgraphKnowledgeGraph } from "./graph.js";
import type {
  ManagedMemgraphKnowledgeGraphOptions,
  MemgraphClientOptions,
  MemgraphKnowledgeGraphOptions,
} from "./types.js";
import type { GraphSchemaLike } from "@anvia/graph";

export class MemgraphClient {
  private readonly driver: Driver;
  private readonly ownsDriver: boolean;
  private closed = false;
  readonly database: string | undefined;

  constructor(options: MemgraphClientOptions) {
    this.database = options.database;
    if ("driver" in options) {
      this.driver = options.driver;
      this.ownsDriver = false;
      return;
    }
    if (typeof options.uri !== "string" || options.uri.length === 0) {
      throw new TypeError("MemgraphClient uri must be a non-empty string.");
    }
    const credentials = options.auth ?? { username: "", password: "" };
    if (typeof credentials.username !== "string" || typeof credentials.password !== "string") {
      throw new TypeError("MemgraphClient credentials must be strings.");
    }
    this.driver = createDriver(options.uri, auth.basic(credentials.username, credentials.password));
    this.ownsDriver = true;
  }

  managedKnowledgeGraph<Schema extends GraphSchemaLike>(
    options: ManagedMemgraphKnowledgeGraphOptions<Schema>,
  ): ManagedMemgraphKnowledgeGraph<Schema> {
    this.assertOpen();
    return new ManagedMemgraphKnowledgeGraph(this, options);
  }

  knowledgeGraph<Schema extends GraphSchemaLike>(
    options: MemgraphKnowledgeGraphOptions<Schema>,
  ): MemgraphKnowledgeGraph<Schema> {
    this.assertOpen();
    return new MemgraphKnowledgeGraph(this, options);
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
    if (this.closed) throw new Error("MemgraphClient is closed.");
  }
}
