import type { JsonValue } from "@anvia/core/completion";
import type { Context, Next } from "hono";
import type { StudioCapability, StudioErrorCode, StudioErrorResponse } from "../types";
import { isObject } from "./type-guards";

/**
 * Hostnames trusted by default by the Studio HTTP API. Studio defaults to a
 * loopback bind address, so only loopback callers are trusted unless the
 * operator explicitly allows more. Ports are ignored because callers may
 * reach Studio on any configured port.
 *
 * Binding to 0.0.0.0 (or ::) exposes Studio on every interface; requests then
 * arrive with whatever hostname clients use, so operators must list those
 * hostnames in `allowedHosts` (see `StudioServeOptions`).
 */
export const STUDIO_LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Hostnames accepted by the Studio HTTP API for this server instance: the
 * loopback set, plus operator-configured `allowedHosts`, plus the explicit
 * non-wildcard `hostname` the server bound to (for example a LAN address
 * inside Docker). Wildcard binds (0.0.0.0, ::, or empty) add nothing, so
 * operators binding to all interfaces must list client-facing hostnames in
 * `allowedHosts` instead.
 */
export function resolveStudioAllowedHostnames(options?: {
  allowedHosts?: readonly string[];
  hostname?: string;
}): Set<string> {
  const allowed = new Set<string>(STUDIO_LOCAL_HOSTNAMES);
  for (const host of options?.allowedHosts ?? []) {
    const normalized = normalizeHostname(host);
    if (normalized !== "") allowed.add(normalized);
  }
  const bound = normalizeHostname(options?.hostname ?? "");
  if (bound !== "" && bound !== "0.0.0.0" && bound !== "::" && !allowed.has(bound)) {
    allowed.add(bound);
    // Host headers carry IPv6 literals bracketed (e.g. "[2001:db8::1]"), while
    // the configured bind address is unbracketed, so trust both spellings.
    if (bound.includes(":")) allowed.add(`[${bound}]`);
  }
  return allowed;
}

function isAllowedHostname(hostname: string | undefined, allowed: Set<string>): boolean {
  return hostname !== undefined && allowed.has(hostname.trim().toLowerCase());
}

/**
 * Reject requests that cannot come from the local Studio UI: a Host header
 * that is not in the allowed Host set (DNS rebinding), or an Origin header
 * whose host is not in the allowed set (cross-origin page). The Origin rule
 * follows the same allowlist, so a non-loopback Origin is accepted only when
 * its host was explicitly allowed.
 */
export function createStudioHostGuard(options?: {
  allowedHosts?: readonly string[];
  hostname?: string;
}): (c: Context, next: Next) => Promise<Response | void> {
  const allowed = resolveStudioAllowedHostnames(options);
  // A missing Host header only happens for in-process fetch callers; servers
  // on the wire always provide one, so there is nothing to validate.
  return async function studioHostGuard(c: Context, next: Next): Promise<Response | void> {
    const host = c.req.header("host");
    if (host !== undefined && !isAllowedHostname(studioRequestHostname(host), allowed)) {
      return errorResponse(c, 403, "forbidden", "Host not allowed");
    }
    const origin = c.req.header("origin");
    if (origin !== undefined && !isAllowedOrigin(origin, allowed)) {
      return errorResponse(c, 403, "forbidden", "Origin not allowed");
    }
    return next();
  };
}

function studioRequestHostname(hostHeader: string | undefined): string | undefined {
  if (hostHeader === undefined) return undefined;
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) return undefined;
    return host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(":");
  // A single colon can only be a port separator; IPv6 literals arrive bracketed.
  if (colon !== -1 && host.indexOf(":") === colon) return host.slice(0, colon);
  return host;
}

function isAllowedOrigin(origin: string, allowed: Set<string>): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return isAllowedHostname(url.hostname, allowed);
}

export function errorResponse(
  c: Context,
  status: 400 | 403 | 404 | 409 | 413 | 500 | 501 | 502 | 503,
  code: StudioErrorCode,
  message: string,
  details?: JsonValue,
): Response {
  const body: StudioErrorResponse = {
    error: {
      code,
      message,
    },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  return c.json(body, status);
}

export function unsupportedCapability(c: Context, capability: StudioCapability): Response {
  return errorResponse(
    c,
    501,
    "unsupported_capability",
    `Capability "${capability}" is not implemented by this runner`,
    { capability },
  );
}

/**
 * Parse and validate a JSON request body.
 *
 * Returns the validated result from `validate`, or an error response
 * if the body is not valid JSON or fails validation.
 */
export async function parseJsonBody<T>(
  c: Context,
  validate: (body: unknown) => T | { error: Response },
): Promise<T | { error: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be JSON") };
  }

  if (!isObject(body)) {
    return { error: errorResponse(c, 400, "bad_request", "Request body must be an object") };
  }

  return validate(body);
}
