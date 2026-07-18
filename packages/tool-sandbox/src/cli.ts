#!/usr/bin/env node
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDockerCli } from "./docker-cli";
import {
  renderSandboxImageContext,
  resolveSandboxImageSpec,
  type SandboxImageFeature,
  type SandboxImageInput,
  type SandboxImageManifest,
  type SandboxImageRuntime,
  type SandboxImageVersions,
  unpinnedSandboxImagePackages,
} from "./image-builder";

interface CliOptions {
  command?: string;
  name?: string;
  tag?: string;
  output?: string;
  runtimes: SandboxImageRuntime[];
  features: SandboxImageFeature[];
  apt: string[];
  npm: string[];
  pip: string[];
  versions: Partial<SandboxImageVersions>;
  dockerPath: string;
  build: boolean;
  buildExplicit: boolean;
  dryRun: boolean;
  force: boolean;
  help: boolean;
}

export interface SandboxImageCliIo {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  stdout(chunk: Uint8Array): void;
  stderr(chunk: Uint8Array): void;
}

export interface SandboxImagePromptResult {
  name: string;
  runtimes: SandboxImageRuntime[];
  features: SandboxImageFeature[];
  apt: string[];
  npm: string[];
  pip: string[];
  tag?: string;
  output?: string;
  build: boolean;
}

export interface SandboxImageCliDependencies {
  isTTY?: boolean;
  packageVersion?: string;
  prompt?: (options: Readonly<CliOptions>) => Promise<SandboxImagePromptResult | undefined>;
  buildImage?: (input: {
    contextPath: string;
    tag: string;
    dockerPath: string;
    io: SandboxImageCliIo;
  }) => Promise<void>;
}

const generatedFileNames = new Set([
  ".dockerignore",
  "Dockerfile",
  "anvia-sandbox.json",
  "package.json",
  "requirements.txt",
]);

const defaultIo: SandboxImageCliIo = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  stdout: (chunk) => process.stdout.write(chunk),
  stderr: (chunk) => process.stderr.write(chunk),
};

export async function runCli(
  argv: string[] = process.argv.slice(2),
  cwd = process.cwd(),
  io: SandboxImageCliIo = defaultIo,
  dependencies: SandboxImageCliDependencies = {},
): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.error(errorMessage(error));
    io.log(helpText());
    return 1;
  }

  if (options.help || options.command === undefined) {
    io.log(helpText());
    return 0;
  }
  if (options.command !== "create-image") {
    io.error(`Unknown command: ${options.command}`);
    io.log(helpText());
    return 1;
  }

  try {
    const shouldPrompt =
      options.name === undefined ||
      (options.runtimes.length === 0 &&
        options.features.length === 0 &&
        options.npm.length === 0 &&
        options.pip.length === 0);
    if (shouldPrompt) {
      const isTTY = dependencies.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY);
      if (!isTTY) {
        throw new Error(
          "Non-interactive create-image requires --name and at least one --runtime or --feature.",
        );
      }
      const prompt = dependencies.prompt ?? promptForImage;
      const result = await prompt(options);
      if (result === undefined) return 130;
      options = applyPromptResult(options, result);
    }

    const input: SandboxImageInput = {
      name: required(options.name, "Image name is required."),
      runtimes: options.runtimes,
      features: options.features,
      packages: {
        apt: options.apt,
        npm: options.npm,
        pip: options.pip,
      },
      versions: options.versions,
    };
    if (options.tag !== undefined) input.tag = options.tag;

    const spec = resolveSandboxImageSpec(input);
    const packageVersion = dependencies.packageVersion ?? (await readPackageVersion());
    const context = renderSandboxImageContext(spec, packageVersion);
    const outputPath = path.resolve(
      cwd,
      options.output ?? path.join(".anvia", "sandbox-images", spec.name),
    );
    const displayPath = relativeDisplayPath(cwd, outputPath);
    const unpinned = unpinnedSandboxImagePackages(spec);
    if (unpinned.length > 0) {
      io.warn(`Unpinned custom packages may change on rebuild: ${unpinned.join(", ")}`);
    }

    if (options.dryRun) {
      printDryRun(context.files, displayPath, spec.tag, io);
      return 0;
    }

    await writeImageContext(outputPath, context.manifest, context.files, options.force);
    io.log(`Created ${displayPath}`);

    if (!options.build) {
      io.log("");
      io.log("Build later:");
      io.log(`  ${shellCommand([options.dockerPath, "build", "--tag", spec.tag, displayPath])}`);
      printUsageSnippet(spec.tag, io);
      return 0;
    }

    const buildImage = dependencies.buildImage ?? buildDockerImage;
    await buildImage({
      contextPath: outputPath,
      tag: spec.tag,
      dockerPath: options.dockerPath,
      io,
    });
    io.log(`Built ${spec.tag}`);
    printUsageSnippet(spec.tag, io);
    return 0;
  } catch (error) {
    io.error(errorMessage(error));
    return 1;
  }
}

