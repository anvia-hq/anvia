import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationStore } from "../src/daemon/operations";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function store(maxEntries?: number) {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvia-ops-"));
  directories.push(root);
  const directory = path.join(root, "ops");
  return { directory, store: new OperationStore({ directory, maxEntries }) };
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

  it("rejects non-positive bounds", () => {
    expect(() => new OperationStore({ directory: "/tmp/x", maxEntries: 0 })).toThrow(RangeError);
  });
});
