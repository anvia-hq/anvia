import { backup, DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SqliteDurableStore } from "./sqlite.js";

export type DurableBackupInfo = { createdAt: string; schemaVersion: number };

function validate(db: DatabaseSync): void {
  if (db.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok")
    throw new Error("Durable database integrity check failed.");
  const version = db
    .prepare("SELECT version FROM anvia_durable_owner WHERE singleton = 1")
    .get()?.version;
  if (
    version !== 3 &&
    version !== 4 &&
    version !== 5 &&
    version !== 6 &&
    version !== 7 &&
    version !== 8 &&
    version !== 9
  )
    throw new Error("Maintenance requires durable schema version 3, 4, 5, 6, 7, 8, or 9.");
}
function sync(path: string): void {
  // Windows maps fsync to _commit(), which fails with EPERM on a read-only handle;
  // POSIX fsyncs directories through a read-only handle and cannot open them writable (EISDIR).
  const fd = openSync(path, process.platform === "win32" ? "r+" : "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function assertDestination(path: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    if (lstatSync(path + suffix, { throwIfNoEntry: false }) !== undefined)
      throw Object.assign(
        new Error("Backup/restore destination and SQLite sidecars must not exist."),
        { code: "EEXIST" },
      );
}

/** Publishes a sealed SQLite snapshot without replacing any existing destination. */
async function copy(
  source: DatabaseSync,
  destination: string,
  prepare: (db: DatabaseSync) => void,
): Promise<void> {
  const path = resolve(destination);
  assertDestination(path);
  const directory = mkdtempSync(join(dirname(path), ".anvia-backup-"));
  const temporary = join(directory, "snapshot.sqlite");
  try {
    closeSync(openSync(temporary, "wx", 0o600));
    await backup(source, temporary);
    chmodSync(temporary, 0o600);
    const db = new DatabaseSync(temporary);
    try {
      db.exec("PRAGMA synchronous = FULL");
      validate(db);
      prepare(db);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    } finally {
      db.close();
    }
    sync(temporary);
    assertDestination(path);
    linkSync(temporary, path); // Atomic, and EEXIST rather than replacing a database or symlink.
    sync(dirname(path));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Offline only: close the runtime first. Acquires its ownership lock throughout the backup. */
export async function backupSqlite(
  source: string,
  destination: string,
): Promise<DurableBackupInfo> {
  if (!statSync(source).isFile())
    throw new TypeError("Backup source must be an existing database file.");
  const validation = new DatabaseSync(source, { readOnly: true });
  try {
    validate(validation);
  } finally {
    validation.close();
  }
  const owner = new SqliteDurableStore(source);
  try {
    owner.acquire();
    const db = new DatabaseSync(source, { readOnly: true });
    const info = { createdAt: new Date().toISOString(), schemaVersion: 9 };
    try {
      await copy(db, destination, (snapshot) => {
        snapshot.exec(
          "UPDATE anvia_durable_owner SET token = NULL, pid = NULL, host = NULL WHERE singleton = 1; CREATE TABLE anvia_durable_backup (metadata TEXT NOT NULL)",
        );
        snapshot.prepare("INSERT INTO anvia_durable_backup VALUES (?)").run(JSON.stringify(info));
      });
    } finally {
      db.close();
    }
    return info;
  } finally {
    owner.close();
  }
}

/** Restore a sealed backup into a NEW file. Never run original and restored deployments together. */
export async function restoreSqlite(
  source: string,
  destination: string,
): Promise<DurableBackupInfo> {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    validate(db);
    const row = db.prepare("SELECT metadata FROM anvia_durable_backup").get();
    const info = JSON.parse(String(row?.metadata)) as DurableBackupInfo;
    if (
      (info.schemaVersion !== 3 &&
        info.schemaVersion !== 4 &&
        info.schemaVersion !== 5 &&
        info.schemaVersion !== 6 &&
        info.schemaVersion !== 7 &&
        info.schemaVersion !== 8 &&
        info.schemaVersion !== 9) ||
      info.schemaVersion !==
        db.prepare("SELECT version FROM anvia_durable_owner WHERE singleton = 1").get()?.version ||
      typeof info.createdAt !== "string" ||
      !Number.isFinite(Date.parse(info.createdAt))
    )
      throw new Error("Invalid durable backup metadata.");
    await copy(db, destination, (snapshot) => {
      snapshot.exec(
        "DROP TABLE anvia_durable_backup; UPDATE anvia_durable_owner SET token = NULL, pid = NULL, host = NULL WHERE singleton = 1",
      );
    });
    return info;
  } finally {
    db.close();
  }
}
