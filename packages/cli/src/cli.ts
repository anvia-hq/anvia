#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addRegistryItem,
  closestRegistryItemName,
  initSkills,
  initializeProject,
  isRegistryItemName,
  isSkillsTarget,
  registryItemNames,
  skillNames,
  updateInstalledItems,
  updateSkills,
  type SkillsTarget,
  type SkillsTargetResult,
  type SkillsWriteResult,
} from "./index";

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
    const { report, updated } = updateInstalledItems(options);
    const updatedPaths = new Set(updated);
    if (overwrite === true) {
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
        updated.length === 0
          ? "All installed Anvia components are up to date."
          : `Updated ${updated.length} ${updated.length === 1 ? "file" : "files"}.`,
      );
      return;
    }
    let changeCount = 0;
    for (const item of report) {
      if (!item.installed) {
        console.log(`Anvia ${item.name}: not installed.`);
        continue;
      }
      for (const file of item.files) {
        if (file.status !== "up-to-date") changeCount += 1;
        console.log(`Anvia ${item.name}: ${file.status} ${file.path}`);
      }
    }
    console.log(
      changeCount === 0
        ? "Everything is up to date."
        : `Found ${changeCount} out-of-date ${changeCount === 1 ? "file" : "files"}. Re-run with --overwrite to apply.`,
    );
    return;
  }

  if (command === "skills") {
    const action = positional[0];
    if (positional.length > 1 || (action !== "init" && action !== "update" && action !== "list")) {
      throw new Error("Choose a skills action: init, update, list.");
    }
    const skillsOptions: Parameters<typeof initSkills>[0] = {
      force: commandArgs.includes("--force"),
    };
    if (cwd !== undefined) skillsOptions.cwd = cwd;
    if (dir !== undefined) skillsOptions.dir = dir;
    const targets = parseSkillsTargets(commandArgs);
    if (targets.length > 0) skillsOptions.targets = targets;
    if (action === "list") {
      const names = skillNames();
      for (const name of names) console.log(`skills/${name}`);
      console.log(
        `${names.length} skills available. Run \`anvia skills init\` to copy them into your project.`,
      );
      return;
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
      if (projectUsesAnviaCore(cwd ?? process.cwd())) {
        console.log(
          "Building an app that embeds an Anvia Agent? Load the same folder in code with:",
        );
        console.log("");
        console.log('  import { loadSkills, skill } from "@anvia/core/skills";');
        console.log(`  const skills = await loadSkills(skill.local("./${canonicalDir}"));`);
      }
      return;
    }
    const result = updateSkills(skillsOptions);
    const changed = reportSkills(result, "update");
    printAdapterTargets(result.targets, changed);
    return;
  }

  console.log(`Usage:
  anvia init [next|vite] [--cwd <path>] [--force]
  anvia add <${registryItemNames.join("|")}> [--cwd <path>] [--overwrite]
  anvia update [${registryItemNames.join("|")}] [--cwd <path>] [--overwrite]
  anvia skills <init|update|list> [--claude] [--codex] [--cursor] [--agents] [--dir <path>] [--force] [--cwd <path>]`);
}

function parseSkillsTargets(args: string[]): SkillsTarget[] {
  const targets: SkillsTarget[] = [];
  for (const [flag, target] of [
    ["--claude", "claude"],
    ["--codex", "codex"],
    ["--cursor", "cursor"],
    ["--agents", "agents"],
  ] as const) {
    if (args.includes(flag) && isSkillsTarget(target)) targets.push(target);
  }
  return targets;
}

// The `loadSkills(skill.local(...))` snippet only applies to apps that embed an
// Anvia Agent; plain coding agents read the SKILL.md files without any Anvia
// dependency.
function projectUsesAnviaCore(cwd: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return (
      manifest.dependencies?.["@anvia/core"] !== undefined ||
      manifest.devDependencies?.["@anvia/core"] !== undefined ||
      manifest.peerDependencies?.["@anvia/core"] !== undefined
    );
  } catch {
    return false;
  }
}

function printAdapterTargets(targets: SkillsTargetResult[], anviaChanged: number): void {
  let changed = anviaChanged;
  for (const target of targets) {
    if (target.target === "anvia") continue;
    const written = target.created.length + target.updated.length;
    changed += written;
    if (target.target === "agents" || target.target === "codex") {
      if (target.created.length > 0) console.log("Created AGENTS.md (Anvia skills section).");
      else if (target.updated.length > 0) console.log("Updated AGENTS.md (Anvia skills section).");
      else console.log("AGENTS.md: up to date.");
      continue;
    }
    const label = target.target === "claude" ? ".claude/skills" : ".cursor/rules";
    if (written === 0) {
      console.log(
        target.skipped > 0
          ? `${label}: skipped ${target.skipped} modified ${target.skipped === 1 ? "file" : "files"} (use --force to overwrite).`
          : `${label}: up to date.`,
      );
      continue;
    }
    console.log(`${label}: synced ${written} ${written === 1 ? "file" : "files"}.`);
  }
  if (changed === 0) {
    console.log("No skill files changed.");
  }
}

function reportSkills(result: SkillsWriteResult, mode: "init" | "update"): number {
  const createdPaths = new Set(result.created);
  const updatedPaths = new Set(result.updated);
  const isWritten = (path: string): boolean => createdPaths.has(path) || updatedPaths.has(path);
  let changeCount = 0;
  for (const skill of result.report) {
    const createdCount = skill.files.filter((file) => createdPaths.has(file.path)).length;
    const updatedCount = skill.files.filter((file) => updatedPaths.has(file.path)).length;
    const changedCount = createdCount + updatedCount;
    const skippedCount = skill.files.filter(
      (file) => file.status === "modified" && !isWritten(file.path),
    ).length;
    const skipNote =
      skippedCount > 0
        ? `  skipped ${skippedCount} modified ${skippedCount === 1 ? "file" : "files"} (use --force to overwrite).`
        : undefined;
    changeCount += changedCount;
    if (changedCount === 0) {
      if (!skill.installed) {
        console.log(`skills/${skill.name}: not installed. Run \`anvia skills init\` first.`);
        continue;
      }
      if (skipNote !== undefined) {
        console.log(`skills/${skill.name}: ${skipNote.trimStart()}`);
        continue;
      }
      console.log(`skills/${skill.name}: up to date.`);
      continue;
    }
    if (mode === "init") {
      if (createdCount > 0) {
        const updatedNote = updatedCount > 0 ? `, updated ${updatedCount}` : "";
        console.log(
          `Created skills/${skill.name} (${createdCount} ${createdCount === 1 ? "file" : "files"}${updatedNote}).`,
        );
      } else {
        console.log(
          `Updated skills/${skill.name} (${updatedCount} ${updatedCount === 1 ? "file" : "files"}).`,
        );
      }
      if (skipNote !== undefined) console.log(skipNote);
      continue;
    }
    console.log(
      `skills/${skill.name}: updated ${changedCount} ${changedCount === 1 ? "file" : "files"}.`,
    );
  }
  return changeCount;
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
