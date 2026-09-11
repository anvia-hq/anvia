#!/usr/bin/env node
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
} from "./index";
import { optionValue } from "./cli/options";
import { printAdapterTargets, reportSkills } from "./cli/skills-output";
import { parseSkillsTargets } from "./cli/skills-targets";

function main(args: string[]): void {
  const [command, ...commandArgs] = args;
  const cwd = optionValue(commandArgs, "--cwd");
  const dir = optionValue(commandArgs, "--dir");

  const positional = commandArgs.filter(
    (value, index) =>
      !value.startsWith("--") &&
      (index === 0 || (commandArgs[index - 1] !== "--cwd" && commandArgs[index - 1] !== "--dir")),
  );

  if (command === "init") {
    handleInit(commandArgs, positional, cwd);
    return;
  }

  if (command === "add") {
    handleAdd(commandArgs, positional, cwd);
    return;
  }

  if (command === "update") {
    handleUpdate(commandArgs, positional, cwd);
    return;
  }

  if (command === "skills") {
    handleSkills(commandArgs, positional, cwd, dir);
    return;
  }

  printUsage();
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

  const overwrite = commandArgs.includes("--overwrite");

  const options: Parameters<typeof updateInstalledItems>[0] = { overwrite };

  if (cwd !== undefined) {
    options.cwd = cwd;
  }

  if (items.length > 0) {
    options.items = items;
  }

  const { report, updated } = updateInstalledItems(options);

  if (overwrite === true) {
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

  const skillsOptions: Parameters<typeof initSkills>[0] = {
    force: commandArgs.includes("--force"),
  };

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
      console.log(`Anvia ${item.name}: not installed. Use \`anvia add ${item.name}\` first.`);
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
  let changeCount = 0;

  for (const item of report) {
    if (!item.installed) {
      console.log(`Anvia ${item.name}: not installed.`);
      continue;
    }

    for (const file of item.files) {
      if (file.status !== "up-to-date") {
        changeCount += 1;
      }

      console.log(`Anvia ${item.name}: ${file.status} ${file.path}`);
    }
  }

  console.log(
    changeCount === 0
      ? "Everything is up to date."
      : `Found ${changeCount} out-of-date ${changeCount === 1 ? "file" : "files"}. Re-run with --overwrite to apply.`,
  );
}

function printUsage(): void {
  console.log(`Usage:
  anvia init [next|vite] [--cwd <path>] [--force]
  anvia add <${registryItemNames.join("|")}> [--cwd <path>] [--overwrite]
  anvia update [${registryItemNames.join("|")}] [--cwd <path>] [--overwrite]
  anvia skills <init|update|list> [--claude] [--codex] [--cursor] [--agents] [--dir <path>] [--force] [--cwd <path>]`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
