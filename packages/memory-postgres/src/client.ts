import { PostgresMemoryStore, postgresMemoryStoreFactory } from "./store.js";
import type {
  PostgresMemoryClientLike,
  PostgresMemoryClientOptions,
  PostgresMemoryPoolLike,
  PostgresMemoryStoreOptions,
} from "./types.js";

export class PostgresMemoryClient implements AsyncDisposable {
  private readonly injected: PostgresMemoryClientLike | undefined;
  private clientPromise: Promise<PostgresMemoryClientLike> | undefined;
  private closePromise: Promise<void> | undefined;
  private closed = false;

  constructor(private readonly options: PostgresMemoryClientOptions) {
    const hasClient = options.client !== undefined;
    const hasConnectionString = options.connectionString !== undefined;
    if (hasClient === hasConnectionString) {
      throw new TypeError(
        "PostgresMemoryClient requires exactly one of connectionString or client.",
      );
    }
    this.injected = options.client;
  }

  memoryStore(options: PostgresMemoryStoreOptions = {}): PostgresMemoryStore {
    this.assertOpen();
    return PostgresMemoryStore[postgresMemoryStoreFactory]({
      owner: this,
      options,
    });
  }

  nativeClient(): Promise<PostgresMemoryClientLike> {
    this.assertOpen();
    if (this.clientPromise !== undefined) {
      return this.clientPromise;
    }

    const initialization =
      this.injected === undefined
        ? defaultPgClient(this.connectionString())
        : Promise.resolve(this.injected);
    this.clientPromise = initialization;
    void initialization.catch(() => {
      if (this.clientPromise === initialization && !this.closed) {
        this.clientPromise = undefined;
      }
    });
    return initialization;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }

    this.closed = true;
    const initialization = this.clientPromise;
    this.closePromise =
      this.injected !== undefined || initialization === undefined
        ? Promise.resolve()
        : initialization.then(async (client) => {
            await client.end?.();
          });
    return this.closePromise;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private connectionString(): string {
    const connectionString = this.options.connectionString;
    if (connectionString === undefined) {
      throw new TypeError("PostgresMemoryClient requires either connectionString or client.");
    }
    return connectionString;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("PostgresMemoryClient is closed.");
    }
  }
}

async function defaultPgClient(connectionString: string): Promise<PostgresMemoryPoolLike> {
  const pg = await import("pg");
  return new pg.Pool({ connectionString });
}
