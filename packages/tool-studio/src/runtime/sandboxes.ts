import path from "node:path";
import type { Context, Hono, Next } from "hono";
import type {
  StudioAgent,
  StudioErrorCode,
  StudioSandboxFileEntry,
  StudioSandboxFileType,
  StudioSandboxInspector,
  StudioSandboxProcess,
  StudioSandboxProcessLogsResponse,
  StudioSandboxProcessStatus,
  StudioSandboxRegistration,
  StudioSandboxSummary,
  StudioSandboxViewRegistration,
} from "../types";
import { serializeError } from "./errors";
import { errorResponse } from "./http";

const maxFileResponseBytes = 10 * 1024 * 1024;
const defaultProcessLogBytes = 64 * 1024;
const maxProcessLogBytes = 1024 * 1024;
const studioSandboxMetadataSymbol = Symbol.for("anvia.studio.sandbox");

type StudioSandboxToolMetadataLike = {
  getStudioSandbox(): StudioSandboxRegistration;
};

export type StudioSandboxRegistryEntry = {
  inspector: StudioSandboxInspector;
  summary: StudioSandboxSummary;
  views: ReadonlyMap<string, StudioSandboxViewRegistration>;
  dispose?: () => Promise<void> | void;
};

export class StudioSandboxRegistry {
  private readonly entries: Map<string, StudioSandboxRegistryEntry>;
  private disposePromise: Promise<void> | undefined;

  constructor(entries: StudioSandboxRegistryEntry[]) {
    this.entries = new Map(entries.map((entry) => [entry.summary.ref, entry]));
  }

  get size(): number {
    return this.entries.size;
  }

  list(): StudioSandboxSummary[] {
    return [...this.entries.values()].map((entry) => copySummary(entry.summary));
  }

  get(ref: string): StudioSandboxRegistryEntry | undefined {
    return this.entries.get(ref);
  }

  disposeAll(): Promise<void> {
    this.disposePromise ??= this.runDisposers();
    return this.disposePromise;
  }

