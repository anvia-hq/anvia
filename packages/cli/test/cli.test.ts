import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  initializeProject: vi.fn(),
  addRegistryItem: vi.fn(),
  updateInstalledItems: vi.fn(),
  initSkills: vi.fn(),
  updateSkills: vi.fn(),
  skillNames: vi.fn(),
}));
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
  });

  it.each(["ui", "skills"])("shows %s group help", (group) => {
    runCli([group, "--help"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`anvia ${group} init`));
    expect(handlers.initializeProject).not.toHaveBeenCalled();
    expect(handlers.initSkills).not.toHaveBeenCalled();
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
    [["unknown"], 'Unknown command "unknown". Run `anvia --help`.'],
    [["ui", "unknown"], 'Unknown command "ui unknown". Run `anvia --help`.'],
    [["ui", "constructor"], 'Unknown command "ui constructor". Run `anvia --help`.'],
    [["skills", "add"], 'Unknown command "skills add". Run `anvia --help`.'],
    [["ui", "update", "--aply"], 'Unknown option "--aply". Run `anvia --help`.'],
    [["skills", "update", "--overwrite"], 'Unknown option "--overwrite". Run `anvia --help`.'],
    [["skills", "init", "--apply"], 'Unknown option "--apply". Run `anvia --help`.'],
    [["ui", "init", "--dir", "skills"], 'Unknown option "--dir". Run `anvia --help`.'],
    [["ui", "update", "--cwd"], "--cwd requires a value."],
    [["skills", "update", "--dir", "--apply"], "--dir requires a value."],
    [["skills", "list", "anvia-agent"], "Choose a skills action: init, update, list."],
    [
      ["ui", "add", "unknown"],
      "Choose an item: chat, thread, message, composer, attachment, markdown, tool-fallback.",
    ],
  ] as const)("rejects invalid arguments before invoking a writer: %j", ([args, message]) => {
    expect(() => runCli([...args])).toThrow(message);
    expect(handlers.initializeProject).not.toHaveBeenCalled();
    expect(handlers.addRegistryItem).not.toHaveBeenCalled();
    expect(handlers.updateInstalledItems).not.toHaveBeenCalled();
    expect(handlers.initSkills).not.toHaveBeenCalled();
    expect(handlers.updateSkills).not.toHaveBeenCalled();
  });
});
