import { describe, expect, it } from "vitest";
import { SandboxPathError } from "../src/errors";
import { containerPath, normalizeSandboxPath, parentSandboxPath } from "../src/path";

describe("sandbox path handling", () => {
  it("normalizes relative paths", () => {
    expect(normalizeSandboxPath("src/../index.ts")).toBe("index.ts");
    expect(normalizeSandboxPath("nested\\file.txt")).toBe("nested/file.txt");
  });

  it("allows the workspace root when requested", () => {
    expect(normalizeSandboxPath(".", { allowRoot: true })).toBe(".");
    expect(containerPath("/workspace", ".")).toBe("/workspace");
  });

  it("rejects unsafe paths", () => {
    expect(() => normalizeSandboxPath("")).toThrow(SandboxPathError);
    expect(() => normalizeSandboxPath("/etc/passwd")).toThrow(SandboxPathError);
    expect(() => normalizeSandboxPath("../secret")).toThrow(SandboxPathError);
    expect(() => normalizeSandboxPath("safe/../../secret")).toThrow(SandboxPathError);
    expect(() => normalizeSandboxPath("bad\0path")).toThrow(SandboxPathError);
  });

  it("resolves container and parent paths", () => {
    expect(containerPath("/workspace", "a/b.txt")).toBe("/workspace/a/b.txt");
    expect(parentSandboxPath("a/b.txt")).toBe("a");
    expect(parentSandboxPath("file.txt")).toBe(".");
  });
});
