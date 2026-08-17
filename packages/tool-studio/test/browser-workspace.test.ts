import { describe, expect, it } from "vitest";
import type { StudioSandboxSummary } from "../src/types";
import { browserWorkspaceForTool } from "../src/ui/app/modules/playground/browser-workspace";

const sandbox: StudioSandboxSummary = {
  ref: "sandbox_ref",
  id: "browser",
  provider: "docker",
  workdir: "/workspace",
  agentIds: ["browser-agent"],
  toolNames: ["browser_navigate", "browser_screenshot"],
  views: [{ id: "desktop", label: "Browser", protocol: "novnc" }],
  capabilities: { files: true, ports: true, processes: true, views: true },
};

describe("browserWorkspaceForTool", () => {
  it("selects the one browser view explicitly associated with the active agent and tool", () => {
    expect(browserWorkspaceForTool([sandbox], "browser-agent", "browser_navigate")).toEqual({
      sandboxRef: "sandbox_ref",
      view: { id: "desktop", label: "Browser", protocol: "novnc" },
    });
  });

  it("does not guess across missing or ambiguous registrations", () => {
    expect(browserWorkspaceForTool([sandbox], "other-agent", "browser_navigate")).toBeUndefined();
    expect(browserWorkspaceForTool([sandbox], "browser-agent", "other-tool")).toBeUndefined();
    expect(
      browserWorkspaceForTool(
        [sandbox, { ...sandbox, ref: "second_ref", id: "browser_2" }],
        "browser-agent",
        "browser_navigate",
      ),
    ).toBeUndefined();
  });
});
