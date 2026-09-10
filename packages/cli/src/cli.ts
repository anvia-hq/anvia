#!/usr/bin/env node
import {
  addRegistryItem,
  closestRegistryItemName,
  initializeProject,
  isRegistryItemName,
  registryItemNames,
  updateInstalledItems,
} from "./index";

function main(args: string[]): void {
  const [command, ...commandArgs] = args;
  const cwd = optionValue(commandArgs, "--cwd");
  const positional = commandArgs.filter(
    (value, index) =>
      !value.startsWith("--") && (index === 0 || commandArgs[index - 1] !== "--cwd"),
  );

  if (command === "init") {
    const value = positional[0];
    if (positional.length > 1 || (value !== undefined && value !== "next" && value !== "vite")) {
      throw new Error("The init template must be next or vite.");
    }
    const options: Parameters<typeof initializeProject>[0] = {
      force: commandArgs.includes("--force"),
    };
    if (cwd !== undefined) options.cwd = cwd;
    if (value === "next" || value === "vite") options.template = value;
    initializeProject(options);
    console.log("Anvia UI configuration is ready.");
    return;
  }

  if (command === "add") {
    const value = positional[0];
    if (value === undefined || positional.length !== 1 || !isRegistryItemName(value)) {
      throw new Error(`Choose an item: ${registryItemNames.join(", ")}.`);
    }
    const options: Parameters<typeof addRegistryItem>[1] = {
      overwrite: commandArgs.includes("--overwrite"),
    };
    if (cwd !== undefined) options.cwd = cwd;
    addRegistryItem(value, options);
    console.log(`Added Anvia ${value}.`);
    return;
  }

  if (command === "update") {
    const items = positional.map((value) => {
      if (isRegistryItemName(value)) return value;
      const suggestion = closestRegistryItemName(value);
      const suffix = suggestion === undefined ? "" : ` Did you mean "${suggestion}"?`;
      throw new Error(
        `Unknown registry item "${value}".${suffix} Choose an item: ${registryItemNames.join(", ")}.`,
      );
    });
    const overwrite = commandArgs.includes("--overwrite");
    const options: Parameters<typeof updateInstalledItems>[0] = { overwrite };
    if (cwd !== undefined) options.cwd = cwd;
    if (items.length > 0) options.items = items;
    const { report } = updateInstalledItems(options);
    let changeCount = 0;
    for (const item of report) {
      if (!item.installed && overwrite !== true) {
        console.log(`Anvia ${item.name}: not installed.`);
        continue;
      }
      for (const file of item.files) {
        const label = overwrite === true && file.status !== "up-to-date" ? "updated" : file.status;
        if (label !== "up-to-date") changeCount += 1;
        console.log(`Anvia ${item.name}: ${label} ${file.path}`);
      }
    }
    if (overwrite === true) {
      console.log(
        changeCount === 0
          ? "All installed Anvia components are up to date."
          : `Updated ${changeCount} ${changeCount === 1 ? "file" : "files"}.`,
      );
    } else {
      console.log(
        changeCount === 0
          ? "Everything is up to date."
          : `Found ${changeCount} out-of-date ${changeCount === 1 ? "file" : "files"}. Re-run with --overwrite to apply.`,
      );
    }
    return;
  }

  console.log(`Usage:
  anvia init [next|vite] [--cwd <path>] [--force]
  anvia add <${registryItemNames.join("|")}> [--cwd <path>] [--overwrite]
  anvia update [${registryItemNames.join("|")}] [--cwd <path>] [--overwrite]`);
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