  private async runDisposers(): Promise<void> {
    const disposers = new Set<() => Promise<void> | void>();

    for (const entry of this.entries.values()) {
      if (entry.dispose !== undefined) {
        disposers.add(entry.dispose);
      }
    }

    const failures: unknown[] = [];

    for (const dispose of disposers) {
      try {
        await dispose();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length === 1) throw failures[0];

    if (failures.length > 1) {
      throw new AggregateError(failures, "Failed to dispose Studio sandboxes.");
    }
  }
}

export function createStudioSandboxRegistry(
  agents: StudioAgent[],
  registrations: readonly StudioSandboxRegistration[],
  options: { autoDiscover?: boolean } = {},
): StudioSandboxRegistry {
  const agentIds = new Set(agents.map((agent) => agent.id));
  const discoveredByRef =
    options.autoDiscover === false
      ? new Map<string, DiscoveredSandbox>()
      : discoverAgentSandboxes(agents, agentIds);
  const refs = new Set<string>();
  const entries: StudioSandboxRegistryEntry[] = [];

  for (const [index, registration] of registrations.entries()) {
    if (!isRecord(registration) || !isInspector(registration.inspector)) {
      throw new TypeError(`sandboxes[${index}] must contain a valid inspector.`);
    }

    const inspector = registration.inspector;
    const ref = sandboxRef(inspector.provider, inspector.id);

    if (refs.has(ref)) {
      throw new TypeError(
        `sandboxes contains a duplicate provider/id registration: ${inspector.provider}/${inspector.id}`,
      );
    }

    refs.add(ref);
    const discovered = discoveredByRef.get(ref);
    discoveredByRef.delete(ref);

    let effectiveAgentIds: readonly string[];

    if (registration.agentIds !== undefined) {
      effectiveAgentIds = registration.agentIds;
    } else if (discovered !== undefined) {
      effectiveAgentIds = [...discovered.agentIds];
    } else {
      effectiveAgentIds = [];
    }

    let effectiveToolNames: readonly string[];

    if (registration.toolNames !== undefined) {
      effectiveToolNames = registration.toolNames;
    } else if (discovered !== undefined) {
      effectiveToolNames = [...discovered.toolNames];
    } else {
      effectiveToolNames = [];
    }

    let effectiveViews: readonly StudioSandboxViewRegistration[] | undefined;

    if (registration.views !== undefined) {
      effectiveViews = registration.views;
    } else if (discovered !== undefined && discovered.views.size > 0) {
      effectiveViews = [...discovered.views.values()];
    }

    const effectiveDispose = registration.dispose ?? discovered?.dispose;
    const mergedRegistration: {
      inspector: StudioSandboxInspector;
      agentIds: readonly string[];
      toolNames: readonly string[];
      views?: readonly StudioSandboxViewRegistration[];
      dispose?: () => Promise<void> | void;
    } = {
      inspector,
      agentIds: effectiveAgentIds,
      toolNames: effectiveToolNames,
    };

    if (effectiveViews !== undefined) mergedRegistration.views = effectiveViews;

    if (effectiveDispose !== undefined) mergedRegistration.dispose = effectiveDispose;

    validateRegistration(mergedRegistration, index, agentIds);
    entries.push(
      buildRegistryEntry({
        ref,
        inspector,
        agentIds: sortedUnique(effectiveAgentIds),
        toolNames: sortedUnique(effectiveToolNames),
        views: effectiveViews ?? [],
        dispose: effectiveDispose,
      }),
    );
  }

  for (const [ref, discovered] of discoveredByRef.entries()) {
    const registration: {
      inspector: StudioSandboxInspector;
      agentIds: readonly string[];
      toolNames: readonly string[];
      views: readonly StudioSandboxViewRegistration[];
      dispose?: () => Promise<void> | void;
    } = {
      inspector: discovered.inspector,
      agentIds: [...discovered.agentIds],
      toolNames: [...discovered.toolNames],
      views: [...discovered.views.values()],
    };

    if (discovered.dispose !== undefined) registration.dispose = discovered.dispose;

    validateRegistration(registration, entries.length, agentIds);
    entries.push(
      buildRegistryEntry({
        ref,
        inspector: discovered.inspector,
        agentIds: sortedUnique([...discovered.agentIds]),
        toolNames: sortedUnique([...discovered.toolNames]),
        views: [...discovered.views.values()],
        dispose: discovered.dispose,
      }),
    );
  }

  entries.sort((left, right) => left.summary.ref.localeCompare(right.summary.ref));
  return new StudioSandboxRegistry(entries);
}

type DiscoveredSandbox = {
  inspector: StudioSandboxInspector;
  agentIds: Set<string>;
  toolNames: Set<string>;
  views: Map<string, StudioSandboxViewRegistration>;
  dispose?: () => Promise<void> | void;
};

function buildRegistryEntry(params: {
  ref: string;
  inspector: StudioSandboxInspector;
  agentIds: string[];
  toolNames: string[];
  views: readonly StudioSandboxViewRegistration[];
  dispose: (() => Promise<void> | void) | undefined;
}): StudioSandboxRegistryEntry {
  const views = new Map(params.views.map((view) => [view.id, view]));
  const entry: StudioSandboxRegistryEntry = {
    inspector: params.inspector,
    views,
    summary: {
      ref: params.ref,
      id: params.inspector.id,
      provider: params.inspector.provider,
      workdir: params.inspector.workdir,
      agentIds: params.agentIds,
      toolNames: params.toolNames,
      views: [...views.values()]
        .map((view) => ({ id: view.id, label: view.label, protocol: view.source.protocol }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      capabilities: {
        files: supportsFiles(params.inspector),
        ports: supportsPorts(params.inspector),
        processes: supportsProcesses(params.inspector),
        views: views.size > 0,
      },
    },
  };

  if (params.dispose !== undefined) {
    entry.dispose = params.dispose;
  }

  return entry;
}

function discoverAgentSandboxes(
  agents: readonly StudioAgent[],
  knownAgentIds: ReadonlySet<string>,
): Map<string, DiscoveredSandbox> {
  const discovered = new Map<string, DiscoveredSandbox>();

  for (const studioAgent of agents) {
    const tools = studioAgent.agent?.tools;

    if (!Array.isArray(tools)) continue;

    for (const tool of tools) {
      const candidate = (tool as unknown as Record<PropertyKey, unknown>)[
        studioSandboxMetadataSymbol
      ];

      if (!isSandboxToolMetadata(candidate)) continue;

      const registration = candidate.getStudioSandbox();

      if (!isRecord(registration) || !isInspector(registration.inspector)) continue;

      const ref = sandboxRef(registration.inspector.provider, registration.inspector.id);
      let entry = discovered.get(ref);

      if (entry === undefined) {
        entry = {
          inspector: registration.inspector,
          agentIds: new Set<string>(),
          toolNames: new Set<string>(),
          views: new Map<string, StudioSandboxViewRegistration>(),
        };
        discovered.set(ref, entry);
      } else {
        entry.inspector = mergeInspectors(entry.inspector, registration.inspector);
      }

      entry.agentIds.add(studioAgent.id);

      if (typeof tool.name === "string" && tool.name.length > 0) {
        entry.toolNames.add(tool.name);
      }

      if (Array.isArray(registration.agentIds)) {
        for (const id of registration.agentIds) {
          if (typeof id === "string" && knownAgentIds.has(id)) {
            entry.agentIds.add(id);
          }
        }
      }

      if (Array.isArray(registration.toolNames)) {
        for (const name of registration.toolNames) {
          if (typeof name === "string" && name.length > 0) {
            entry.toolNames.add(name);
          }
        }
      }

      if (Array.isArray(registration.views)) {
        for (const view of registration.views) {
          if (isRecord(view) && typeof view.id === "string" && !entry.views.has(view.id)) {
            entry.views.set(view.id, view as StudioSandboxViewRegistration);
          }
        }
      }

      if (entry.dispose === undefined && typeof registration.dispose === "function") {
        entry.dispose = registration.dispose;
      }
    }
  }

  return discovered;
}

function isSandboxToolMetadata(value: unknown): value is StudioSandboxToolMetadataLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { getStudioSandbox?: unknown }).getStudioSandbox === "function"
  );
}

