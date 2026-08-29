import { type AnyTool, createTool, ToolOutput } from "@anvia/core/tool";
import { z } from "zod";
import type {
  AutomationScreenshotResult,
  AutomationSnapshotResult,
  AutomationTabResult,
} from "./automation-protocol";
import { asConnection } from "./connection";
import { BrowserError } from "./errors";
import type { BrowserNavigationPolicy, BrowserToolName, CreateBrowserToolsOptions } from "./types";

const targetSchema = z.discriminatedUnion("by", [
  z.object({
    by: z.literal("role"),
    role: z.string().min(1),
    name: z.string().optional(),
    exact: z.boolean().optional(),
  }),
  z.object({ by: z.literal("text"), text: z.string().min(1), exact: z.boolean().optional() }),
  z.object({ by: z.literal("label"), label: z.string().min(1), exact: z.boolean().optional() }),
  z.object({
    by: z.literal("placeholder"),
    placeholder: z.string().min(1),
    exact: z.boolean().optional(),
  }),
  z.object({ by: z.literal("test-id"), testId: z.string().min(1) }),
  z.object({ by: z.literal("css"), selector: z.string().min(1) }),
]);

const noInput = z.object({});
const tabInput = z.object({ tabId: z.string().uuid() });
const explicitTab = { tabId: z.string().uuid().optional() };
const navigateInput = z.object({
  ...explicitTab,
  url: z.url(),
  waitUntil: z.enum(["commit", "domcontentloaded", "load", "networkidle"]).optional(),
});
const clickInput = z.object({ ...explicitTab, target: targetSchema });
const typeInput = z.object({ ...explicitTab, target: targetSchema, text: z.string() });
const pressKeyInput = z.object({ ...explicitTab, key: z.string().min(1).max(100) });
const screenshotInput = z.object(explicitTab);
const snapshotInput = z.object(explicitTab);

const defaultActionTimeoutMs = 10_000;
const defaultNavigationTimeoutMs = 30_000;
const defaultSnapshotMaxChars = 50_000;
const maxTimeoutMs = 300_000;
const maxSnapshotChars = 200_000;

export function createBrowserTools(options: CreateBrowserToolsOptions): readonly AnyTool[] {
  validateFactoryOptions(options);
  const connection = asConnection(options.connection);
  const policy = snapshotNavigationPolicy(options.navigation);
  connection.setNavigationPolicy(policy);
  const limits = {
    actionTimeoutMs: options.limits?.actionTimeoutMs ?? defaultActionTimeoutMs,
    navigationTimeoutMs: options.limits?.navigationTimeoutMs ?? defaultNavigationTimeoutMs,
    snapshotMaxChars: options.limits?.snapshotMaxChars ?? defaultSnapshotMaxChars,
  };
  const tools = options.tools.map((name) => {
    switch (name) {
      case "browser_list_tabs":
        return createListTabsTool(connection, limits.actionTimeoutMs);
      case "browser_open_tab":
        return createOpenTabTool(connection, limits.actionTimeoutMs);
      case "browser_select_tab":
        return createSelectTabTool(connection, limits.actionTimeoutMs);
      case "browser_close_tab":
        return createCloseTabTool(connection, limits.actionTimeoutMs);
      case "browser_navigate":
        return createNavigateTool(connection, policy, limits.navigationTimeoutMs);
      case "browser_snapshot":
        return createSnapshotTool(connection, limits.actionTimeoutMs, limits.snapshotMaxChars);
      case "browser_click":
        return createClickTool(connection, limits.actionTimeoutMs);
      case "browser_type":
        return createTypeTool(connection, limits.actionTimeoutMs);
      case "browser_press_key":
        return createPressKeyTool(connection, limits.actionTimeoutMs);
      case "browser_screenshot":
        return createScreenshotTool(connection, limits.actionTimeoutMs);
      default:
        return assertNever(name);
    }
  });
  return Object.freeze(tools);
}

type Connection = ReturnType<typeof asConnection>;

function createListTabsTool(connection: Connection, timeoutMs: number): AnyTool {
  return createTool({
    name: "browser_list_tabs",
    description: "List Chromium tabs and identify the tab selected for subsequent browser tools.",
    inputSchema: noInput,
    execute: async (_args, context) => ({
      tabs: await connection.listTabs({ abortSignal: context.abortSignal, timeoutMs }),
    }),
  });
}

