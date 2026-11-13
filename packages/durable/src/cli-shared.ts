import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type CliIo = {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

/** What differs between the Drizzle and the Prisma schema generators. */
export type GeneratorSpec = {
  bin: string;
  /** Written next to the user's schema when not appending. */
  fileName: string;
  header: string;
  startMarker: string;
  endMarker: string;
  /** Names the generated schema defines; used to refuse conflicting schemas. */
  names: readonly string[];
  /** The text of the schema (without header or markers). */
  body: string;
  /** The user's schema file, or a directory of schema files. */
  defaultSchema(cwd: string): string;
  next: readonly string[];
};

type Options = {
  command?: string | undefined;
  schema?: string | undefined;
  write: boolean;
  appendToSchema: boolean;
  force: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { write: false, appendToSchema: false, force: false, help: false };
  const args = [...argv];
  options.command = args.shift();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--write") options.write = true;
    else if (arg === "--append-to-schema") options.appendToSchema = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--schema") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-"))
        throw new Error("--schema requires a path.");
      options.schema = value;
      index += 1;
    } else throw new Error(`Unknown option: ${arg ?? ""}`);
  }
  return options;
}

function help(spec: GeneratorSpec): string {
  return `Usage: ${spec.bin} init [options]

Options:
  --schema <path>       Path to your schema file or directory
  --write               Write the planned schema changes
  --append-to-schema    Append to your existing schema instead of creating ${spec.fileName}
  --force               Overwrite an existing generated file or marker block
  -h, --help            Show help

By default, init is a dry run and prints what it would write.`;
}

export async function runGeneratorCli(
  spec: GeneratorSpec,
  argv: string[],
  cwd: string,
  io: CliIo,
): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    io.log(help(spec));
    return 1;
  }
  if (options.help || options.command === undefined) {
    io.log(help(spec));
    return 0;
  }
  if (options.command !== "init") {
    io.error(`Unknown command: ${options.command}`);
    io.log(help(spec));
    return 1;
  }
  try {
    init(spec, options, cwd, io);
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function init(spec: GeneratorSpec, options: Options, cwd: string, io: CliIo): void {
  const requested = resolve(cwd, options.schema ?? spec.defaultSchema(cwd));
  const isDirectory = existsSync(requested) && statSync(requested).isDirectory();
  if (!existsSync(requested))
    throw new Error(
      `Schema not found at ${relative(cwd, requested)}. Pass --schema <path> if it lives elsewhere.`,
    );
  if (isDirectory && options.appendToSchema)
    throw new Error("--append-to-schema needs a schema file, not a directory.");
  const target = options.appendToSchema
    ? requested
    : join(isDirectory ? requested : dirname(requested), spec.fileName);
  const display = relative(cwd, target);
  const file = `${spec.header}\n\n${spec.body}`;
  const block = `${spec.startMarker}\n${spec.header}\n\n${spec.body.trimEnd()}\n${spec.endMarker}`;

  // Refuse to define a name twice: check the user's schema (and the target) outside our own output.
  for (const path of new Set(
    [requested, target].filter((p) => existsSync(p) && !statSync(p).isDirectory()),
  )) {
    const content = readFileSync(path, "utf8");
    const outside = stripGenerated(spec, content);
    const clash = spec.names.filter((name) => new RegExp(`\\b${name}\\b`).test(outside));
    if (
      clash.length > 0 &&
      !(path === target && !options.appendToSchema && content.includes(spec.header))
    )
      throw new Error(`Existing schema already defines: ${clash.join(", ")}`);
  }

  if (
    !options.appendToSchema &&
    !isDirectory &&
    readFileSync(requested, "utf8").includes(spec.startMarker)
  )
    throw new Error(`${relative(cwd, requested)} already contains the generated block.`);

  if (options.appendToSchema) {
    io.warn(
      "Warning: appending modifies your existing schema. Review the generated block before migrating.",
    );
    const current = readFileSync(target, "utf8");
    const start = current.indexOf(spec.startMarker);
    const end = current.indexOf(spec.endMarker);
    let next: string;
    if (start !== -1 || end !== -1) {
      if (start === -1 || end === -1 || end < start)
        throw new Error("Found incomplete Anvia durable schema markers.");
      if (!options.force)
        throw new Error("Anvia durable schema block already exists. Use --force to replace it.");
      next = `${current.slice(0, start).trimEnd()}\n\n${block}\n${current.slice(end + spec.endMarker.length).trimStart()}`;
    } else next = `${current.trimEnd()}\n\n${block}\n`;
    if (!options.write) {
      io.log(`Would append the Anvia durable schema to ${display}\n\n${block}`);
    } else {
      writeFileSync(target, next);
      io.log(`Appended the Anvia durable schema to ${display}`);
    }
  } else {
    const exists = existsSync(target);
    if (exists && !readFileSync(target, "utf8").includes(spec.header))
      throw new Error(`${display} already exists but was not generated by @anvia/durable.`);
    if (exists && !options.force)
      throw new Error(`${display} already exists. Use --force to overwrite the generated file.`);
    if (!options.write) {
      io.log(`${exists ? "Would overwrite" : "Would create"} ${display}\n\n${file.trimEnd()}`);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file);
      io.log(`${exists ? "Updated" : "Created"} ${display}`);
    }
  }
  io.log("");
  io.log("Next:");
  for (const line of spec.next) io.log(`  ${line}`);
}

function stripGenerated(spec: GeneratorSpec, content: string): string {
  const start = content.indexOf(spec.startMarker);
  const end = content.indexOf(spec.endMarker);
  if (start === -1 || end === -1 || end < start) return content;
  return content.slice(0, start) + content.slice(end + spec.endMarker.length);
}

/** True when this module is the process entry point. */
export function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === `file://${process.argv[1]}`;
}
