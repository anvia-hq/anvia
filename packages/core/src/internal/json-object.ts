import { isJsonValue } from "../completion/json";
import type { JsonObject } from "../completion/types";

export function assertJsonObject(value: unknown, name: string): asserts value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    throw new TypeError(`${name} must be a JSON object.`);
  }
}
