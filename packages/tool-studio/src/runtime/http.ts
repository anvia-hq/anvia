import type { JsonValue } from "@anvia/core/completion";
import type { Context, Next } from "hono";
import type { StudioCapability, StudioErrorCode, StudioErrorResponse } from "../types";
import { isObject } from "./type-guards";

/**
 * Hostnames accepted by the Studio HTTP API. Studio binds to a loopback
 * interface, so only loopback callers are trusted. Ports are ignored because
 * callers may reach Studio on any configured port.
 */
export const STUDIO_LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isStudioLocalHostname(hostname: string | undefined): boolean {
  return hostname !== undefined && STUDIO_LOCAL_HOSTNAMES.has(hostname.trim().toLowerCase());
}

/**
 * Reject requests that cannot come from the local Studio UI: a Host header
 * that does not target a loopback address (DNS rebinding), or an Origin
 * header from a non-loopback origin (cross-origin page).
 */
export async function studioHostGuard(c: Context, next: Next): Promise<Response | void> {
  // A missing Host header only happens for in-process fetch callers; servers
  // on the wire always provide one, so there is nothing to validate.
  const host = c.req.header("host");
  if (host !== undefined && !isStudioLocalHostname(studioRequestHostname(host))) {
    return errorResponse(c, 403, "forbidden", "Host not allowed");
  }
  const origin = c.req.header("origin");
  if (origin !== undefined && !isStudioLocalOrigin(origin)) {
    return errorResponse(c, 403, "forbidden", "Origin not allowed");
  }
  return next();
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

function isStudioLocalOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return isStudioLocalHostname(url.hostname);
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