function mergeInspectors(
  base: StudioSandboxInspector,
  incoming: StudioSandboxInspector,
): StudioSandboxInspector {
  const baseHasCaps = supportsFiles(base) || supportsPorts(base) || supportsProcesses(base);
  const incomingHasCaps =
    supportsFiles(incoming) || supportsPorts(incoming) || supportsProcesses(incoming);
  const merged: {
    -readonly [K in keyof StudioSandboxInspector]: StudioSandboxInspector[K];
  } = {
    id: base.id,
    provider: base.provider,
    workdir: !baseHasCaps && incomingHasCaps ? incoming.workdir : base.workdir,
  };

  if (supportsFiles(base) && base.listFiles !== undefined && base.readFile !== undefined) {
    merged.listFiles = base.listFiles;
    merged.readFile = base.readFile;
  } else if (
    supportsFiles(incoming) &&
    incoming.listFiles !== undefined &&
    incoming.readFile !== undefined
  ) {
    merged.listFiles = incoming.listFiles;
    merged.readFile = incoming.readFile;
  }

  if (supportsPorts(base) && base.publishedPorts !== undefined) {
    merged.publishedPorts = base.publishedPorts;
  } else if (supportsPorts(incoming) && incoming.publishedPorts !== undefined) {
    merged.publishedPorts = incoming.publishedPorts;
  }

  if (
    supportsProcesses(base) &&
    base.listProcesses !== undefined &&
    base.readProcessLogs !== undefined
  ) {
    merged.listProcesses = base.listProcesses;
    merged.readProcessLogs = base.readProcessLogs;
  } else if (
    supportsProcesses(incoming) &&
    incoming.listProcesses !== undefined &&
    incoming.readProcessLogs !== undefined
  ) {
    merged.listProcesses = incoming.listProcesses;
    merged.readProcessLogs = incoming.readProcessLogs;
  }

  return merged;
}

