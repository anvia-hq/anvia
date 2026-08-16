import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { SqliteMemoryStore, sqliteMemoryStoreFactory } from "./store.js";
import type {
  SqliteMemoryClientOptions,
  SqliteMemoryDatabaseLike,
  SqliteMemoryStoreOptions,
} from "./types.js";

type DatabaseSyncConstructor = typeof DatabaseSyncType;

let DatabaseSync: DatabaseSyncConstructor | undefined;

export const sqliteMemoryExistingClient = Symbol("SqliteMemoryClient.existingClient");

export class SqliteMemoryClient implements AsyncDisposable {
  private readonly injected: SqliteMemoryDatabaseLike | undefined;
  private clientPromise: Promise<SqliteMemoryDatabaseLike> | undefined;
  private closePromise: Promise<void> | undefined;
  private closed = false;

  constructor(private readonly options: SqliteMemoryClientOptions) {
    const hasDatabase = options.database !== undefined;
    const hasPath = options.path !== undefined;
    if (hasDatabase === hasPath) {
      throw new TypeError("SqliteMemoryClient requires exactly one of path or database.");
    }
    this.injected = options.database;
  }

  memoryStore(options: SqliteMemoryStoreOptions = {}): SqliteMemoryStore {
    this.assertOpen();
    return SqliteMemoryStore[sqliteMemoryStoreFactory]({
      owner: this,
      options,
    });
  }

  nativeClient(): Promise<SqliteMemoryDatabaseLike> {
    this.assertOpen();
    if (this.clientPromise !== undefined) {
      return this.clientPromise;
    }

    const initialization = Promise.resolve().then(() => this.createDatabase());
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
        : initialization.then((database) => {
            database.close();
          });
    return this.closePromise;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  [sqliteMemoryExistingClient](): Promise<SqliteMemoryDatabaseLike> {
    this.assertOpen();
    if (this.injected !== undefined || this.clientPromise !== undefined) {
      return this.nativeClient();
    }

    const path = this.options.path;
    if (path === undefined || path === ":memory:" || !existsSync(path)) {
      throw new Error("Sqlite memory database does not exist. Call store.ensure() first.");
    }
    return this.nativeClient();
  }

  private createDatabase(): SqliteMemoryDatabaseLike {
    if (this.injected !== undefined) {
      return this.injected;
    }

    const path = this.options.path;
    if (path === undefined) {
      throw new TypeError("SqliteMemoryClient requires either path or database.");
    }
    if (path !== ":memory:") {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    return new (databaseSync())(path, { enableForeignKeyConstraints: true });
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("SqliteMemoryClient is closed.");
    }
  }
}

function databaseSync(): DatabaseSyncConstructor {
  if (DatabaseSync !== undefined) {
    return DatabaseSync;
  }

  const require = createRequire(import.meta.url);
  try {
    const sqlite = require("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor };
    DatabaseSync = sqlite.DatabaseSync;
    return DatabaseSync;
  } catch (error) {
    throw new Error("@anvia/memory-sqlite requires a Node.js runtime with node:sqlite support.", {
      cause: error,
    });
  }
}