async function promptForImage(
  options: Readonly<CliOptions>,
): Promise<SandboxImagePromptResult | undefined> {
  assertInteractiveNodeVersion();
  const prompts = await import("@clack/prompts");
  prompts.intro("Create an Anvia sandbox image");

  const nameResult =
    options.name ??
    (await prompts.text({
      message: "Image name",
      placeholder: "reports",
      validate: (value) =>
        /^[a-z0-9][a-z0-9-]{0,62}$/.test(value ?? "")
          ? undefined
          : "Use 1-63 lowercase letters, numbers, or hyphens.",
    }));
  if (prompts.isCancel(nameResult)) return cancelPrompt(prompts);
  const name = String(nameResult);

  let runtimes = [...options.runtimes];
  let features = [...options.features];
  if (
    runtimes.length === 0 &&
    features.length === 0 &&
    options.npm.length === 0 &&
    options.pip.length === 0
  ) {
    const capabilities = await prompts.multiselect<SandboxImageRuntime | SandboxImageFeature>({
      message: "Select runtimes and features",
      required: true,
      options: [
        { value: "node", label: "Node.js", hint: "Includes npm and pnpm" },
        { value: "bun", label: "Bun", hint: "Includes bun and bunx" },
        { value: "python", label: "Python", hint: "Includes pip, uv, and uvx" },
        { value: "artifacts", label: "Reporting and artifacts", hint: "Adds Python automatically" },
        { value: "playwright", label: "Playwright + Chromium", hint: "Adds Node.js automatically" },
      ],
    });
    if (prompts.isCancel(capabilities)) return cancelPrompt(prompts);
    runtimes = capabilities.filter(isRuntime);
    features = capabilities.filter(isFeature);
  }

  const apt = await optionalPackagePrompt(prompts, "Extra apt packages", options.apt);
  if (apt === undefined) return cancelPrompt(prompts);
  const npm = await optionalPackagePrompt(prompts, "Extra npm packages", options.npm);
  if (npm === undefined) return cancelPrompt(prompts);
  const pip = await optionalPackagePrompt(prompts, "Extra pip requirements", options.pip);
  if (pip === undefined) return cancelPrompt(prompts);

  const tagResult =
    options.tag ??
    (await prompts.text({
      message: "Docker image tag",
      initialValue: `anvia-sandbox-${name}:latest`,
    }));
  if (prompts.isCancel(tagResult)) return cancelPrompt(prompts);
  const outputResult =
    options.output ??
    (await prompts.text({
      message: "Generated source directory",
      initialValue: path.join(".anvia", "sandbox-images", name),
    }));
  if (prompts.isCancel(outputResult)) return cancelPrompt(prompts);

  const buildResult = options.buildExplicit
    ? options.build
    : await prompts.confirm({ message: "Build the image now?", initialValue: true });
  if (prompts.isCancel(buildResult)) return cancelPrompt(prompts);
  const confirmed = await prompts.confirm({
    message: "Create this sandbox image?",
    initialValue: true,
  });
  if (prompts.isCancel(confirmed) || !confirmed) return cancelPrompt(prompts);

  prompts.outro("Configuration ready");
  return {
    name,
    runtimes,
    features,
    apt,
    npm,
    pip,
    tag: String(tagResult),
    output: String(outputResult),
    build: Boolean(buildResult),
  };
}

async function optionalPackagePrompt(
  prompts: typeof import("@clack/prompts"),
  message: string,
  existing: readonly string[],
): Promise<string[] | undefined> {
  if (existing.length > 0) return [...existing];
  const result = await prompts.text({
    message,
    placeholder: "Optional; separate entries with commas",
  });
  if (prompts.isCancel(result)) return undefined;
  return splitPackageList(result);
}

function cancelPrompt(prompts: typeof import("@clack/prompts")): undefined {
  prompts.cancel("Image creation cancelled.");
  return undefined;
}

