import type { JsonValue } from "@anvia/core/completion";
import type { Context } from "hono";
import type { StudioCapability, StudioErrorCode, StudioErrorResponse } from "../types";
import { serializeUnknown } from "./json";
import { isObject } from "./type-guards";

export function errorResponse(
  c: Context,
  status: 400 | 404 | 409 | 500 | 501,
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

export function serializeError(error: unknown): JsonValue {
  return serializeUnknown(error);
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
