import { isJsonValue, type JsonValue } from "../../completion/index";
import { isPlainObject } from "./values";

export function isDecisionDataObject(value: unknown): value is Record<string, JsonValue> {
  return isPlainObject(value) && isJsonValue(value);
}

export function isDecisionProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isDecisionTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function probabilitiesSumToOne(values: readonly number[]): boolean {
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-5;
}
