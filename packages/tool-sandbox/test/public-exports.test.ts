import { describe, expect, it } from "vitest";
import * as sandbox from "../src/index";

describe("public exports", () => {
  it("exports only the intended runtime API", () => {
    expect(Object.keys(sandbox).sort()).toEqual([
      "DockerSandboxClient",
      "DockerSandboxError",
      "createDockerSandboxTools",
    ]);
    expect(sandbox).not.toHaveProperty("createSandboxTools");
    expect(sandbox).not.toHaveProperty("isSandboxPortSession");
    expect(sandbox).not.toHaveProperty("isSandboxProcessSession");
  });
});
