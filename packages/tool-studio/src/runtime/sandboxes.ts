import path from "node:path";
import type { Context, Hono, Next } from "hono";
import type {
  StudioAgent,
  StudioErrorCode,
  StudioSandboxFileEntry,
  StudioSandboxFileType,
  StudioSandboxProcess,
  StudioSandboxProcessLogsResponse,
  StudioSandboxProcessStatus,
  StudioSandboxSummary,
} from "../types";
import { serializeError } from "./errors";
import { errorResponse } from "./http";
import { agentToolItems } from "./tool-metadata";

const sandboxToolMetadataKey = Symbol.for("anvia.sandbox.tool.metadata");
const maxFileResponseBytes = 10 * 1024 * 1024;
const defaultProcessLogBytes = 64 * 1024;
const maxProcessLogBytes = 1024 * 1024;

type SandboxSessionLike = {
  readonly id: string;
  readonly provider: string;
  readonly workdir: string;
  readonly publishedPorts?: unknown;
  listFiles(path?: string): Promise<unknown>;
  readFile(path: string): Promise<unknown>;
  listProcesses?: () => Promise<unknown>;
  readProcessLogs?: (processId: string, options?: { tailBytes?: number }) => Promise<unknown>;
};

type SandboxRegistryEntry = {
  session: SandboxSessionLike;
  summary: StudioSandboxSummary;
};

type SandboxRegistryDraft = {
  session: SandboxSessionLike;
  agentIds: Set<string>;
  toolNames: Set<string>;
};

export class StudioSandboxRegistry {
  private readonly entries: Map<string, SandboxRegistryEntry>;

  constructor(entries: SandboxRegistryEntry[]) {
    this.entries = new Map(entries.map((entry) => [entry.summary.ref, entry]));
  }

  get size(): number {
    return this.entries.size;
  }

  list(): StudioSandboxSummary[] {
    return [...this.entries.values()].map((entry) => copySummary(entry.summary));
  }

  get(ref: string): SandboxRegistryEntry | undefined {
    return this.entries.get(ref);
  }
}

export function createStudioSandboxRegistry(agents: StudioAgent[]): StudioSandboxRegistry {
  const drafts = new Map<SandboxSessionLike, SandboxRegistryDraft>();

  for (const agent of agents) {
    for (const { tool } of agentToolItems(agent)) {
      const session = sandboxSessionFromTool(tool);
      if (session === undefined) {
        continue;
      }

      const draft = drafts.get(session) ?? {
        session,
        agentIds: new Set<string>(),
        toolNames: new Set<string>(),
      };
      draft.agentIds.add(agent.id);
      draft.toolNames.add(tool.name);
      drafts.set(session, draft);
    }
  }

  const refCounts = new Map<string, number>();
  const entries = [...drafts.values()]
    .sort((left, right) =>
      `${left.session.provider}\0${left.session.id}`.localeCompare(
        `${right.session.provider}\0${right.session.id}`,
      ),
    )
    .map((draft): SandboxRegistryEntry => {
      const baseRef = sandboxRef(draft.session.provider, draft.session.id);
      const occurrence = (refCounts.get(baseRef) ?? 0) + 1;
      refCounts.set(baseRef, occurrence);
      const ref = occurrence === 1 ? baseRef : `${baseRef}.${occurrence}`;
      return {
        session: draft.session,
        summary: {
          ref,
          id: draft.session.id,
          provider: draft.session.provider,
          workdir: draft.session.workdir,
          agentIds: [...draft.agentIds].sort(),
          toolNames: [...draft.toolNames].sort(),
          capabilities: {
            files: true,
            ports: supportsPorts(draft.session),
            processes: supportsProcesses(draft.session),
          },
        },
      };
    });

  return new StudioSandboxRegistry(entries);
}

