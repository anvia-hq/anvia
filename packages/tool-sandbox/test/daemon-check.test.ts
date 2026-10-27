import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDaemon, requiredFeatures } from "../src/daemon-check";

let workdir: string;
const savedPath = process.env.PATH;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "anvia-check-"));
});

afterEach(async () => {
  process.env.PATH = savedPath;
  await rm(workdir, { recursive: true });
});

describe("checkDaemon", () => {
  it("reports the desktop missing, and names what is not installed, on an empty PATH", async () => {
    process.env.PATH = workdir;
    const result = await checkDaemon({ terminal: false }, workdir, ["desktop"]);

    expect(result.capabilities).not.toContain("desktop");
    expect(result.missing).toEqual(["desktop"]);
    expect(result.notes.join("\n")).toMatch(/desktop unavailable: .*xdotool/);
  });

  it("does not report a feature as missing unless it is required", async () => {
    process.env.PATH = workdir;
    const result = await checkDaemon({ terminal: false }, workdir);

    expect(result.missing).toEqual([]);
  });

  it("says a feature is off when it is turned off, and fails if it is required", async () => {
    const result = await checkDaemon({ terminal: false, desktop: false }, workdir, ["desktop"]);

    expect(result.notes).toContain("desktop turned off");
    expect(result.notes).toContain("terminals turned off");
    expect(result.missing).toEqual(["desktop"]);
  });
});

describe("requiredFeatures", () => {
  it("reads --require in both spellings, once each", () => {
    expect(requiredFeatures(["--check", "--require=desktop,terminal"])).toEqual([
      "desktop",
      "terminal",
    ]);
    expect(requiredFeatures(["--require", "desktop", "--require=desktop"])).toEqual(["desktop"]);
    expect(requiredFeatures(["--check"])).toEqual([]);
  });

  it("rejects an unknown feature", () => {
    expect(() => requiredFeatures(["--require=display"])).toThrow(/terminal or desktop/);
  });
});
