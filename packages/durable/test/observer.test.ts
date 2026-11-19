import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableObserver, DurableRuntime } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, makeAgent } from "./helpers.js";
import { itSqlite } from "./helpers/backend.js";

const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-observer-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

async function owner(path: string) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent: makeAgent(async () => done()), version: "1" }],
  });
  closers.push(() => runtime.close());
  return runtime;
}

async function observe(path: string) {
  const observer = await DurableObserver.connect({
    store: new SqliteDurableStore(path, { readOnly: true }),
  });
  closers.push(() => observer.close());
  return observer;
}

describe("durable observer", () => {
  it("observes a run executed by another runtime that owns the database", async () => {
    const path = database();
    const runtime = await owner(path);
    const observer = await observe(path);
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });

    const view = await observer.getRun(run.id);
    const types: string[] = [];
    for await (const event of view.stream()) types.push(event.type);
    expect(types).toContain("submitted");
    expect(types).toContain("model_completed");
    expect(await view.result()).toMatchObject({ type: "response", output: "done" });
    expect((await view.status()).status).toBe("completed");
    expect((await view.snapshot()).run.id).toBe(run.id);
    expect((await observer.listRuns({ sessionId: "s" })).runs.map((r) => r.id)).toEqual([run.id]);
  });

  it("exposes no mutation and its store rejects writes", async () => {
    const path = database();
    const runtime = await owner(path);
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    await run.result();

    const store = new SqliteDurableStore(path, { readOnly: true });
    await store.connect();
    closers.push(() => store.close());
    await expect(
      store.transaction((tx) => tx.appendEvent(run.id, "status", { forged: true })),
    ).rejects.toThrow();

    const observer = await observe(path);
    const view = await observer.getRun(run.id);
    for (const method of ["cancel", "retry", "steer", "respond", "resolveTool"])
      expect((view as unknown as Record<string, unknown>)[method]).toBeUndefined();
    expect((await runtime.status(run.id)).status).toBe("completed");
  });

  it("does not take or release the owner's ownership", async () => {
    const path = database();
    await owner(path);
    const observer = await observe(path);
    await observer.close();
    // The owner is still live, so a second owner is still refused after the observer closed.
    await expect(DurableRuntime.open({ store: new SqliteDurableStore(path) })).rejects.toThrow(
      /live owner/,
    );
  });

  it("cannot be used as an owner, and an owner cannot be observed through the same instance", async () => {
    const path = database();
    await owner(path); // sets up the schema; an observer never creates it
    const store = new SqliteDurableStore(path, { readOnly: true });
    await store.connect();
    closers.push(() => store.close());
    await expect(store.acquire()).rejects.toThrow(/already acquired|can only be connected/);
    await expect(store.connect()).rejects.toThrow(/already open/);
  });

  it("rejects reads after close", async () => {
    const path = database();
    await owner(path);
    const observer = await observe(path);
    await observer.close();
    await expect(observer.listRuns()).rejects.toThrow(/closed/);
  });

  itSqlite(
    "refuses connect() on a writable store, whose constructor already created the schema",
    async () => {
      const path = database();
      await owner(path);
      const store = new SqliteDurableStore(path);
      closers.push(() => store.close());
      await expect(store.connect()).rejects.toThrow(/readOnly: true/);
    },
  );

  itSqlite("does not create a database or schema for a path that does not exist", async () => {
    const path = database();
    expect(() => new SqliteDurableStore(path, { readOnly: true })).toThrow();
    expect(existsSync(path)).toBe(false);
  });

  itSqlite("refuses an existing file that has no durable schema", async () => {
    const path = database();
    new DatabaseSync(path).close();
    expect(() => new SqliteDurableStore(path, { readOnly: true })).toThrow(/no schema/);
  });

  itSqlite("a read-only store cannot be acquired as an owner", async () => {
    const path = database();
    await owner(path);
    const store = new SqliteDurableStore(path, { readOnly: true });
    closers.push(() => store.close());
    await expect(store.acquire()).rejects.toThrow(/can only be connected/);
  });

  itSqlite("refuses a database that has not been upgraded to the current schema", async () => {
    const path = database();
    new SqliteDurableStore(path).close(); // creates the tables
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE anvia_durable_owner SET version = 11 WHERE singleton = 1").run();
    raw.close();
    await expect(
      DurableObserver.connect({ store: new SqliteDurableStore(path, { readOnly: true }) }),
    ).rejects.toThrow(/schema version/);
  });
});