export function registerSandboxRoutes(app: Hono, registry: StudioSandboxRegistry): void {
  app.use("/sandboxes", sandboxNoStore);
  app.use("/sandboxes/*", sandboxNoStore);

  app.get("/sandboxes", (c) => c.json({ sandboxes: registry.list() }));

  app.get("/sandboxes/:sandboxRef", (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));
    return entry === undefined
      ? errorResponse(c, 404, "not_found", "Sandbox not found")
      : c.json(copySummary(entry.summary));
  });

  app.get("/sandboxes/:sandboxRef/files", async (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));

    if (entry === undefined) return errorResponse(c, 404, "not_found", "Sandbox not found");

    if (!supportsFiles(entry.inspector)) return unsupportedSandboxOperation(c, "files");

    try {
      const requestedPath = c.req.query("path") ?? ".";
      const normalizedPath = normalizeSandboxPath(requestedPath, true);
      return c.json({
        sandboxRef: entry.summary.ref,
        path: normalizedPath,
        entries: await listSandboxFiles(entry.inspector, normalizedPath, c.req.raw.signal),
      });
    } catch (error) {
      return sandboxErrorResponse(c, error);
    }
  });

  app.get("/sandboxes/:sandboxRef/files/content", async (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));

    if (entry === undefined) return errorResponse(c, 404, "not_found", "Sandbox not found");

    if (!supportsFiles(entry.inspector)) return unsupportedSandboxOperation(c, "files.content");

    try {
      const requestedPath = c.req.query("path");

      if (requestedPath === undefined) {
        throw new SandboxRouteError(400, "bad_request", "path query parameter is required");
      }

      const download = c.req.query("download");

      if (download !== undefined && download !== "1") {
        throw new SandboxRouteError(400, "bad_request", "download must be 1 when provided");
      }

      const normalizedPath = normalizeSandboxPath(requestedPath, false);
      const siblings = await listSandboxFiles(
        entry.inspector,
        path.posix.dirname(normalizedPath),
        c.req.raw.signal,
      );
      const file = siblings.find((candidate) => candidate.path === normalizedPath);

      if (file === undefined) {
        throw new SandboxRouteError(404, "not_found", "Sandbox file not found");
      }

      if (file.type !== "file") {
        throw new SandboxRouteError(
          400,
          "bad_request",
          "Sandbox content path must refer to a regular file",
        );
      }

      if (file.size !== undefined && file.size > maxFileResponseBytes)
        throw fileTooLarge(file.size);

      const rawBytes = await entry.inspector.readFile({
        path: normalizedPath,
        abortSignal: c.req.raw.signal,
      });

      if (!(rawBytes instanceof Uint8Array)) {
        throw new TypeError("Sandbox readFile returned an invalid byte payload");
      }

      if (rawBytes.byteLength > maxFileResponseBytes) throw fileTooLarge(rawBytes.byteLength);

      const bytes = rawBytes.slice();
      const disposition = download === "1" ? "attachment" : "inline";
      const filename = encodeURIComponent(path.posix.basename(normalizedPath));
      return new Response(bytes, {
        headers: {
          "cache-control": "no-store",
          "content-disposition": `${disposition}; filename*=UTF-8''${filename}`,
          "content-length": `${bytes.byteLength}`,
          "content-type": "application/octet-stream",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      return sandboxErrorResponse(c, error);
    }
  });

  app.get("/sandboxes/:sandboxRef/ports", (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));

    if (entry === undefined) return errorResponse(c, 404, "not_found", "Sandbox not found");

    if (!supportsPorts(entry.inspector)) return unsupportedSandboxOperation(c, "ports");

    try {
      return c.json({
        sandboxRef: entry.summary.ref,
        ports: normalizePorts(entry.inspector.publishedPorts),
      });
    } catch (error) {
      return sandboxErrorResponse(c, error);
    }
  });

  app.get("/sandboxes/:sandboxRef/processes", async (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));

    if (entry === undefined) return errorResponse(c, 404, "not_found", "Sandbox not found");

    if (!supportsProcesses(entry.inspector)) {
      return unsupportedSandboxOperation(c, "processes");
    }

    try {
      return c.json({
        sandboxRef: entry.summary.ref,
        processes: normalizeProcesses(
          await entry.inspector.listProcesses({ abortSignal: c.req.raw.signal }),
        ),
      });
    } catch (error) {
      return sandboxErrorResponse(c, error);
    }
  });

  app.get("/sandboxes/:sandboxRef/processes/:processId/logs", async (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));

    if (entry === undefined) return errorResponse(c, 404, "not_found", "Sandbox not found");

    if (!supportsProcesses(entry.inspector)) {
      return unsupportedSandboxOperation(c, "processes.logs");
    }

    try {
      const tailBytes = parseTailBytes(c.req.query("tailBytes"));
      const processId = c.req.param("processId");
      const processes = normalizeProcesses(
        await entry.inspector.listProcesses({ abortSignal: c.req.raw.signal }),
      );

      if (!processes.some((process) => process.id === processId)) {
        throw new SandboxRouteError(404, "not_found", "Sandbox process not found");
      }

      const logs = normalizeProcessLogs(
        await entry.inspector.readProcessLogs({
          processId,
          tailBytes,
          abortSignal: c.req.raw.signal,
        }),
        tailBytes,
      );
      return c.json({
        sandboxRef: entry.summary.ref,
        processId,
        ...logs,
      } satisfies StudioSandboxProcessLogsResponse);
    } catch (error) {
      return sandboxErrorResponse(c, error);
    }
  });
}

