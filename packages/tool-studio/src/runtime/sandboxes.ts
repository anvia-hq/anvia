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

export type StudioSandboxRegistryEntry = {
  inspector: StudioSandboxInspector;
  summary: StudioSandboxSummary;
  views: ReadonlyMap<string, StudioSandboxViewRegistration>;
};

export class StudioSandboxRegistry {
  private readonly entries: Map<string, StudioSandboxRegistryEntry>;

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
}

export function createStudioSandboxRegistry(
  agents: StudioAgent[],
  registrations: readonly StudioSandboxRegistration[],
): StudioSandboxRegistry {
  const agentIds = new Set(agents.map((agent) => agent.id));
  const refs = new Set<string>();
  const entries = registrations.map((registration, index): StudioSandboxRegistryEntry => {
    validateRegistration(registration, index, agentIds);
    const inspector = registration.inspector;
    const ref = sandboxRef(inspector.provider, inspector.id);
    if (refs.has(ref)) {
      throw new TypeError(
        `sandboxes contains a duplicate provider/id registration: ${inspector.provider}/${inspector.id}`,
      );
    }
    refs.add(ref);
    const views = new Map((registration.views ?? []).map((view) => [view.id, view]));
    return {
      inspector,
      views,
      summary: {
        ref,
        id: inspector.id,
        provider: inspector.provider,
        workdir: inspector.workdir,
        agentIds: sortedUnique(registration.agentIds ?? []),
        toolNames: sortedUnique(registration.toolNames ?? []),
        views: [...views.values()]
          .map((view) => ({ id: view.id, label: view.label, protocol: view.source.protocol }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        capabilities: {
          files: supportsFiles(inspector),
          ports: supportsPorts(inspector),
          processes: supportsProcesses(inspector),
          views: views.size > 0,
        },
      },
    };
  });
  entries.sort((left, right) => left.summary.ref.localeCompare(right.summary.ref));
  return new StudioSandboxRegistry(entries);
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
  if (!files && !supportsPorts(inspector) && !processes) {
    throw new TypeError(`sandboxes[${index}] inspector exposes no capabilities.`);
  }
  for (const agentId of sortedUnique(registration.agentIds ?? [])) {
    if (!knownAgentIds.has(agentId)) {
      throw new TypeError(`sandboxes[${index}] references an unknown agent: ${agentId}`);
    }
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
  if (!supportsPorts(inspector)) {
    throw new TypeError(`sandboxes[${registrationIndex}] views require published port inspection.`);
  }
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
      !isPort(source.containerPort) ||
      !isRecord(source.control) ||
      typeof source.control.snapshot !== "function" ||
      typeof source.control.acquireHumanControl !== "function"
    ) {
      throw new TypeError(`${prefix}.source must be a valid noVNC view source.`);
    }
    const port = inspector.publishedPorts?.find(
      (candidate) =>
        candidate.containerPort === source.containerPort && candidate.protocol === "tcp",
    );
    if (port === undefined || !isLoopbackHost(port.host)) {
      throw new TypeError(`${prefix}.source must resolve to a loopback-published TCP port.`);
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
