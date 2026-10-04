import {
  addRegistryItem,
  closestRegistryItemName,
  initSkills,
  initializeProject,
  isRegistryItemName,
  registryItemNames,
  skillNames,
  updateInstalledItems,
  updateSkills,
} from "../index";
import { optionValue } from "./options";
import { printAdapterTargets, reportSkills, reportSkillsPreview } from "./skills-output";
import { parseSkillsTargets } from "./skills-targets";

export function runCli(args: string[]): void {
  const [group, ...rest] = args;
  if (group === undefined || group === "--help" || group === "-h") {
    printUsage();
    return;
  }

  const grouped = group === "ui" || group === "skills";
  const [action, ...actionArgs] = rest;
  const command = grouped ? action : group;
  const commandArgs = grouped ? actionArgs : rest;

  if (grouped && (command === undefined || command === "--help" || command === "-h")) {
    printUsage(group);
    return;
  }

  const skills = group === "skills";
  const targetFlags = ["--claude", "--codex", "--cursor", "--agents"];
  const commands: Record<string, string[]> = skills
    ? {
        init: ["--cwd", "--dir", "--force", ...targetFlags],
        update: ["--cwd", "--dir", "--apply", "--force", ...targetFlags],
        list: [],
      }
    : {
        init: ["--cwd", "--force"],
        add: ["--cwd", "--overwrite"],
        update: ["--cwd", "--apply", "--overwrite"],
      };
  const flags =
    command !== undefined && Object.hasOwn(commands, command) ? commands[command] : undefined;
  if (command === undefined || flags === undefined) {
    throw new Error(
      `Unknown command "${args.slice(0, grouped ? 2 : 1).join(" ")}". Run \`anvia --help\`.`,
    );
  }
  if (commandArgs.includes("--help") || commandArgs.includes("-h")) {
    printUsage(skills ? "skills" : "ui");
    return;
  }

  const positional = parseArguments(commandArgs, flags);
  const cwd = optionValue(commandArgs, "--cwd");

  if (skills) {
    handleSkills(commandArgs, [command, ...positional], cwd, optionValue(commandArgs, "--dir"));
  } else if (command === "init") {
    handleInit(commandArgs, positional, cwd);
  } else if (command === "add") {
    handleAdd(commandArgs, positional, cwd);
  } else {
    handleUpdate(commandArgs, positional, cwd);
  }
}

function parseArguments(args: string[], flags: string[]): string[] {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith("-")) {
      positional.push(value);
      continue;
    }
    if (!flags.includes(value)) {
      throw new Error(`Unknown option "${value}". Run \`anvia --help\`.`);
    }
    if (value === "--cwd" || value === "--dir") {
      optionValue(args.slice(index), value);
      index += 1;
    }
  }
  return positional;
}

function handleInit(commandArgs: string[], positional: string[], cwd: string | undefined): void {
  const value = positional[0];

  if (positional.length > 1 || (value !== undefined && value !== "next" && value !== "vite")) {
    throw new Error("The init template must be next or vite.");
  }

  const options: Parameters<typeof initializeProject>[0] = {
    force: commandArgs.includes("--force"),
  };

  if (cwd !== undefined) {
    options.cwd = cwd;
  }

  if (value === "next" || value === "vite") {
    options.template = value;
  }

  initializeProject(options);

  console.log("Anvia UI configuration is ready.");
}

function handleAdd(commandArgs: string[], positional: string[], cwd: string | undefined): void {
  const value = positional[0];

  if (value === undefined || positional.length !== 1 || !isRegistryItemName(value)) {
    throw new Error(`Choose an item: ${registryItemNames.join(", ")}.`);
  }

  const options: Parameters<typeof addRegistryItem>[1] = {
    overwrite: commandArgs.includes("--overwrite"),
  };

  if (cwd !== undefined) {
    options.cwd = cwd;
  }

  addRegistryItem(value, options);

  console.log(`Added Anvia ${value}.`);
}

function handleUpdate(commandArgs: string[], positional: string[], cwd: string | undefined): void {
  const items = positional.map((value) => {
    if (isRegistryItemName(value)) {
      return value;
    }

    const suggestion = closestRegistryItemName(value);
    const suffix = suggestion === undefined ? "" : ` Did you mean "${suggestion}"?`;

    throw new Error(
      `Unknown registry item "${value}".${suffix} Choose an item: ${registryItemNames.join(", ")}.`,
    );
  });

  const apply = commandArgs.includes("--apply") || commandArgs.includes("--overwrite");

  const options: Parameters<typeof updateInstalledItems>[0] = { apply };

  if (cwd !== undefined) {
    options.cwd = cwd;
  }

  if (items.length > 0) {
    options.items = items;
  }

  const { report, updated } = updateInstalledItems(options);

  if (apply === true) {
    reportOverwriteResult(report, new Set(updated), updated.length);
    return;
  }

  reportDryRunResult(report);
}