async function sandboxNoStore(c: Context, next: Next): Promise<void> {
  c.header("cache-control", "no-store");
  await next();
}

function validateRegistration(
  registration: StudioSandboxRegistration,
  index: number,
  knownAgentIds: Set<string>,
): void {
  if (!isRecord(registration) || !isInspector(registration.inspector)) {
    throw new TypeError(`sandboxes[${index}] must contain a valid inspector.`);
  }

  const inspector = registration.inspector;
  const files = supportsFiles(inspector);

  if ((inspector.listFiles === undefined) !== (inspector.readFile === undefined)) {
    throw new TypeError(`sandboxes[${index}] must register both file inspector methods.`);
  }

  const processes = supportsProcesses(inspector);

  if ((inspector.listProcesses === undefined) !== (inspector.readProcessLogs === undefined)) {
    throw new TypeError(`sandboxes[${index}] must register both process inspector methods.`);
  }

  const hasViews = Array.isArray(registration.views) && registration.views.length > 0;

  if (!files && !supportsPorts(inspector) && !processes && !hasViews) {
    throw new TypeError(`sandboxes[${index}] inspector exposes no capabilities.`);
  }

  for (const agentId of sortedUnique(registration.agentIds ?? [])) {
    if (!knownAgentIds.has(agentId)) {
      throw new TypeError(`sandboxes[${index}] references an unknown agent: ${agentId}`);
    }
  }

  if (registration.dispose !== undefined && typeof registration.dispose !== "function") {
    throw new TypeError(`sandboxes[${index}].dispose must be a function.`);
  }

  sortedUnique(registration.toolNames ?? []);
  validateViews(registration.views, inspector, index);
}

