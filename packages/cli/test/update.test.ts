import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  closestRegistryItemName,
  inspectInstalledItems,
  registryItemNames,
  updateInstalledItems,
} from "../src";

const registryDirectory = join(import.meta.dirname, "../registry");

function createProject(options: { components?: boolean } = {}): string {
  const cwd = mkdtempSync(join(tmpdir(), "anvia-update-"));
  writeFileSync(
    join(cwd, "components.json"),
    `${JSON.stringify({ aliases: { components: "@/components" } }, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, "tsconfig.json"),
    `${JSON.stringify(
      { compilerOptions: { paths: { "@/components/*": ["./src/components/*"] } } },
      null,
      2,
    )}\n`,
  );
  if (options.components !== false) {
    mkdirSync(join(cwd, "src/components/anvia"), { recursive: true });
  }
  return cwd;
}

function installedPath(cwd: string, filename: string): string {
  return join(cwd, "src/components/anvia", filename);
}

function registryContent(filename: string): string {
  return readFileSync(join(registryDirectory, filename), "utf8");
}

function itemReport(cwd: string, name: "composer" | "markdown") {
  const report = inspectInstalledItems({ cwd, items: [name], registryDirectory });
  expect(report).toHaveLength(1);
  const item = report[0];
  if (item === undefined) throw new Error("missing report item");
  return item;
}

describe("closestRegistryItemName", () => {
  it("suggests near matches and ignores distant ones", () => {
    expect(closestRegistryItemName("thred")).toBe("thread");
    expect(closestRegistryItemName("compser")).toBe("composer");
    expect(closestRegistryItemName("completely-unrelated")).toBeUndefined();
  });
});

describe("inspectInstalledItems", () => {
  it("requires a configured project", () => {
    const cwd = mkdtempSync(join(tmpdir(), "anvia-update-"));
    expect(() => inspectInstalledItems({ cwd, registryDirectory })).toThrow("components.json");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reports items as not installed in a fresh project", () => {
    const cwd = createProject();
    const report = inspectInstalledItems({ cwd, registryDirectory });
    expect(report).toHaveLength(registryItemNames.length);
    expect(report.every((item) => !item.installed && !item.complete)).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("detects up-to-date, modified, and missing files", () => {
    const cwd = createProject();
    writeFileSync(installedPath(cwd, "attachment.tsx"), registryContent("attachment.tsx"));
    writeFileSync(installedPath(cwd, "composer.tsx"), "// locally edited\n");
    const composer = itemReport(cwd, "composer");
    expect(composer.files.map((file) => [file.filename, file.status])).toEqual([
      ["attachment.tsx", "up-to-date"],
      ["composer.tsx", "modified"],
    ]);
    expect(composer.installed).toBe(true);
    expect(composer.complete).toBe(true);
    const message = inspectInstalledItems({
      cwd,
      items: ["message"],
      registryDirectory,
    })[0];
    if (message === undefined) throw new Error("missing report item");
    expect(message.files.map((file) => file.status)).toEqual([
      "up-to-date",
      "missing",
      "missing",
      "missing",
    ]);
    expect(message.complete).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("updateInstalledItems", () => {
  it("does not write anything by default", () => {
    const cwd = createProject();
    writeFileSync(installedPath(cwd, "markdown.tsx"), "// old\n");
    const { updated } = updateInstalledItems({
      cwd,
      items: ["markdown"],
      registryDirectory,
    });
    expect(updated).toEqual([]);
    expect(readFileSync(installedPath(cwd, "markdown.tsx"), "utf8")).toBe("// old\n");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("overwrites out-of-date and missing files, then reports up to date", () => {
    const cwd = createProject();
    writeFileSync(installedPath(cwd, "markdown.tsx"), "// old\n");
    const { updated } = updateInstalledItems({
      cwd,
      items: ["markdown"],
      overwrite: true,
      registryDirectory,
    });
    expect(updated).toEqual([installedPath(cwd, "markdown.tsx")]);
    const item = itemReport(cwd, "markdown");
    expect(item.files.every((file) => file.status === "up-to-date")).toBe(true);
    expect(item.complete).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });
});
