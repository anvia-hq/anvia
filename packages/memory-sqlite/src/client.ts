import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { SqliteMemoryStore, sqliteMemoryStoreFactory } from "./store.js";
import type {
  SqliteMemoryClientOptions,
  SqliteMemoryDatabaseLike,
  SqliteMemoryStoreOptions,
} from "./types.js";

type SyncDatabaseConstructor = new (
  path: string,
  options?: { enableForeignKeyConstraints?: boolean },
) => SqliteMemoryDatabaseLike;

let DatabaseSync: SyncDatabaseConstructor | undefined;

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
    const database = isBunDriver()
      ? // bun:sqlite rejects node-only open options such as
        // enableForeignKeyConstraints with SQLITE_MISUSE, and it has no
        // equivalent, so open with defaults instead.
        new (databaseSync())(path)
      : new (databaseSync())(path, { enableForeignKeyConstraints: true });
    // bun:sqlite defaults to foreign keys OFF and has no open-time option, so
    // the store's foreign-key validation would fail on it. Enforce the pragma
    // directly; node:sqlite is already ON, making this a no-op there.
    database.exec("PRAGMA foreign_keys = ON");
    return database;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("SqliteMemoryClient is closed.");
    }
  }
}

function databaseSync(): SyncDatabaseConstructor {
  if (DatabaseSync !== undefined) {
    return DatabaseSync;
  }

  const require = createRequire(import.meta.url);
  const bun = loadBunSqlite(require);
  if (bun !== undefined) {
    DatabaseSync = bun.Database;
    return DatabaseSync;
  }

  try {
    const sqlite = require("node:sqlite") as { DatabaseSync: SyncDatabaseConstructor };
    DatabaseSync = sqlite.DatabaseSync;
    return DatabaseSync;
  } catch (error) {
    throw new Error(
      "@anvia/memory-sqlite requires a runtime with node:sqlite or bun:sqlite support.",
      { cause: error },
    );
  }
}

function loadBunSqlite(require: NodeJS.Require): { Database: SyncDatabaseConstructor } | undefined {
  if (!isBunDriver()) {
    return undefined;
  }
  try {
    return require("bun:sqlite") as { Database: SyncDatabaseConstructor };
  } catch {
    // Fall through to node:sqlite and surface its loading error instead.
    return undefined;
  }
}

function isBunDriver(): boolean {
  return process.versions.bun !== undefined;
}