function validateViews(
  views: readonly StudioSandboxViewRegistration[] | undefined,
  inspector: StudioSandboxInspector,
  registrationIndex: number,
): void {
  if (views === undefined) return;

  if (!Array.isArray(views))
    throw new TypeError(`sandboxes[${registrationIndex}].views must be an array.`);

  const ids = new Set<string>();
  for (const [viewIndex, view] of views.entries()) {
    const prefix = `sandboxes[${registrationIndex}].views[${viewIndex}]`;
    const candidate: unknown = view;

    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      !/^[a-z0-9](?:[a-z0-9_-]{0,62})$/.test(candidate.id)
    ) {
      throw new TypeError(`${prefix}.id must be a stable lowercase identifier.`);
    }

    if (ids.has(candidate.id)) throw new TypeError(`${prefix}.id is duplicated: ${candidate.id}`);

    ids.add(candidate.id);

    if (typeof candidate.label !== "string" || candidate.label.length === 0) {
      throw new TypeError(`${prefix}.label must be a non-empty string.`);
    }

    const source = candidate.source;

    if (
      !isRecord(source) ||
      source.protocol !== "novnc" ||
      !isRecord(source.control) ||
      typeof source.control.snapshot !== "function" ||
      typeof source.control.acquireHumanControl !== "function"
    ) {
      throw new TypeError(`${prefix}.source must be a valid noVNC view source.`);
    }

    if (typeof source.connect === "function") {
      if (source.containerPort !== undefined) {
        throw new TypeError(`${prefix}.source must have either connect or containerPort.`);
      }
    } else {
      if (!isPort(source.containerPort)) {
        throw new TypeError(`${prefix}.source must be a valid noVNC view source.`);
      }

      if (!supportsPorts(inspector)) {
        throw new TypeError(
          `${prefix} needs published port inspection for a containerPort source.`,
        );
      }

      const port = inspector.publishedPorts?.find(
        (candidate) =>
          candidate.containerPort === source.containerPort && candidate.protocol === "tcp",
      );

      if (port === undefined || !isLoopbackHost(port.host)) {
        throw new TypeError(`${prefix}.source must resolve to a loopback-published TCP port.`);
      }
    }

    const access = candidate.access;

    if (!isRecord(access) || (access.mode !== "local" && access.mode !== "authorize")) {
      throw new TypeError(`${prefix}.access must explicitly select local or authorize mode.`);
    }

    if (access.mode === "authorize" && typeof access.authorize !== "function") {
      throw new TypeError(`${prefix}.access.authorize must be a function.`);
    }

    const authentication = candidate.authentication;

    if (
      !isRecord(authentication) ||
      (authentication.type !== "none" && authentication.type !== "password")
    ) {
      throw new TypeError(`${prefix}.authentication must explicitly select none or password.`);
    }

    if (
      authentication.type === "password" &&
      (typeof authentication.password !== "string" || authentication.password.length === 0)
    ) {
      throw new TypeError(`${prefix}.authentication.password must be a non-empty string.`);
    }
  }
}

function isInspector(value: unknown): value is StudioSandboxInspector {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.provider === "string" &&
    value.provider.length > 0 &&
    typeof value.workdir === "string" &&
    value.workdir.length > 0
  );
}

function supportsFiles(
  inspector: StudioSandboxInspector,
): inspector is StudioSandboxInspector &
  Required<Pick<StudioSandboxInspector, "listFiles" | "readFile">> {
  return typeof inspector.listFiles === "function" && typeof inspector.readFile === "function";
}

function supportsPorts(inspector: StudioSandboxInspector): boolean {
  return Array.isArray(inspector.publishedPorts);
}

function supportsProcesses(
  inspector: StudioSandboxInspector,
): inspector is StudioSandboxInspector &
  Required<Pick<StudioSandboxInspector, "listProcesses" | "readProcessLogs">> {
  return (
    typeof inspector.listProcesses === "function" && typeof inspector.readProcessLogs === "function"
  );
}

function sandboxRef(provider: string, id: string): string {
  return Buffer.from(JSON.stringify([provider, id]), "utf8").toString("base64url");
}

