export type SandboxImageRuntime = "node" | "bun" | "python";
export type SandboxImageFeature = "artifacts" | "playwright";

export interface SandboxImageVersions {
  node: string;
  pnpm: string;
  bun: string;
  python: string;
  uv: string;
  playwright: string;
}

export interface SandboxImagePackages {
  apt: string[];
  npm: string[];
  pip: string[];
}

export interface SandboxImageInput {
  name: string;
  tag?: string;
  runtimes?: readonly SandboxImageRuntime[];
  features?: readonly SandboxImageFeature[];
  packages?: Partial<SandboxImagePackages>;
  versions?: Partial<SandboxImageVersions>;
}

export interface SandboxImageSpec {
  name: string;
  tag: string;
  runtimes: SandboxImageRuntime[];
  features: SandboxImageFeature[];
  packages: SandboxImagePackages;
  versions: SandboxImageVersions;
}

export interface SandboxImageManifest extends SandboxImageSpec {
  schemaVersion: 1;
  generatedBy: {
    package: "@anvia/sandbox";
    version: string;
  };
  generatedFiles: string[];
}

export interface SandboxImageContext {
  manifest: SandboxImageManifest;
  files: ReadonlyMap<string, string>;
}

export const defaultSandboxImageVersions: Readonly<SandboxImageVersions> = {
  node: "24.18.0",
  pnpm: "11.0.4",
  bun: "1.3.14",
  python: "3.13.14",
  uv: "0.11.29",
  playwright: "1.61.0",
};

export const artifactPythonPackages = [
  "matplotlib==3.11.1",
  "seaborn==0.13.2",
  "Pillow==12.3.0",
  "ReportLab==5.0.0",
  "pypdf==6.14.2",
  "pandas==3.0.3",
  "openpyxl==3.1.5",
  "XlsxWriter==3.2.9",
  "python-docx==1.2.0",
] as const;

const runtimeOrder: SandboxImageRuntime[] = ["node", "bun", "python"];
const featureOrder: SandboxImageFeature[] = ["artifacts", "playwright"];
const commonAptPackages = ["bash", "ca-certificates", "findutils", "libstdc++6", "procps"];

export function resolveSandboxImageSpec(input: SandboxImageInput): SandboxImageSpec {
  validateName(input.name);

  const runtimes = new Set(input.runtimes ?? []);
  const features = new Set(input.features ?? []);
  const packages: SandboxImagePackages = {
    apt: unique(input.packages?.apt ?? []),
    npm: unique(input.packages?.npm ?? []),
    pip: unique(input.packages?.pip ?? []),
  };

  for (const runtime of runtimes) validateRuntime(runtime);
  for (const feature of features) validateFeature(feature);
  for (const packageName of packages.apt) validateAptPackage(packageName);
  for (const packageSpec of packages.npm) parseNpmPackageSpec(packageSpec);
  for (const requirement of packages.pip) validatePipRequirement(requirement);

  if (features.has("artifacts") || packages.pip.length > 0) runtimes.add("python");
  if (features.has("playwright")) runtimes.add("node");
  if (packages.npm.length > 0 && !runtimes.has("node") && !runtimes.has("bun")) {
    runtimes.add("node");
  }

  if (runtimes.size === 0) {
    throw new Error("Select at least one runtime or feature.");
  }

  const versions = { ...defaultSandboxImageVersions, ...input.versions };
  for (const [name, version] of Object.entries(versions)) validateVersion(name, version);

  const tag = input.tag ?? `anvia-sandbox-${input.name}:latest`;
  validateImageTag(tag);

  return {
    name: input.name,
    tag,
    runtimes: runtimeOrder.filter((runtime) => runtimes.has(runtime)),
    features: featureOrder.filter((feature) => features.has(feature)),
    packages,
    versions,
  };
}

export function renderSandboxImageContext(
  spec: SandboxImageSpec,
  generatorVersion: string,
): SandboxImageContext {
  const files = new Map<string, string>();
  const pipRequirements = [
    ...(spec.features.includes("artifacts") ? artifactPythonPackages : []),
    ...spec.packages.pip,
  ];
  const npmDependencies = npmDependenciesFor(spec);

  files.set("Dockerfile", `${renderDockerfile(spec, pipRequirements, npmDependencies)}\n`);
  files.set(
    ".dockerignore",
    renderDockerignore(pipRequirements.length > 0, npmDependencies.size > 0),
  );

  if (pipRequirements.length > 0) {
    files.set("requirements.txt", `${unique(pipRequirements).join("\n")}\n`);
  }
  if (npmDependencies.size > 0) {
    files.set(
      "package.json",
      `${JSON.stringify(
        {
          private: true,
          description: `Generated dependencies for ${spec.name}`,
          dependencies: Object.fromEntries(npmDependencies),
        },
        null,
        2,
      )}\n`,
    );
  }

  const generatedFiles = [...files.keys(), "anvia-sandbox.json"].sort();
  const manifest: SandboxImageManifest = {
    schemaVersion: 1,
    generatedBy: {
      package: "@anvia/sandbox",
      version: generatorVersion,
    },
    ...spec,
    generatedFiles,
  };
  files.set("anvia-sandbox.json", `${JSON.stringify(manifest, null, 2)}\n`);

  return { manifest, files };
}