function handleSkills(
  commandArgs: string[],
  positional: string[],
  cwd: string | undefined,
  dir: string | undefined,
): void {
  const action = positional[0];

  if (positional.length > 1 || (action !== "init" && action !== "update" && action !== "list")) {
    throw new Error("Choose a skills action: init, update, list.");
  }

  if (action === "list") {
    const names = skillNames();

    for (const name of names) {
      console.log(`skills/${name}`);
    }

    console.log(
      `${names.length} skills available. Run \`anvia skills init\` to copy them into your project.`,
    );

    return;
  }

  const skillsOptions: Parameters<typeof updateSkills>[0] = {
    force: commandArgs.includes("--force"),
  };

  if (action === "update") {
    skillsOptions.apply = commandArgs.includes("--apply");
  }

  if (cwd !== undefined) {
    skillsOptions.cwd = cwd;
  }

  if (dir !== undefined) {
    skillsOptions.dir = dir;
  }

  const targets = parseSkillsTargets(commandArgs);

  if (targets.length > 0) {
    skillsOptions.targets = targets;
  }

  if (action === "init") {
    const result = initSkills(skillsOptions);
    const changed = reportSkills(result, "init");
    printAdapterTargets(result.targets, changed);

    const canonicalDir = dir ?? "skills";

    console.log(
      `Anvia skills are ready in ./${canonicalDir} — Anvia knowledge for your coding agent.`,
    );
    console.log(
      `Your agent reads ./${canonicalDir}/<skill>/SKILL.md directly, or through the adapters above.`,
    );

    return;
  }

  const result = updateSkills(skillsOptions);
  if (!skillsOptions.apply && !skillsOptions.force) {
    reportSkillsPreview(result);
    return;
  }
  const changed = reportSkills(result, "update");
  printAdapterTargets(result.targets, changed);
}

function reportOverwriteResult(
  report: ReturnType<typeof updateInstalledItems>["report"],
  updatedPaths: Set<string>,
  updatedCount: number,
): void {
  for (const item of report) {
    if (!item.installed) {
      console.log(`Anvia ${item.name}: not installed. Use \`anvia ui add ${item.name}\` first.`);
      continue;
    }

    const changed = item.files.some(
      (file) => file.status !== "up-to-date" && updatedPaths.has(file.path),
    );

    console.log(`Anvia ${item.name}: ${changed ? "updated" : "up to date"}.`);
  }

  console.log(
    updatedCount === 0
      ? "All installed Anvia components are up to date."
      : `Updated ${updatedCount} ${updatedCount === 1 ? "file" : "files"}.`,
  );
}

function reportDryRunResult(report: ReturnType<typeof updateInstalledItems>["report"]): void {
  const changedPaths = new Set<string>();

  for (const item of report) {
    if (!item.installed) {
      console.log(`Anvia ${item.name}: not installed.`);
      continue;
    }

    for (const file of item.files) {
      if (file.status !== "up-to-date") {
        changedPaths.add(file.path);
      }

      console.log(`Anvia ${item.name}: ${file.status} ${file.path}`);
    }
  }

  console.log(
    changedPaths.size === 0
      ? "Everything is up to date."
      : `Found ${changedPaths.size} out-of-date ${changedPaths.size === 1 ? "file" : "files"}. Re-run with --apply to apply.`,
  );
}

function printUsage(group?: "ui" | "skills"): void {
  const ui = `  anvia ui init [next|vite] [--cwd <path>] [--force]
  anvia ui add <${registryItemNames.join("|")}> [--cwd <path>] [--overwrite]
  anvia ui update [items...] [--cwd <path>] [--apply]`;
  const skills = `  anvia skills list
  anvia skills init [--claude] [--codex] [--cursor] [--agents] [--dir <path>] [--cwd <path>] [--force]
  anvia skills update [--claude] [--codex] [--cursor] [--agents] [--dir <path>] [--cwd <path>] [--apply]`;
  console.log(`Usage:
${group === "ui" ? ui : group === "skills" ? skills : `${ui}\n${skills}`}

Updates preview changes without writing files. Use --apply to write them.
Compatibility: init/add/update alias ui commands; ui update --overwrite and skills update --force alias --apply.`);
}
