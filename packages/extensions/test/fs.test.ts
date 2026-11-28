import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filesystem } from "../src/tools/fs";

describe("filesystem toolkit", () => {
  let rootDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "anvia-ext-fs-"));
    outsideDir = await mkdtemp(path.join(os.tmpdir(), "anvia-ext-outside-"));
    await writeFile(path.join(outsideDir, "secret.txt"), "top-secret", "utf8");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("supports write, read with paging, edit (including $ patterns), list, grep, ..-prefixed names, and delete", async () => {
    const kit = filesystem({ rootDir });
    const byName = new Map(kit.tools.map((t) => [t.name, t]));

    expect(byName.get("write_file")?.requiresApproval).toBeUndefined();
    expect(byName.get("edit_file")?.requiresApproval).toBeUndefined();
    expect(byName.get("delete_file")?.requiresApproval).toEqual({
      reason: "Deleting a workspace file requires approval.",
    });

    await byName.get("write_file")!.call({
      path: "..env",
      content: "PRICE=$100",
    });
    expect(await readFile(path.join(rootDir, "..env"), "utf8")).toBe("PRICE=$100");

    await byName.get("write_file")!.call({
      path: "notes/plan.txt",
      content: "line1\nhello world\nline3",
    });

    const readRes = (await byName.get("read_file")!.call({
      path: "notes/plan.txt",
      offset: 2,
      limit: 1,
    })) as { content: string; truncated: boolean };
    expect(readRes.content).toBe("hello world");
    expect(readRes.truncated).toBe(true);

    const editRes = (await byName.get("edit_file")!.call({
      path: "notes/plan.txt",
      oldText: "hello world",
      newText: "price $$10 and $& literal",
    })) as { replacements: number };
    expect(editRes.replacements).toBe(1);
    expect(await readFile(path.join(rootDir, "notes/plan.txt"), "utf8")).toContain(
      "price $$10 and $& literal",
    );

    const listRes = (await byName.get("list_files")!.call({ recursive: true })) as {
      entries: Array<{ path: string; type: string }>;
    };
    expect(listRes.entries).toEqual([
      { path: "..env", type: "file" },
      { path: "notes", type: "directory" },
      { path: "notes/plan.txt", type: "file" },
    ]);

    const grepRes = (await byName.get("grep")!.call({ pattern: "$$10" })) as {
      matches: Array<{ path: string; line: number; text: string }>;
    };
    expect(grepRes.matches).toEqual([
      { path: "notes/plan.txt", line: 2, text: "price $$10 and $& literal" },
    ]);

    const delRes = (await byName.get("delete_file")!.call({ path: "notes/plan.txt" })) as {
      deleted: boolean;
    };
    expect(delRes.deleted).toBe(true);
  });

  it("blocks path traversal, symlink escapes, dangling symlink writes, and deleting symlinks", async () => {
    await writeFile(path.join(rootDir, "important.txt"), "keep me", "utf8");
    await symlink(path.join(rootDir, "important.txt"), path.join(rootDir, "internal-link.txt"));
    await symlink(path.join(outsideDir, "secret.txt"), path.join(rootDir, "escape-link.txt"));
    await symlink(outsideDir, path.join(rootDir, "escape-dir"));
    await symlink(
      path.join(outsideDir, "dangling-target.txt"),
      path.join(rootDir, "dangling-link.txt"),
    );

    const kit = filesystem({ rootDir });
    const byName = new Map(kit.tools.map((t) => [t.name, t]));

    await expect(byName.get("read_file")!.call({ path: "../secret.txt" })).rejects.toThrow(
      /escapes the configured rootDir/,
    );
    await expect(byName.get("read_file")!.call({ path: "escape-link.txt" })).rejects.toThrow(
      /resolves outside rootDir/,
    );
    await expect(
      byName.get("write_file")!.call({ path: "escape-dir/pwn.txt", content: "nope" }),
    ).rejects.toThrow(/resolves outside rootDir/);
    await expect(
      byName.get("write_file")!.call({ path: "dangling-link.txt", content: "escaped" }),
    ).rejects.toThrow(/dangling symlink/);
    await expect(byName.get("delete_file")!.call({ path: "internal-link.txt" })).rejects.toThrow(
      /Refusing to delete symlink/,
    );
    expect(await readFile(path.join(rootDir, "important.txt"), "utf8")).toBe("keep me");
  });

  it("clips oversized grep lines, surfaces invalid regex errors, and respects abortSignal", async () => {
    await writeFile(path.join(rootDir, "bigline.txt"), `needle:${"z".repeat(200)}`, "utf8");
    const kit = filesystem({ rootDir, maxMatchLineChars: 40 });
    const grepTool = kit.tools.find((t) => t.name === "grep")!;

    const res = (await grepTool.call({ pattern: "needle" })) as {
      matches: Array<{ text: string }>;
    };
    expect(res.matches[0]?.text.length).toBeLessThanOrEqual(40);

    await expect(grepTool.call({ pattern: "[unterminated", regex: true })).rejects.toThrow(
      /Invalid grep regular expression/,
    );

    const aborted = new AbortController();
    aborted.abort(new Error("cancelled by test"));
    await expect(
      grepTool.call({ pattern: "needle" }, { abortSignal: aborted.signal }),
    ).rejects.toThrow(/cancelled by test/);
  });

  it("omits mutating tools when readOnly is true", () => {
    const kit = filesystem({ rootDir, readOnly: true });
    expect(kit.tools.map((t) => t.name)).toEqual(["read_file", "list_files", "grep"]);
  });
});