function createOpenTabTool(connection: Connection, timeoutMs: number): AnyTool {
  return createTool({
    name: "browser_open_tab",
    description: "Open and select a new blank Chromium tab.",
    inputSchema: noInput,
    execute: async (_args, context) => connection.openTab(context.abortSignal, timeoutMs),
  });
}

function createSelectTabTool(connection: Connection, timeoutMs: number): AnyTool {
  return createTool({
    name: "browser_select_tab",
    description: "Select an existing Chromium tab by its browser tab ID.",
    inputSchema: tabInput,
    execute: async ({ tabId }, context) =>
      connection.selectTab(tabId, context.abortSignal, timeoutMs),
  });
}

function createCloseTabTool(connection: Connection, timeoutMs: number): AnyTool {
  return createTool({
    name: "browser_close_tab",
    description: "Close an existing Chromium tab by its browser tab ID.",
    inputSchema: tabInput,
    execute: async ({ tabId }, context) =>
      connection.closeTab(tabId, context.abortSignal, timeoutMs),
  });
}

function createNavigateTool(
  connection: Connection,
  policy: BrowserNavigationPolicy,
  timeoutMs: number,
): AnyTool {
  return createTool({
    name: "browser_navigate",
    description:
      "Navigate an explicit tab, or the selected tab in serial compatibility mode, to an allowed HTTP or HTTPS URL.",
    inputSchema: navigateInput,
    execute: async ({ tabId, url, waitUntil }, context) => {
      assertNavigationAllowed(url, policy);
      const result = await connection.runTabCommand<AutomationTabResult>({
        tabId,
        abortSignal: context.abortSignal,
        timeoutMs,
        phase: "navigate",
        command: (targetTabId) => ({
          method: "navigate",
          params: {
            tabId: targetTabId,
            url,
            waitUntil: waitUntil ?? "load",
            timeoutMs,
          },
        }),
      });
      assertNavigationAllowed(result.url, policy);
      return result;
    },
  });
}

function createSnapshotTool(connection: Connection, timeoutMs: number, maxChars: number): AnyTool {
  return createTool({
    name: "browser_snapshot",
    description:
      "Inspect an explicit tab, or the selected tab in serial compatibility mode, using a bounded ARIA accessibility snapshot.",
    inputSchema: snapshotInput,
    execute: async ({ tabId }, context) =>
      connection.runTabCommand<AutomationSnapshotResult>({
        tabId,
        abortSignal: context.abortSignal,
        timeoutMs,
        phase: "snapshot",
        command: (targetTabId) => ({
          method: "snapshot",
          params: { tabId: targetTabId, timeoutMs, maxChars },
        }),
      }),
  });
}

function createClickTool(connection: Connection, timeoutMs: number): AnyTool {
  return createTool({
    name: "browser_click",
    description: "Click one strictly matched element in an explicit tab or the selected tab.",
    inputSchema: clickInput,
    execute: async ({ tabId, target }, context) =>
      connection.runTabCommand<AutomationTabResult>({
        tabId,
        abortSignal: context.abortSignal,
        timeoutMs,
        phase: "click",
        command: (targetTabId) => ({
          method: "click",
          params: { tabId: targetTabId, target, timeoutMs },
        }),
      }),
  });
}

function createTypeTool(connection: Connection, timeoutMs: number): AnyTool {
  return createTool({
    name: "browser_type",
    description:
      "Replace the value of one strictly matched editable element in an explicit or selected tab.",
    inputSchema: typeInput,
    execute: async ({ tabId, target, text }, context) =>
      connection.runTabCommand<AutomationTabResult>({
        tabId,
        abortSignal: context.abortSignal,
        timeoutMs,
        phase: "type",
        command: (targetTabId) => ({
          method: "type",
          params: { tabId: targetTabId, target, text, timeoutMs },
        }),
      }),
  });
}

function createPressKeyTool(connection: Connection, timeoutMs: number): AnyTool {
  return createTool({
    name: "browser_press_key",
    description:
      "Press an explicit keyboard key or key combination in an explicit or selected tab.",
    inputSchema: pressKeyInput,
    execute: async ({ tabId, key }, context) =>
      connection.runTabCommand<AutomationTabResult>({
        tabId,
        abortSignal: context.abortSignal,
        timeoutMs,
        phase: "press-key",
        command: (targetTabId) => ({
          method: "pressKey",
          params: { tabId: targetTabId, key },
        }),
      }),
  });
}

