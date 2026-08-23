import { upgradeWebSocket } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Hono } from "hono";
import type { WSContext, WSEvents } from "hono/ws";
import { WebSocket } from "ws";
import type {
  StudioSandboxViewConnection,
  StudioSandboxViewControlLease,
  StudioSandboxViewRegistration,
} from "../types";
import { errorResponse } from "./http";
import type { StudioSandboxRegistry, StudioSandboxRegistryEntry } from "./sandboxes";

const minLeaseTimeoutMs = 5_000;
const maxLeaseTimeoutMs = 120_000;
const maxPendingWebSocketBytes = 1024 * 1024;

type ResolvedView = {
  entry: StudioSandboxRegistryEntry;
  view: StudioSandboxViewRegistration;
  host: string;
  port: number;
};

export function registerSandboxViewRoutes(app: Hono, registry: StudioSandboxRegistry): () => void {
  const leases = new Map<string, StudioSandboxViewControlLease>();
  const upstreamSockets = new Set<WebSocket>();

  app.get("/sandboxes/:sandboxRef/views/:viewId/control", async (c) => {
    const resolved = await authorizedView(c, registry);
    if (resolved instanceof Response) return resolved;
    pruneExpiredLease(leases, viewKey(resolved));
    return c.json(resolved.view.source.control.snapshot());
  });

  app.get("/sandboxes/:sandboxRef/views/:viewId/connection", async (c) => {
    const resolved = await authorizedView(c, registry);
    if (resolved instanceof Response) return resolved;
    const response: StudioSandboxViewConnection = {
      sandboxRef: resolved.entry.summary.ref,
      viewId: resolved.view.id,
      protocol: "novnc",
      websocketPath: `/sandboxes/${encodeURIComponent(resolved.entry.summary.ref)}/views/${encodeURIComponent(resolved.view.id)}/ws`,
      authentication:
        resolved.view.authentication.type === "password"
          ? { type: "password", password: resolved.view.authentication.password }
          : { type: "none" },
    };
    c.header("cache-control", "no-store");
    return c.json(response);
  });

  app.post("/sandboxes/:sandboxRef/views/:viewId/control/acquire", async (c) => {
    const resolved = await authorizedView(c, registry);
    if (resolved instanceof Response) return resolved;
    const body = await readControlBody(c);
    if (body instanceof Response) return body;
    const key = viewKey(resolved);
    pruneExpiredLease(leases, key);
    if (leases.has(key)) {
      return errorResponse(c, 409, "conflict", "Browser view is already controlled");
    }
    try {
      const lease = await resolved.view.source.control.acquireHumanControl({
        ownerId: body.ownerId,
        leaseTimeoutMs: body.leaseTimeoutMs,
        abortSignal: c.req.raw.signal,
      });
      leases.set(key, lease);
      return c.json(leaseResponse(lease), 201);
    } catch (error) {
      return controlErrorResponse(c, error);
    }
  });

  app.post("/sandboxes/:sandboxRef/views/:viewId/control/renew", async (c) => {
    const resolved = await authorizedView(c, registry);
    if (resolved instanceof Response) return resolved;
    const body = await readLeaseBody(c);
    if (body instanceof Response) return body;
    const key = viewKey(resolved);
    pruneExpiredLease(leases, key);
    const lease = leases.get(key);
    if (lease === undefined || lease.id !== body.leaseId) {
      return errorResponse(c, 409, "conflict", "Browser control lease is not active");
    }
    try {
      lease.renew({ leaseTimeoutMs: body.leaseTimeoutMs });
      return c.json(leaseResponse(lease));
    } catch (error) {
      leases.delete(key);
      return controlErrorResponse(c, error);
    }
  });

  app.post("/sandboxes/:sandboxRef/views/:viewId/control/release", async (c) => {
    const resolved = await authorizedView(c, registry);
    if (resolved instanceof Response) return resolved;
    const body = await readReleaseBody(c);
    if (body instanceof Response) return body;
    const key = viewKey(resolved);
    const lease = leases.get(key);
    if (lease === undefined || lease.id !== body.leaseId) {
      return errorResponse(c, 409, "conflict", "Browser control lease is not active");
    }
    lease.release();
    leases.delete(key);
    return c.json({ released: true });
  });

  app.get("/sandboxes/:sandboxRef/views/:viewId/ws", async (c) => {
    const resolved = await authorizedView(c, registry);
    if (resolved instanceof Response) return resolved;
    const upstreamUrl = `ws://${hostForUrl(resolved.host)}:${resolved.port}/websockify`;
    return upgradeWebSocket(c, createProxyEvents(upstreamUrl, upstreamSockets), {
      onError: () => undefined,
    });
  });

  return () => {
    for (const lease of leases.values()) lease.release();
    leases.clear();
    for (const socket of upstreamSockets) socket.close(1001, "Studio closed");
    upstreamSockets.clear();
  };
}