export function unpinnedSandboxImagePackages(spec: SandboxImageSpec): string[] {
  const unpinned = spec.packages.apt.filter((value) => !value.includes("="));
  for (const value of spec.packages.npm) {
    if (parseNpmPackageSpec(value).version === "latest") unpinned.push(value);
  }
  for (const value of spec.packages.pip) {
    if (!/===|==|@\s*https?:/i.test(value)) unpinned.push(value);
  }
  return unpinned;
}

function renderDockerfile(
  spec: SandboxImageSpec,
  pipRequirements: readonly string[],
  npmDependencies: ReadonlyMap<string, string>,
): string {
  const hasNode = spec.runtimes.includes("node");
  const hasBun = spec.runtimes.includes("bun");
  const hasPython = spec.runtimes.includes("python");
  const hasPlaywright = spec.features.includes("playwright");
  const lines = [
    "# Generated by @anvia/sandbox. Edit the manifest and regenerate instead of editing this file.",
  ];

  if (hasNode) lines.push(`FROM node:${spec.versions.node}-bookworm-slim AS node-runtime`);
  if (hasPython) lines.push(`FROM python:${spec.versions.python}-slim-bookworm AS python-runtime`);
  if (hasBun) lines.push(`FROM oven/bun:${spec.versions.bun}-slim AS bun-runtime`);
  if (hasPython) lines.push(`FROM ghcr.io/astral-sh/uv:${spec.versions.uv} AS uv-runtime`);

  if (hasPlaywright) {
    lines.push(`FROM mcr.microsoft.com/playwright:v${spec.versions.playwright}-noble AS final`);
  } else if (hasPython) {
    lines.push("FROM python-runtime AS final");
  } else if (hasNode) {
    lines.push("FROM node-runtime AS final");
  } else {
    lines.push("FROM bun-runtime AS final");
  }

  lines.push("", "USER root");

  if (hasPython && (hasPlaywright || !isFinalRuntime(spec, "python"))) {
    lines.push("COPY --from=python-runtime /usr/local/ /usr/local/");
  }
  if (hasNode && (hasPlaywright || !isFinalRuntime(spec, "node"))) {
    lines.push("COPY --from=node-runtime /usr/local/bin/ /usr/local/bin/");
    lines.push(
      "COPY --from=node-runtime /usr/local/lib/node_modules/ /usr/local/lib/node_modules/",
    );
  }
  if (hasBun && !isFinalRuntime(spec, "bun")) {
    lines.push("COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun");
    lines.push("RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx");
  }
  if (hasPython) {
    lines.push("COPY --from=uv-runtime /uv /uvx /usr/local/bin/");
  }

  const aptPackages = unique([
    ...commonAptPackages,
    ...(spec.features.includes("artifacts") ? ["fonts-dejavu-core"] : []),
    ...spec.packages.apt,
  ]).sort();
  lines.push(
    "",
    "RUN apt-get update \\",
    `  && apt-get install -y --no-install-recommends ${aptPackages.map(shellQuote).join(" ")} \\`,
    "  && rm -rf /var/lib/apt/lists/*",
  );

  if (hasNode) {
    lines.push(
      "",
      `RUN npm install --global ${shellQuote(`pnpm@${spec.versions.pnpm}`)} --no-audit --no-fund \\`,
      "  && npm cache clean --force",
    );
  }

  if (pipRequirements.length > 0) {
    lines.push(
      "",
      "COPY requirements.txt /tmp/anvia/requirements.txt",
      "RUN uv pip install --system --no-cache --requirement /tmp/anvia/requirements.txt \\",
      "  && rm -rf /tmp/anvia",
    );
  }

  if (npmDependencies.size > 0) {
    lines.push("", "COPY package.json /opt/anvia-js/package.json");
    if (hasNode) {
      lines.push(
        "RUN npm install --prefix /opt/anvia-js --omit=dev --no-audit --no-fund \\",
        "  && ln -s /opt/anvia-js/node_modules /node_modules \\",
        "  && npm cache clean --force",
      );
    } else {
      lines.push(
        "RUN cd /opt/anvia-js \\",
        "  && bun install --production --no-save \\",
        "  && ln -s /opt/anvia-js/node_modules /node_modules",
      );
    }
    lines.push("ENV NODE_PATH=/opt/anvia-js/node_modules");
    lines.push("ENV PATH=/opt/anvia-js/node_modules/.bin:$PATH");
  }

  lines.push(
    "",
    ...(hasPlaywright ? ["ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright"] : []),
    "RUN mkdir -p /workspace",
    "WORKDIR /workspace",
    "ENTRYPOINT []",
    'CMD ["sh", "-c", "trap \'exit 0\' TERM INT; while :; do sleep 3600 & wait $!; done"]',
  );

  return lines.join("\n");
}