export function registerSandboxRoutes(app: Hono, registry: StudioSandboxRegistry): void {
  app.use("/sandboxes", sandboxNoStore);
  app.use("/sandboxes/*", sandboxNoStore);

  app.get("/sandboxes", (c) => c.json({ sandboxes: registry.list() }));

  app.get("/sandboxes/:sandboxRef", (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));
    if (entry === undefined) {
      return errorResponse(c, 404, "not_found", "Sandbox not found");
    }
    return c.json(copySummary(entry.summary));
  });

  app.get("/sandboxes/:sandboxRef/files", async (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));
    if (entry === undefined) {
      return errorResponse(c, 404, "not_found", "Sandbox not found");
    }

    try {
      const requestedPath = c.req.query("path") ?? ".";
      const normalizedPath = normalizeSandboxPath(requestedPath, true);
      const entries = await listSandboxFiles(entry.session, normalizedPath);
      return c.json({
        sandboxRef: entry.summary.ref,
        path: normalizedPath,
        entries,
      });
    } catch (error) {
      return sandboxErrorResponse(c, error);
    }
  });

  app.get("/sandboxes/:sandboxRef/files/content", async (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));
    if (entry === undefined) {
      return errorResponse(c, 404, "not_found", "Sandbox not found");
    }

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
      const parentPath = path.posix.dirname(normalizedPath);
      const siblings = await listSandboxFiles(entry.session, parentPath);
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
      if (file.size !== undefined && file.size > maxFileResponseBytes) {
        throw fileTooLarge(file.size);
      }

      const rawBytes = await entry.session.readFile(normalizedPath);
      if (!(rawBytes instanceof Uint8Array)) {
        throw new TypeError("Sandbox readFile returned an invalid byte payload");
      }
      if (rawBytes.byteLength > maxFileResponseBytes) {
        throw fileTooLarge(rawBytes.byteLength);
      }

      const bytes = new Uint8Array(rawBytes.byteLength);
      bytes.set(rawBytes);
      const disposition = download === "1" ? "attachment" : "inline";
      const filename = encodeURIComponent(path.posix.basename(normalizedPath));
      return new Response(bytes, {
        headers: {
          "cache-control": "no-store",
          "content-disposition": `${disposition}; filename*=UTF-8''${filename}`,
          "content-length": String(bytes.byteLength),
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
    if (entry === undefined) {
      return errorResponse(c, 404, "not_found", "Sandbox not found");
    }
    if (!supportsPorts(entry.session)) {
      return unsupportedSandboxOperation(c, "ports");
    }

    try {
      return c.json({
        sandboxRef: entry.summary.ref,
        ports: normalizePorts(entry.session.publishedPorts),
      });
    } catch (error) {
      return sandboxErrorResponse(c, error);
    }
  });

  app.get("/sandboxes/:sandboxRef/processes", async (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));
    if (entry === undefined) {
      return errorResponse(c, 404, "not_found", "Sandbox not found");
    }
    if (!supportsProcesses(entry.session)) {
      return unsupportedSandboxOperation(c, "processes");
    }

    try {
      return c.json({
        sandboxRef: entry.summary.ref,
        processes: normalizeProcesses(await entry.session.listProcesses()),
      });
    } catch (error) {
      return sandboxErrorResponse(c, error);
    }
  });

  app.get("/sandboxes/:sandboxRef/processes/:processId/logs", async (c) => {
    const entry = registry.get(c.req.param("sandboxRef"));
    if (entry === undefined) {
      return errorResponse(c, 404, "not_found", "Sandbox not found");
    }
    if (!supportsProcesses(entry.session)) {
      return unsupportedSandboxOperation(c, "processes.logs");
    }

    try {
      const tailBytes = parseTailBytes(c.req.query("tailBytes"));
      const processId = c.req.param("processId");
      const processes = normalizeProcesses(await entry.session.listProcesses());
      if (!processes.some((process) => process.id === processId)) {
        throw new SandboxRouteError(404, "not_found", "Sandbox process not found");
      }
      const logs = normalizeProcessLogs(
        await entry.session.readProcessLogs(processId, { tailBytes }),
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

function sandboxSessionFromTool(tool: object): SandboxSessionLike | undefined {
  const metadata = (tool as { [sandboxToolMetadataKey]?: unknown })[sandboxToolMetadataKey];
  if (!isRecord(metadata)) {
    return undefined;
  }
  return isSandboxSession(metadata.session) ? metadata.session : undefined;
}

function isSandboxSession(value: unknown): value is SandboxSessionLike {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.provider === "string" &&
    value.provider.length > 0 &&
    typeof value.workdir === "string" &&
    value.workdir.length > 0 &&
    typeof value.listFiles === "function" &&
    typeof value.readFile === "function"
  );
}

function supportsPorts(session: SandboxSessionLike): boolean {
  return Array.isArray(session.publishedPorts);
}

function supportsProcesses(
  session: SandboxSessionLike,
): session is SandboxSessionLike &
  Required<Pick<SandboxSessionLike, "listProcesses" | "readProcessLogs">> {
  return (
    typeof session.listProcesses === "function" && typeof session.readProcessLogs === "function"
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
    capabilities: { ...summary.capabilities },
  };
}

async function listSandboxFiles(
  session: SandboxSessionLike,
  filePath: string,
): Promise<StudioSandboxFileEntry[]> {
  return normalizeFileEntries(await session.listFiles(filePath)).sort((left, right) => {
    if (left.type === "directory" && right.type !== "directory") return -1;
    if (left.type !== "directory" && right.type === "directory") return 1;
    return left.path.localeCompare(right.path);
  });
}

function normalizeFileEntries(value: unknown): StudioSandboxFileEntry[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Sandbox listFiles returned an invalid payload");
  }
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
      if (typeof item.size !== "number" || !Number.isFinite(item.size) || item.size < 0) {
        throw new TypeError("Sandbox listFiles returned an invalid file size");
      }
      entry.size = item.size;
    }
    return entry;
  });
}