function createProxyEvents(upstreamUrl: string, sockets: Set<WebSocket>): WSEvents {
  let upstream: WebSocket | undefined;
  let pendingBytes = 0;
  const pending: Array<string | Uint8Array> = [];
  return {
    onOpen(_event: Event, downstream: WSContext) {
      const protocols =
        downstream.protocol === null || downstream.protocol.length === 0
          ? undefined
          : [downstream.protocol];
      upstream = new WebSocket(upstreamUrl, protocols, {
        headers: { origin: "http://127.0.0.1" },
      });
      sockets.add(upstream);
      upstream.binaryType = "arraybuffer";
      upstream.once("open", () => {
        for (const message of pending) upstream?.send(message);
        pending.length = 0;
        pendingBytes = 0;
      });
      upstream.on("message", (data, isBinary) => {
        const value = isBinary ? Uint8Array.from(Buffer.from(data as never)) : data.toString();
        downstream.send(value);
      });
      upstream.once("close", (code, reason) => {
        sockets.delete(upstream as WebSocket);
        downstream.close(normalizeCloseCode(code), reason.toString("utf8").slice(0, 123));
      });
      upstream.once("error", () => downstream.close(1011, "noVNC upstream failed"));
    },
    onMessage(event, downstream) {
      void normalizeWebSocketMessage(event.data)
        .then((message) => {
          if (upstream?.readyState === WebSocket.OPEN) {
            upstream.send(message);
            return;
          }
          pendingBytes +=
            typeof message === "string" ? Buffer.byteLength(message) : message.byteLength;
          if (pendingBytes > maxPendingWebSocketBytes) {
            downstream.close(1009, "Pending noVNC messages exceeded the limit");
            return;
          }
          pending.push(message);
        })
        .catch(() => downstream.close(1003, "Unsupported noVNC message"));
    },
    onClose() {
      upstream?.close(1000, "Viewer disconnected");
      if (upstream !== undefined) sockets.delete(upstream);
    },
    onError() {
      upstream?.close(1011, "Viewer connection failed");
    },
  };
}

async function authorizedView(
  c: Context,
  registry: StudioSandboxRegistry,
): Promise<ResolvedView | Response> {
  const entry = registry.get(c.req.param("sandboxRef") ?? "");
  if (entry === undefined) return errorResponse(c, 404, "not_found", "Sandbox not found");
  const view = entry.views.get(c.req.param("viewId") ?? "");
  if (view === undefined) return errorResponse(c, 404, "not_found", "Sandbox view not found");
  if (!(await authorize(c, entry, view))) {
    return errorResponse(c, 403, "forbidden", "Sandbox view access denied");
  }
  const published = entry.inspector.publishedPorts?.find(
    (port) =>
      port.containerPort === view.source.containerPort &&
      port.protocol === "tcp" &&
      isLoopbackAddress(port.host),
  );
  if (published === undefined) {
    return errorResponse(c, 503, "internal_error", "Sandbox view port is unavailable");
  }
  return { entry, view, host: published.host, port: published.hostPort };
}

async function authorize(
  c: Context,
  entry: StudioSandboxRegistryEntry,
  view: StudioSandboxViewRegistration,
): Promise<boolean> {
  if (view.access.mode === "authorize") {
    try {
      return (
        (await view.access.authorize({
          request: c.req.raw,
          sandboxRef: entry.summary.ref,
          viewId: view.id,
        })) === true
      );
    } catch {
      return false;
    }
  }
  let remoteAddress: string;
  try {
    const address = getConnInfo(c).remote.address;
    if (address === undefined) return false;
    remoteAddress = address;
  } catch {
    return false;
  }
  if (!isLoopbackAddress(remoteAddress)) return false;
  const expectedOrigin = new URL(c.req.url).origin;
  const origin = c.req.header("origin");
  return (
    origin === expectedOrigin ||
    (origin === undefined && c.req.header("sec-fetch-site") === "same-origin")
  );
}