function renderDockerignore(hasPip: boolean, hasNpm: boolean): string {
  return [
    "**",
    "!Dockerfile",
    "!.dockerignore",
    "!anvia-sandbox.json",
    ...(hasPip ? ["!requirements.txt"] : []),
    ...(hasNpm ? ["!package.json"] : []),
    "",
  ].join("\n");
}

function npmDependenciesFor(spec: SandboxImageSpec): Map<string, string> {
  const dependencies = new Map<string, string>();
  if (spec.features.includes("playwright")) {
    dependencies.set("playwright", spec.versions.playwright);
  }
  for (const packageSpec of spec.packages.npm) {
    const parsed = parseNpmPackageSpec(packageSpec);
    if (dependencies.has(parsed.name)) {
      throw new Error(`Duplicate npm package: ${parsed.name}`);
    }
    dependencies.set(parsed.name, parsed.version);
  }
  return new Map([...dependencies.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function isFinalRuntime(spec: SandboxImageSpec, runtime: SandboxImageRuntime): boolean {
  if (spec.features.includes("playwright")) return false;
  if (spec.runtimes.includes("python")) return runtime === "python";
  if (spec.runtimes.includes("node")) return runtime === "node";
  return runtime === "bun";
}

function validateName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
    throw new Error(
      "Image name must be 1-63 lowercase letters, numbers, or hyphens and cannot start with a hyphen.",
    );
  }
}

function validateRuntime(runtime: string): asserts runtime is SandboxImageRuntime {
  if (!runtimeOrder.includes(runtime as SandboxImageRuntime)) {
    throw new Error(`Unknown runtime: ${runtime}. Expected node, bun, or python.`);
  }
}

function validateFeature(feature: string): asserts feature is SandboxImageFeature {
  if (!featureOrder.includes(feature as SandboxImageFeature)) {
    throw new Error(`Unknown feature: ${feature}. Expected artifacts or playwright.`);
  }
}

function validateAptPackage(packageName: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.+:~=-]*$/.test(packageName)) {
    throw new Error(`Invalid apt package: ${packageName}`);
  }
}

function parseNpmPackageSpec(packageSpec: string): { name: string; version: string } {
  if (/\s/.test(packageSpec) || hasControlCharacter(packageSpec)) {
    throw new Error(`Invalid npm package spec: ${packageSpec}`);
  }

  const separator = packageSpec.startsWith("@")
    ? packageSpec.indexOf("@", packageSpec.indexOf("/") + 1)
    : packageSpec.indexOf("@");
  const name = separator === -1 ? packageSpec : packageSpec.slice(0, separator);
  const version = separator === -1 ? "latest" : packageSpec.slice(separator + 1);

  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name) || !version) {
    throw new Error(`Invalid npm package spec: ${packageSpec}`);
  }
  if (/[\s'"`$;&|<>\\]/.test(version) || hasControlCharacter(version)) {
    throw new Error(`Invalid npm package version in: ${packageSpec}`);
  }
  return { name, version };
}

function validatePipRequirement(requirement: string): void {
  if (!requirement || requirement.startsWith("-") || hasControlCharacter(requirement)) {
    throw new Error(`Invalid pip requirement: ${requirement}`);
  }
}

function validateVersion(name: string, version: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version)) {
    throw new Error(`Invalid ${name} version: ${version}`);
  }
}

function validateImageTag(tag: string): void {
  if (
    !tag ||
    tag.startsWith("-") ||
    tag.includes("@") ||
    /\s/.test(tag) ||
    hasControlCharacter(tag)
  ) {
    throw new Error(`Invalid Docker image tag: ${tag}`);
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
