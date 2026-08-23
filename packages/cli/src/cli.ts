#!/usr/bin/env node
import { addRegistryItem, initializeProject, isRegistryItemName, registryItemNames } from "./index";

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

  console.log(`Usage:
  anvia init [next|vite] [--cwd <path>] [--force]
  anvia add <${registryItemNames.join("|")}> [--cwd <path>] [--overwrite]`);
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
