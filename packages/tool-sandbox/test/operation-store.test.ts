import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationStore } from "../src/daemon/operations";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function store(maxEntries?: number, maxStoredResultBytes?: number) {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvia-ops-"));
  directories.push(root);
  const directory = path.join(root, "ops");
  return {
    directory,
    store: new OperationStore({ directory, maxEntries, maxStoredResultBytes }),
    reopen: () => new OperationStore({ directory, maxEntries, maxStoredResultBytes }),
  };
}

const request = { method: "exec", params: { command: "true" } };

describe("OperationStore", () => {
  it("bounds the on-disk table and re-executes evicted operations", async () => {
    const { directory, store: operations } = await store(4);
    let executions = 0;
    const run = (id: string) =>
      operations.run(id, request, async () => {
        executions += 1;
        return { id };
      });

    for (let index = 0; index < 12; index += 1) {
      await run(`op-${index}`);
      // Distinct modification times keep eviction order deterministic.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".json")).length,
    ).toBeLessThanOrEqual(4);
    expect(executions).toBe(12);

    await run("op-11");
    expect(executions).toBe(12);
    await run("op-0");
    expect(executions).toBe(13);
  });

  it("does not store failures", async () => {
    const { store: operations } = await store();
    let attempts = 0;
    const run = () =>
      operations.run("op", request, async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("boom");
        return "ok";
      });
    await expect(run()).rejects.toThrow("boom");
    await expect(run()).resolves.toBe("ok");
    await expect(run()).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("treats parameter key order as the same request", async () => {
    const { store: operations } = await store();
    let executions = 0;
    const execute = async () => {
      executions += 1;
      return executions;
    };
    await operations.run("op", { method: "exec", params: { a: 1, b: 2 } }, execute);
    await operations.run("op", { method: "exec", params: { b: 2, a: 1 } }, execute);
    expect(executions).toBe(1);
  });

  it("keeps non-durable results in memory only", async () => {
    const { directory, store: operations, reopen } = await store();
    let executions = 0;
    const execute = async () => {
      executions += 1;
      return { executions };
    };
    await operations.run("op", request, execute, { durable: false });
    await operations.run("op", request, execute, { durable: false });
    expect(executions).toBe(1);
    await expect(readdir(directory)).rejects.toMatchObject({ code: "ENOENT" });

    // A new store stands in for a restarted daemon: the in-memory result is gone.
    await reopen().run("op", request, execute, { durable: false });
    expect(executions).toBe(2);
  });

  it("bounds non-durable results by entry count", async () => {
    const { store: operations } = await store(2);
    let executions = 0;
    const run = (id: string) =>
      operations.run(
        id,
        request,
        async () => {
          executions += 1;
        },
        { durable: false },
      );
    await run("a");
    await run("b");
    await run("c");
    await run("c");
    expect(executions).toBe(3);
    await run("a");
    expect(executions).toBe(4);
  });

  it("refuses to re-run an operation whose result was too large to store", async () => {
    const { directory, store: operations, reopen } = await store(undefined, 200);
    let executions = 0;
    const big = "x".repeat(1_000);
    const execute = async () => {
      executions += 1;
      return { big };
    };
    const [first, joined] = await Promise.all([
      operations.run("op", request, execute),
      operations.run("op", request, execute),
    ]);
    expect(first.big).toBe(big);
    expect(joined.big).toBe(big);

    for (const candidate of [operations, reopen()]) {
      await expect(candidate.run("op", request, execute)).rejects.toMatchObject({
        code: "invalid_state",
      });
    }
    expect(executions).toBe(1);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    expect(files).toHaveLength(1);
  });

  it("rejects non-positive bounds", () => {
    expect(() => new OperationStore({ directory: "/tmp/x", maxEntries: 0 })).toThrow(RangeError);
    expect(() => new OperationStore({ directory: "/tmp/x", maxStoredResultBytes: 0 })).toThrow(
      RangeError,
    );
  });
});