function copySummary(summary: StudioSandboxSummary): StudioSandboxSummary {
  return {
    ...summary,
    agentIds: [...summary.agentIds],
    toolNames: [...summary.toolNames],
    views: summary.views.map((view) => ({ ...view })),
    capabilities: { ...summary.capabilities },
  };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

async function listSandboxFiles(
  inspector: StudioSandboxInspector &
    Required<Pick<StudioSandboxInspector, "listFiles" | "readFile">>,
  filePath: string,
  abortSignal: AbortSignal,
): Promise<StudioSandboxFileEntry[]> {
  return normalizeFileEntries(await inspector.listFiles({ path: filePath, abortSignal })).sort(
    (left, right) => {
      if (left.type === "directory" && right.type !== "directory") return -1;

      if (left.type !== "directory" && right.type === "directory") return 1;

      return left.path.localeCompare(right.path);
    },
  );
}

function normalizeFileEntries(value: unknown): StudioSandboxFileEntry[] {
  if (!Array.isArray(value)) throw new TypeError("Sandbox listFiles returned an invalid payload");

  return value.map((item) => {
    if (!isRecord(item) || typeof item.path !== "string" || !isFileType(item.type)) {
      throw new TypeError("Sandbox listFiles returned an invalid entry");
    }

    let entryPath: string;
    try {
      entryPath = normalizeSandboxPath(item.path, false);
    } catch {
      throw new TypeError("Sandbox listFiles returned an invalid entry path");
    }
    const entry: StudioSandboxFileEntry = { path: entryPath, type: item.type };

    if (item.size !== undefined) {
      if (!Number.isSafeInteger(item.size) || Number(item.size) < 0) {
        throw new TypeError("Sandbox listFiles returned an invalid file size");
      }

      entry.size = item.size as number;
    }

    return entry;
  });
}

function normalizePorts(value: unknown) {
  if (!Array.isArray(value))
    throw new TypeError("Sandbox publishedPorts returned an invalid payload");

  return value.map((item) => {
    if (
      !isRecord(item) ||
      !isPort(item.containerPort) ||
      typeof item.host !== "string" ||
      !isPort(item.hostPort) ||
      typeof item.protocol !== "string"
    ) {
      throw new TypeError("Sandbox publishedPorts returned an invalid entry");
    }

    return {
      containerPort: item.containerPort,
      host: item.host,
      hostPort: item.hostPort,
      protocol: item.protocol,
    };
  });
}

function normalizeProcesses(value: unknown): StudioSandboxProcess[] {
  if (!Array.isArray(value))
    throw new TypeError("Sandbox listProcesses returned an invalid payload");

  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.command !== "string" ||
      !Array.isArray(item.args) ||
      !item.args.every((arg) => typeof arg === "string") ||
      !isProcessStatus(item.status) ||
      typeof item.startedAt !== "string"
    ) {
      throw new TypeError("Sandbox listProcesses returned an invalid entry");
    }

    const process: StudioSandboxProcess = {
      id: item.id,
      command: item.command,
      args: [...item.args],
      status: item.status,
      startedAt: item.startedAt,
    };

    if (typeof item.cwd === "string") process.cwd = item.cwd;

    if (typeof item.exitCode === "number") process.exitCode = item.exitCode;

    if (typeof item.endedAt === "string") process.endedAt = item.endedAt;

    return process;
  });
}

function normalizeProcessLogs(
  value: unknown,
  maxBytes: number,
): Omit<StudioSandboxProcessLogsResponse, "sandboxRef" | "processId"> {
  if (
    !isRecord(value) ||
    !(value.stdout instanceof Uint8Array) ||
    !(value.stderr instanceof Uint8Array) ||
    typeof value.stdoutTruncated !== "boolean" ||
    typeof value.stderrTruncated !== "boolean"
  ) {
    throw new TypeError("Sandbox readProcessLogs returned an invalid payload");
  }

  const stdout = boundedLogBytes(value.stdout, maxBytes);
  const stderr = boundedLogBytes(value.stderr, maxBytes);
  return {
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: value.stdoutTruncated || stdout.truncated,
    stderrTruncated: value.stderrTruncated || stderr.truncated,
  };
}

