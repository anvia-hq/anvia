import { describe, expect, it } from "vitest";
import { DockerSandboxError } from "../src/errors";
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

  it("normalizes absolute paths inside a declared workdir", () => {
    expect(normalizeSandboxPath("/workspace/src/index.ts", { workdir: "/workspace" })).toBe(
      "src/index.ts",
    );
    expect(normalizeSandboxPath("/workspace", { allowRoot: true, workdir: "/workspace" })).toBe(
      ".",
    );
    expect(() =>
      normalizeSandboxPath("/workspace-other/secret", { workdir: "/workspace" }),
    ).toThrow("cannot leave the workspace");
  });

  it("rejects unsafe paths", () => {
    expect(() => normalizeSandboxPath("")).toThrow(DockerSandboxError);
    expect(() => normalizeSandboxPath("/etc/passwd")).toThrow(DockerSandboxError);
    expect(() => normalizeSandboxPath("../secret")).toThrow(DockerSandboxError);
    expect(() => normalizeSandboxPath("safe/../../secret")).toThrow(DockerSandboxError);
    expect(() => normalizeSandboxPath("bad\0path")).toThrow(DockerSandboxError);
  });

  it("resolves container and parent paths", () => {
    expect(containerPath("/workspace", "a/b.txt")).toBe("/workspace/a/b.txt");
    expect(parentSandboxPath("a/b.txt")).toBe("a");
    expect(parentSandboxPath("file.txt")).toBe(".");
  });
});