async function readControlBody(
  c: Context,
): Promise<{ ownerId: string; leaseTimeoutMs: number } | Response> {
  const body = await readJsonObject(c);
  if (body instanceof Response) return body;
  if (typeof body.ownerId !== "string" || body.ownerId.length === 0 || body.ownerId.length > 200) {
    return errorResponse(c, 400, "bad_request", "ownerId must be a non-empty string");
  }
  if (!isLeaseTimeout(body.leaseTimeoutMs)) {
    return errorResponse(c, 400, "bad_request", "leaseTimeoutMs is outside the allowed range");
  }
  return { ownerId: body.ownerId, leaseTimeoutMs: body.leaseTimeoutMs };
}

async function readLeaseBody(
  c: Context,
): Promise<{ leaseId: string; leaseTimeoutMs: number } | Response> {
  const body = await readJsonObject(c);
  if (body instanceof Response) return body;
  if (typeof body.leaseId !== "string" || body.leaseId.length === 0) {
    return errorResponse(c, 400, "bad_request", "leaseId must be a non-empty string");
  }
  if (!isLeaseTimeout(body.leaseTimeoutMs)) {
    return errorResponse(c, 400, "bad_request", "leaseTimeoutMs is outside the allowed range");
  }
  return { leaseId: body.leaseId, leaseTimeoutMs: body.leaseTimeoutMs };
}

async function readReleaseBody(c: Context): Promise<{ leaseId: string } | Response> {
  const body = await readJsonObject(c);
  if (body instanceof Response) return body;
  if (typeof body.leaseId !== "string" || body.leaseId.length === 0) {
    return errorResponse(c, 400, "bad_request", "leaseId must be a non-empty string");
  }
  return { leaseId: body.leaseId };
}

async function readJsonObject(c: Context): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, "bad_request", "Request body must be valid JSON");
  }
  return isRecord(body)
    ? body
    : errorResponse(c, 400, "bad_request", "Request body must be an object");
}

function controlErrorResponse(c: Context, error: unknown): Response {
  if (isRecord(error) && error.code === "human_controlled") {
    return errorResponse(c, 409, "conflict", "Browser view is already controlled");
  }
  if (isRecord(error) && error.code === "invalid_state") {
    return errorResponse(c, 409, "conflict", "Browser control lease is no longer active");
  }
  return errorResponse(c, 500, "internal_error", "Browser control operation failed");
}

function leaseResponse(lease: StudioSandboxViewControlLease) {
  return { id: lease.id, ownerId: lease.ownerId, expiresAt: lease.expiresAt };
}

function pruneExpiredLease(leases: Map<string, StudioSandboxViewControlLease>, key: string): void {
  const lease = leases.get(key);
  if (lease !== undefined && Date.parse(lease.expiresAt) <= Date.now()) {
    lease.release();
    leases.delete(key);
  }
}

function viewKey(resolved: ResolvedView): string {
  return `${resolved.entry.summary.ref}\0${resolved.view.id}`;
}

function isLeaseTimeout(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minLeaseTimeoutMs &&
    Number(value) <= maxLeaseTimeoutMs
  );
}

function isLoopbackAddress(value: string): boolean {
  return (
    value === "localhost" ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value.startsWith("127.") ||
    value.startsWith("::ffff:127.")
  );
}

function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

async function normalizeWebSocketMessage(
  value: unknown,
): Promise<string | Uint8Array<ArrayBuffer>> {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return Uint8Array.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (value instanceof Blob) return Uint8Array.from(new Uint8Array(await value.arrayBuffer()));
  throw new TypeError("Unsupported noVNC WebSocket message type.");
}

function normalizeCloseCode(code: number): number {
  return code >= 1000 && code <= 4999 && code !== 1004 && code !== 1005 && code !== 1006
    ? code
    : 1001;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