function normalizePorts(value: unknown) {
  if (!Array.isArray(value)) {
    throw new TypeError("Sandbox publishedPorts returned an invalid payload");
  }
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
  if (!Array.isArray(value)) {
    throw new TypeError("Sandbox listProcesses returned an invalid payload");
  }
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
      args: item.args,
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
    typeof value.stdout !== "string" ||
    typeof value.stderr !== "string" ||
    typeof value.stdoutTruncated !== "boolean" ||
    typeof value.stderrTruncated !== "boolean"
  ) {
    throw new TypeError("Sandbox readProcessLogs returned an invalid payload");
  }
  const stdout = boundedLogText(value.stdout, maxBytes);
  const stderr = boundedLogText(value.stderr, maxBytes);
  return {
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: value.stdoutTruncated || stdout.truncated,
    stderrTruncated: value.stderrTruncated || stderr.truncated,
  };
}

function boundedLogText(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }
  if (maxBytes === 0) {
    return { text: "", truncated: true };
  }

  let start = bytes.byteLength - maxBytes;
  while (start < bytes.byteLength && (bytes[start] ?? 0) >> 6 === 2) {
    start += 1;
  }
  return {
    text: new TextDecoder().decode(bytes.subarray(start)),
    truncated: true,
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
  if (value === undefined) {
    return defaultProcessLogBytes;
  }
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
  const name = errorName(error);
  if (name === "SandboxPathError") {
    return errorResponse(c, 400, "bad_request", errorMessage(error));
  }
  if (name === "SandboxFileSizeError") {
    return errorResponse(c, 413, "payload_too_large", errorMessage(error));
  }
  if (name === "SandboxSessionDestroyedError") {
    return errorResponse(c, 409, "conflict", "Sandbox session is no longer available");
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
  return typeof value === "object" && value !== null;
}

function errorName(error: unknown): string {
  return isRecord(error) && typeof error.name === "string" ? error.name : "";
}

function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === "string" ? error.message : String(error);
}
