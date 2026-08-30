import type { BrowserNavigationPolicy } from "./types";

export type BrowserTarget =
  | Readonly<{
      by: "role";
      role: string;
      name?: string | undefined;
      exact?: boolean | undefined;
    }>
  | Readonly<{ by: "text"; text: string; exact?: boolean | undefined }>
  | Readonly<{ by: "label"; label: string; exact?: boolean | undefined }>
  | Readonly<{ by: "placeholder"; placeholder: string; exact?: boolean | undefined }>
  | Readonly<{ by: "test-id"; testId: string }>
  | Readonly<{ by: "css"; selector: string }>;

export type AutomationCommand =
  | Readonly<{ method: "connect"; params: { endpointUrl: string; timeoutMs: number } }>
  | Readonly<{ method: "disconnect"; params: Record<string, never> }>
  | Readonly<{ method: "listTabs"; params: Record<string, never> }>
  | Readonly<{ method: "setNavigationPolicy"; params: { policy: BrowserNavigationPolicy } }>
  | Readonly<{ method: "openTab"; params: Record<string, never> }>
  | Readonly<{ method: "selectTab"; params: { tabId: string } }>
  | Readonly<{ method: "closeTab"; params: { tabId: string } }>
  | Readonly<{
      method: "navigate";
      params: {
        tabId: string;
        url: string;
        waitUntil: "commit" | "domcontentloaded" | "load" | "networkidle";
        timeoutMs: number;
      };
    }>
  | Readonly<{
      method: "snapshot";
      params: { tabId: string; timeoutMs: number; maxChars: number };
    }>
  | Readonly<{
      method: "click";
      params: { tabId: string; target: BrowserTarget; timeoutMs: number };
    }>
  | Readonly<{
      method: "type";
      params: { tabId: string; target: BrowserTarget; text: string; timeoutMs: number };
    }>
  | Readonly<{ method: "pressKey"; params: { tabId: string; key: string } }>
  | Readonly<{ method: "screenshot"; params: { tabId: string; timeoutMs: number } }>;

export type AutomationRequest = AutomationCommand & Readonly<{ kind: "request"; id: number }>;

export type AutomationCancel = Readonly<{ kind: "cancel"; id: number }>;

export type SerializedError = Readonly<{
  name: string;
  message: string;
  stack?: string;
  code?: string;
}>;

export type AutomationResponse =
  | Readonly<{ kind: "response"; id: number; ok: true; value: unknown }>
  | Readonly<{ kind: "response"; id: number; ok: false; error: SerializedError }>
  | Readonly<{ kind: "cancelled"; id: number }>
  | Readonly<{ kind: "event"; event: "disconnected" }>;

export type AutomationTabResult = Readonly<{
  tabId: string;
  title: string;
  url: string;
}>;

export type AutomationSnapshotResult = AutomationTabResult &
  Readonly<{ snapshot: string; truncated: boolean }>;

export type AutomationScreenshotResult = Readonly<{
  metadata: AutomationTabResult;
  pngBase64: string;
}>;

export type AutomationMessageSummary = Readonly<{
  type: string;
  ownPropertyNames: readonly string[];
  ownPropertyCount: number;
  kind: "response" | "cancelled" | "event" | "other" | undefined;
  id: number | "non-number" | undefined;
  ok: boolean | "non-boolean" | undefined;
  constructorName: "Object" | "null-prototype" | "other" | undefined;
  hasExpectedPrototype: boolean;
  hasRequiredFields: boolean;
}>;

const safeSummaryPropertyNames = new Set([
  "cmd",
  "error",
  "event",
  "id",
  "kind",
  "ok",
  "value",
  "watch:import",
  "watch:require",
]);
const maxSummaryPropertyNames = 12;

export function isAutomationResponse(value: unknown): value is AutomationResponse {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "event":
      return value.event === "disconnected";
    case "cancelled":
      return isRequestId(value.id);
    case "response":
      if (!isRequestId(value.id) || typeof value.ok !== "boolean") return false;
      return value.ok ? Object.hasOwn(value, "value") : isSerializedError(value.error);
    default:
      return false;
  }
}

export function summarizeAutomationMessage(value: unknown): AutomationMessageSummary {
  const isObject = isRecord(value);
  const prototype = isObject ? Object.getPrototypeOf(value) : undefined;
  const propertyNames = isObject ? Object.getOwnPropertyNames(value) : [];
  return Object.freeze({
    type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    ownPropertyNames: Object.freeze(
      propertyNames
        .slice(0, maxSummaryPropertyNames)
        .map((name) => (safeSummaryPropertyNames.has(name) ? name : "<other>")),
    ),
    ownPropertyCount: propertyNames.length,
    kind:
      !isObject || value.kind === undefined
        ? undefined
        : value.kind === "response" || value.kind === "cancelled" || value.kind === "event"
          ? value.kind
          : "other",
    id:
      !isObject || value.id === undefined
        ? undefined
        : typeof value.id === "number"
          ? value.id
          : "non-number",
    ok:
      !isObject || value.ok === undefined
        ? undefined
        : typeof value.ok === "boolean"
          ? value.ok
          : "non-boolean",
    constructorName: !isObject
      ? undefined
      : prototype === null
        ? "null-prototype"
        : prototype === Object.prototype
          ? "Object"
          : "other",
    hasExpectedPrototype: isObject && prototype === Object.prototype,
    hasRequiredFields: isAutomationResponse(value),
  });
}

function isSerializedError(value: unknown): value is SerializedError {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.message === "string" &&
    (value.stack === undefined || typeof value.stack === "string") &&
    (value.code === undefined || typeof value.code === "string")
  );
}

function isRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
