import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  initializeProject: vi.fn(),
  addRegistryItem: vi.fn(),
  updateInstalledItems: vi.fn(),
  initSkills: vi.fn(),
  updateSkills: vi.fn(),
  skillNames: vi.fn(),
  runAcp: vi.fn(),
}));
vi.mock("../src/cli/acp", () => ({ runAcp: handlers.runAcp }));
vi.mock("../src/index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/index")>()),
  ...handlers,
}));
import { runCli } from "../src/cli/run";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  handlers.updateInstalledItems.mockReturnValue({ report: [], updated: [] });
  handlers.updateSkills.mockReturnValue({ report: [], created: [], updated: [], targets: [] });
  handlers.initSkills.mockReturnValue({ report: [], created: [], updated: [], targets: [] });
  handlers.skillNames.mockReturnValue(["anvia-agent"]);
});
afterEach(() => vi.restoreAllMocks());

describe("CLI command groups", () => {
  it.for([[], ["--help"], ["-h"]])("shows grouped root help for %j", (args) => {
    runCli(args);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("anvia ui init"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("anvia skills update"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("anvia acp --agent"));
  });

  it.each(["ui", "skills"])("shows %s group help", (group) => {
    runCli([group, "--help"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`anvia ${group} init`));
    expect(handlers.initializeProject).not.toHaveBeenCalled();
    expect(handlers.initSkills).not.toHaveBeenCalled();
  });

  it("prints ACP help to stderr without loading the optional peer", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    runCli(["acp", "--help"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("anvia acp --agent"));
    expect(console.log).not.toHaveBeenCalled();
    expect(handlers.runAcp).not.toHaveBeenCalled();
  });

  it("returns the async ACP lifecycle to the entrypoint", async () => {
    const error = new Error("safe startup diagnostic");
    handlers.runAcp.mockRejectedValueOnce(error);
    await expect(runCli(["acp", "--agent", "agent with spaces.ts"])).rejects.toBe(error);
    expect(handlers.runAcp).toHaveBeenCalledWith("agent with spaces.ts");
  });

  it.for([["ui", "init"], ["init"]])("initializes UI using %j", (prefix) => {
    runCli([...prefix, "vite", "--cwd", "project with spaces", "--force"]);
    expect(handlers.initializeProject).toHaveBeenCalledWith({
      cwd: "project with spaces",
      template: "vite",
      force: true,
    });
  });

  it.for([["ui", "add"], ["add"]])("adds UI using %j", (prefix) => {
    runCli([...prefix, "composer", "--cwd", "project", "--overwrite"]);
    expect(handlers.addRegistryItem).toHaveBeenCalledWith("composer", {
      cwd: "project",
      overwrite: true,
    });
  });

  it.for([["ui", "update"], ["update"]])("previews UI using %j", (prefix) => {
    runCli([...prefix, "composer"]);
    expect(handlers.updateInstalledItems).toHaveBeenCalledWith({
      items: ["composer"],
      apply: false,
    });
  });

  it.each(["--apply", "--overwrite"])("applies UI updates using %s", (flag) => {
    runCli(["ui", "update", "composer", "thread", flag]);
    expect(handlers.updateInstalledItems).toHaveBeenCalledWith({
      items: ["composer", "thread"],
      apply: true,
    });
  });

  it("counts shared component paths once in the preview", () => {
    const file = {
      filename: "attachment.tsx",
      path: "/project/attachment.tsx",
      status: "modified",
    };
    handlers.updateInstalledItems.mockReturnValue({
      report: [
        { name: "composer", installed: true, files: [file] },
        { name: "message", installed: true, files: [file] },
      ],
      updated: [],
    });
    runCli(["ui", "update"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Found 1 out-of-date file."));
  });

  it("previews all selected skills integrations", () => {
    handlers.updateSkills.mockReturnValue({
      report: [],
      created: [],
      updated: [],
      targets: [{ target: "codex", pending: ["/project/AGENTS.md"] }],
    });
    runCli([
      "skills",
      "update",
      "--codex",
      "--cursor",
      "--dir",
      "agent-skills",
      "--cwd",
      "project",
    ]);
    expect(handlers.updateSkills).toHaveBeenCalledWith({
      force: false,
      apply: false,
      cwd: "project",
      dir: "agent-skills",
      targets: ["codex", "cursor"],
    });
    expect(console.log).toHaveBeenCalledWith("codex: would update /project/AGENTS.md");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("--apply"));
  });

  it.each(["--apply", "--force"])("applies skills updates using %s", (flag) => {
    runCli(["skills", "update", flag]);
    expect(handlers.updateSkills).toHaveBeenCalledWith({
      apply: flag === "--apply",
      force: flag === "--force",
    });
  });

  it.for([
    ["unknown"],
    ["ui", "unknown"],
    ["ui", "constructor"],
    ["skills", "add"],
    ["ui", "update", "--aply"],
    ["skills", "update", "--overwrite"],
    ["skills", "init", "--apply"],
    ["ui", "init", "--dir", "skills"],
    ["ui", "update", "--cwd"],
    ["skills", "update", "--dir", "--apply"],
    ["skills", "list", "anvia-agent"],
    ["ui", "add", "unknown"],
    ["acp"],
    ["acp", "--agent"],
    ["acp", "--agent", "--help-me"],
    ["acp", "./agent.ts"],
    ["acp", "--agent", "./agent.ts", "extra"],
    ["acp", "--agent", "a.ts", "--agent", "b.ts"],
    ["acp", "--agent", "a.ts", "--cwd", "project"],
  ])("rejects invalid arguments before invoking a writer: %j", (args) => {
    expect(() => runCli(args)).toThrow();
    expect(handlers.initializeProject).not.toHaveBeenCalled();
    expect(handlers.addRegistryItem).not.toHaveBeenCalled();
    expect(handlers.updateInstalledItems).not.toHaveBeenCalled();
    expect(handlers.initSkills).not.toHaveBeenCalled();
    expect(handlers.updateSkills).not.toHaveBeenCalled();
    expect(handlers.runAcp).not.toHaveBeenCalled();
  });
});