async function buildDockerImage(input: {
  contextPath: string;
  tag: string;
  dockerPath: string;
  io: SandboxImageCliIo;
}): Promise<void> {
  await assertDockerCli(["build", "--tag", input.tag, input.contextPath], {
    dockerPath: input.dockerPath,
    onStdout: input.io.stdout,
    onStderr: input.io.stderr,
  });
}

async function writeImageContext(
  outputPath: string,
  manifest: SandboxImageManifest,
  files: ReadonlyMap<string, string>,
  force: boolean,
): Promise<void> {
  const outputStat = await safeLstat(outputPath);
  if (outputStat?.isSymbolicLink()) {
    throw new Error(`Refusing to write through symlink: ${outputPath}`);
  }

  if (outputStat !== undefined) {
    if (!outputStat.isDirectory()) throw new Error(`Output path is not a directory: ${outputPath}`);
    const previousManifest = await readGeneratedManifest(outputPath);
    if (previousManifest === undefined) {
      throw new Error(
        `Output directory already exists but was not generated by @anvia/sandbox: ${outputPath}`,
      );
    }
    if (!force) throw new Error(`Output directory already exists. Use --force to regenerate it.`);

    for (const filename of previousManifest.generatedFiles) {
      const target = path.join(outputPath, filename);
      const targetStat = await safeLstat(target);
      if (targetStat?.isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${target}`);
      if (targetStat !== undefined) await rm(target);
    }
  } else {
    await mkdir(outputPath, { recursive: true });
  }

  for (const [filename, content] of files) {
    if (!generatedFileNames.has(filename))
      throw new Error(`Unexpected generated filename: ${filename}`);
    const target = path.join(outputPath, filename);
    const targetStat = await safeLstat(target);
    if (targetStat?.isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${target}`);
    await writeFile(target, content, "utf8");
  }

  if (!files.has("anvia-sandbox.json") || manifest.generatedFiles.length !== files.size) {
    throw new Error("Generated image context manifest is inconsistent.");
  }
}

async function readGeneratedManifest(
  outputPath: string,
): Promise<SandboxImageManifest | undefined> {
  const manifestPath = path.join(outputPath, "anvia-sandbox.json");
  const stat = await safeLstat(manifestPath);
  if (stat === undefined) return undefined;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Invalid generated manifest: ${manifestPath}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read generated manifest: ${manifestPath}`, { cause: error });
  }
  if (!isGeneratedManifest(value)) {
    throw new Error(
      `Output manifest is not recognized as an @anvia/sandbox manifest: ${manifestPath}`,
    );
  }
  return value;
}

function isGeneratedManifest(value: unknown): value is SandboxImageManifest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const generatedBy = record.generatedBy as Record<string, unknown> | undefined;
  const files = record.generatedFiles;
  return (
    record.schemaVersion === 1 &&
    generatedBy?.package === "@anvia/sandbox" &&
    Array.isArray(files) &&
    files.every((file) => typeof file === "string" && generatedFileNames.has(file))
  );
}

async function safeLstat(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function printDryRun(
  files: ReadonlyMap<string, string>,
  outputPath: string,
  tag: string,
  io: SandboxImageCliIo,
): void {
  io.log(`Would create ${outputPath}`);
  for (const [filename, content] of files) {
    io.log("");
    io.log(`--- ${filename}`);
    io.log(content.trimEnd());
  }
  io.log("");
  io.log(`Would build ${tag}`);
}

function printUsageSnippet(tag: string, io: SandboxImageCliIo): void {
  io.log("");
  io.log("Use with @anvia/sandbox:");
  io.log("  const sandbox = new DockerSandbox({");
  io.log(`    image: ${JSON.stringify(tag)},`);
  io.log('    pull: "never",');
  io.log("  });");
}

function applyPromptResult(options: CliOptions, result: SandboxImagePromptResult): CliOptions {
  const next: CliOptions = {
    ...options,
    name: result.name,
    runtimes: result.runtimes,
    features: result.features,
    apt: result.apt,
    npm: result.npm,
    pip: result.pip,
    build: result.build,
    buildExplicit: true,
  };
  if (result.tag !== undefined) next.tag = result.tag;
  if (result.output !== undefined) next.output = result.output;
  return next;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    runtimes: [],
    features: [],
    apt: [],
    npm: [],
    pip: [],
    versions: {},
    dockerPath: "docker",
    build: true,
    buildExplicit: false,
    dryRun: false,
    force: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("-")) {
      if (options.command !== undefined) throw new Error(`Unexpected argument: ${argument}`);
      options.command = argument;
      continue;
    }

    const [flag, inlineValue] = splitFlag(argument);
    const value = () => inlineValue ?? required(argv[++index], `${flag} requires a value.`);
    switch (flag) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--name":
        options.name = value();
        break;
      case "--tag":
        options.tag = value();
        break;
      case "--output":
        options.output = value();
        break;
      case "--runtime":
        options.runtimes.push(parseRuntime(value()));
        break;
      case "--feature":
        options.features.push(parseFeature(value()));
        break;
      case "--apt":
        options.apt.push(value());
        break;
      case "--npm":
        options.npm.push(value());
        break;
      case "--pip":
        options.pip.push(value());
        break;
      case "--node-version":
        options.versions.node = value();
        break;
      case "--pnpm-version":
        options.versions.pnpm = value();
        break;
      case "--bun-version":
        options.versions.bun = value();
        break;
      case "--python-version":
        options.versions.python = value();
        break;
      case "--uv-version":
        options.versions.uv = value();
        break;
      case "--playwright-version":
        options.versions.playwright = value();
        break;
      case "--docker-path":
        options.dockerPath = value();
        break;
      case "--no-build":
        rejectInlineValue(flag, inlineValue);
        options.build = false;
        options.buildExplicit = true;
        break;
      case "--dry-run":
        rejectInlineValue(flag, inlineValue);
        options.dryRun = true;
        break;
      case "--force":
        rejectInlineValue(flag, inlineValue);
        options.force = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  return options;
}

function splitFlag(argument: string): [string, string | undefined] {
  const separator = argument.indexOf("=");
  return separator === -1
    ? [argument, undefined]
    : [argument.slice(0, separator), argument.slice(separator + 1)];
}

function rejectInlineValue(flag: string, value: string | undefined): void {
  if (value !== undefined) throw new Error(`${flag} does not accept a value.`);
}

function parseRuntime(value: string): SandboxImageRuntime {
  if (isRuntime(value)) return value;
  throw new Error(`Unknown runtime: ${value}. Expected node, bun, or python.`);
}

function parseFeature(value: string): SandboxImageFeature {
  if (isFeature(value)) return value;
  throw new Error(`Unknown feature: ${value}. Expected artifacts or playwright.`);
}

function isRuntime(value: string): value is SandboxImageRuntime {
  return value === "node" || value === "bun" || value === "python";
}

function isFeature(value: string): value is SandboxImageFeature {
  return value === "artifacts" || value === "playwright";
}

function splitPackageList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function assertInteractiveNodeVersion(): void {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 12)) {
    throw new Error("The interactive create-image wizard requires Node.js 20.12 or newer.");
  }
}

async function readPackageVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    version?: unknown;
  };
  return typeof packageJson.version === "string" ? packageJson.version : "unknown";
}

function relativeDisplayPath(cwd: string, target: string): string {
  const relative = path.relative(cwd, target);
  return relative && !relative.startsWith("..") ? relative : target;
}

function shellCommand(args: readonly string[]): string {
  return args.map(shellArgument).join(" ");
}

function shellArgument(value: string): string {
  if (/^[a-zA-Z0-9_./:@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === "") throw new Error(message);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function helpText(): string {
  return `Usage:
  pnpm dlx @anvia/sandbox create-image [options]

Options:
  --name <slug>                  Image profile name
  --runtime <node|bun|python>    Runtime to include; repeatable
  --feature <artifacts|playwright>
                                 Curated feature to include; repeatable
  --apt <package>                Additional apt package; repeatable
  --npm <package[@version]>      Additional npm package; repeatable
  --pip <requirement>            Additional pip requirement; repeatable
  --tag <tag>                    Local image tag
  --output <directory>           Generated context directory
  --node-version <version>       Override Node.js version
  --pnpm-version <version>       Override pnpm version
  --bun-version <version>        Override Bun version
  --python-version <version>     Override Python version
  --uv-version <version>         Override uv version
  --playwright-version <version> Override Playwright and browser image version
  --docker-path <path>           Docker CLI path (default: docker)
  --no-build                     Generate files without building
  --dry-run                      Print generated files without writing or building
  --force                        Regenerate a context previously created by this CLI
  -h, --help                     Show this help

Examples:
  pnpm dlx @anvia/sandbox create-image
  pnpm dlx @anvia/sandbox create-image --name reports --feature artifacts
  pnpm dlx @anvia/sandbox create-image --name browser --runtime bun --feature playwright`;
}

const invokedPath = process.argv[1] === undefined ? undefined : path.resolve(process.argv[1]);
if (invokedPath !== undefined && invokedPath === fileURLToPath(import.meta.url)) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