function boundedLogBytes(
  value: Uint8Array,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (maxBytes === 0) return { text: "", truncated: value.byteLength > 0 };

  let start = Math.max(0, value.byteLength - maxBytes);
  while (start < value.byteLength && ((value[start] ?? 0) & 0xc0) === 0x80) start += 1;
  return {
    text: new TextDecoder("utf-8", { fatal: true }).decode(value.subarray(start)),
    truncated: start > 0,
  };
}

function normalizeSandboxPath(input: string, allowRoot: boolean): string {
  if (input.length === 0) {
    throw new SandboxRouteError(400, "bad_request", "Sandbox path cannot be empty");
  }

  if (input.includes("\0")) {
    throw new SandboxRouteError(400, "bad_request", "Sandbox path cannot contain null bytes");
  }

  const normalized = path.posix.normalize(input.replaceAll("\\", "/"));

  if (path.posix.isAbsolute(normalized)) {
    throw new SandboxRouteError(400, "bad_request", "Sandbox path must be relative");
  }

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new SandboxRouteError(400, "bad_request", "Sandbox path cannot leave the workspace");
  }

  if (normalized === "." && !allowRoot) {
    throw new SandboxRouteError(400, "bad_request", "Sandbox path must refer to a file");
  }

  return normalized;
}

function parseTailBytes(value: string | undefined): number {
  if (value === undefined) return defaultProcessLogBytes;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxProcessLogBytes) {
    throw new SandboxRouteError(
      400,
      "bad_request",
      `tailBytes must be an integer from 0 through ${maxProcessLogBytes}`,
    );
  }

  return parsed;
}

function unsupportedSandboxOperation(c: Context, operation: string): Response {
  return errorResponse(c, 501, "unsupported_capability", `Sandbox does not support ${operation}`, {
    capability: "sandboxes",
    operation,
  });
}

function sandboxErrorResponse(c: Context, error: unknown): Response {
  if (error instanceof SandboxRouteError) {
    return errorResponse(c, error.status, error.code, error.message);
  }

  const code = errorCode(error);

  if (code === "invalid_path") return errorResponse(c, 400, "bad_request", errorMessage(error));

  if (code === "file_too_large") {
    return errorResponse(c, 413, "payload_too_large", errorMessage(error));
  }

  if (code === "invalid_state" || code === "sandbox_not_found") {
    return errorResponse(c, 409, "conflict", "Sandbox is no longer available");
  }

  return errorResponse(
    c,
    500,
    "internal_error",
    "Sandbox inspection failed",
    serializeError(error),
  );
}

function fileTooLarge(size: number): SandboxRouteError {
  return new SandboxRouteError(
    413,
    "payload_too_large",
    `Sandbox file exceeds the ${maxFileResponseBytes}-byte response limit (${size} bytes)`,
  );
}

class SandboxRouteError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 500 | 501,
    readonly code: StudioErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function sortedUnique(values: readonly string[]): string[] {
  if (!Array.isArray(values)) throw new TypeError("Sandbox associations must be arrays.");

  const result = new Set<string>();
  for (const value of values as readonly unknown[]) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError("Sandbox associations must contain non-empty strings.");
    }

    if (result.has(value)) throw new TypeError(`Sandbox association is duplicated: ${value}`);

    result.add(value);
  }
  return [...result].sort();
}

function isFileType(value: unknown): value is StudioSandboxFileType {
  return value === "file" || value === "directory" || value === "symlink" || value === "other";
}

function isProcessStatus(value: unknown): value is StudioSandboxProcessStatus {
  return value === "running" || value === "exited" || value === "stopped";
}

function isPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65_535;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === "string" ? error.message : "Sandbox failed";
}