function createScreenshotTool(connection: Connection, timeoutMs: number): AnyTool {
  return createTool({
    name: "browser_screenshot",
    description: "Capture the visible viewport of an explicit or selected Chromium tab as PNG.",
    inputSchema: screenshotInput,
    execute: async ({ tabId }, context) => {
      const result = await connection.runTabCommand<AutomationScreenshotResult>({
        tabId,
        abortSignal: context.abortSignal,
        timeoutMs,
        phase: "screenshot",
        command: (targetTabId) => ({
          method: "screenshot",
          params: { tabId: targetTabId, timeoutMs },
        }),
      });
      return ToolOutput.content([
        { type: "text", text: JSON.stringify(result.metadata) },
        {
          type: "file",
          data: { type: "data", data: result.pngBase64 },
          mediaType: "image/png",
          filename: "browser-screenshot.png",
        },
      ]);
    },
  });
}

function snapshotNavigationPolicy(policy: BrowserNavigationPolicy): BrowserNavigationPolicy {
  if (!isRecord(policy)) throw new TypeError("navigation must be an object.");
  if (policy.mode === "allow-all-http") return Object.freeze({ mode: "allow-all-http" });
  if (policy.mode !== "origins" || !Array.isArray(policy.origins) || policy.origins.length === 0) {
    throw new TypeError(
      "navigation must explicitly allow all HTTP URLs or a non-empty origin list.",
    );
  }
  const origins = policy.origins.map((origin) => normalizeOrigin(origin));
  if (new Set(origins).size !== origins.length) {
    throw new TypeError("navigation.origins contains a duplicate origin.");
  }
  return Object.freeze({ mode: "origins", origins: Object.freeze(origins) });
}

function normalizeOrigin(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("navigation origin must be a string.");
  const url = parseHttpUrl(value);
  if (value !== url.origin) {
    throw new TypeError(`navigation origin must not contain a path, query, or fragment: ${value}`);
  }
  return url.origin;
}

function assertNavigationAllowed(value: string, policy: BrowserNavigationPolicy): void {
  if (!isNavigationAllowed(value, policy)) {
    throw new BrowserError(`Browser navigation is blocked: ${value}`, "navigation_blocked");
  }
}

function isNavigationAllowed(value: string, policy: BrowserNavigationPolicy): boolean {
  let url: URL;
  try {
    url = parseHttpUrl(value);
  } catch {
    return false;
  }
  return policy.mode === "allow-all-http" || policy.origins.includes(url.origin);
}

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Browser navigation only supports HTTP and HTTPS URLs.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new TypeError("Browser navigation URLs must not include credentials.");
  }
  return url;
}

function validateFactoryOptions(options: CreateBrowserToolsOptions): void {
  if (!isRecord(options)) throw new TypeError("options must be an object.");
  if (!Array.isArray(options.tools) || options.tools.length === 0) {
    throw new TypeError("tools must be a non-empty array.");
  }
  const seen = new Set<BrowserToolName>();
  for (const name of options.tools) {
    if (!isToolName(name)) throw new TypeError(`Unsupported browser tool name: ${name}`);
    if (seen.has(name)) throw new TypeError(`tools contains a duplicate: ${name}`);
    seen.add(name);
  }
  snapshotNavigationPolicy(options.navigation);
  if (options.limits !== undefined && !isRecord(options.limits)) {
    throw new TypeError("limits must be an object.");
  }
  assertOptionalBoundedInteger(options.limits?.actionTimeoutMs, "actionTimeoutMs", 1, maxTimeoutMs);
  assertOptionalBoundedInteger(
    options.limits?.navigationTimeoutMs,
    "navigationTimeoutMs",
    1,
    maxTimeoutMs,
  );
  assertOptionalBoundedInteger(
    options.limits?.snapshotMaxChars,
    "snapshotMaxChars",
    1,
    maxSnapshotChars,
  );
}

function assertOptionalBoundedInteger(
  value: number | undefined,
  name: string,
  min: number,
  max: number,
): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < min || value > max)) {
    throw new RangeError(`${name} must be a safe integer between ${min} and ${max}.`);
  }
}

function isToolName(value: unknown): value is BrowserToolName {
  return (
    typeof value === "string" &&
    [
      "browser_list_tabs",
      "browser_open_tab",
      "browser_select_tab",
      "browser_close_tab",
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_press_key",
      "browser_screenshot",
    ].includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported browser tool: ${value}`);
}
