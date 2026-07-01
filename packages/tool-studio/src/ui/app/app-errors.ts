import { EventStreamHttpError } from "@anvia/react";
import { errorMessage } from "./modules/shared/format";

export async function responseErrorMessage(response: Response, label: string): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      detail = `: ${body.error.message}`;
    }
  } catch {
    // Ignore non-JSON error bodies.
  }
  return `${label} with HTTP ${response.status}${detail}`;
}

export function agentRunErrorMessage(error: unknown): string {
  if (error instanceof EventStreamHttpError) {
    return error.response.status === 401
      ? "Authentication required"
      : `Run failed with HTTP ${error.response.status}`;
  }
  return errorMessage(error);
}

export function eventStreamResponseErrorMessage(
  error: EventStreamHttpError,
  label: string,
): string {
  let detail = "";
  try {
    const body = JSON.parse(error.body) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      detail = `: ${body.error.message}`;
    }
  } catch {
    // Ignore non-JSON error bodies.
  }
  return `${label} with HTTP ${error.response.status}${detail}`;
}

export function serializedStreamErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}
