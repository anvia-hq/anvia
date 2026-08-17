import { type AnyTool, createTool, ToolOutput } from "@anvia/core/tool";
import type { Locator, Page } from "playwright-core";
import { z } from "zod";
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
const navigateInput = z.object({
  url: z.url(),
  waitUntil: z.enum(["commit", "domcontentloaded", "load", "networkidle"]).optional(),
});
const clickInput = z.object({ target: targetSchema });
const typeInput = z.object({ target: targetSchema, text: z.string() });
const pressKeyInput = z.object({ key: z.string().min(1).max(100) });
const screenshotInput = z.object({});

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
        return createListTabsTool(connection);
      case "browser_open_tab":
        return createOpenTabTool(connection);
      case "browser_select_tab":
        return createSelectTabTool(connection);
      case "browser_close_tab":
        return createCloseTabTool(connection);
      case "browser_navigate":
        return createNavigateTool(connection, policy, limits.navigationTimeoutMs);
      case "browser_snapshot":
        return createSnapshotTool(connection, limits.actionTimeoutMs, limits.snapshotMaxChars);
      case "browser_click":
        return createClickTool(connection, limits.actionTimeoutMs);
      case "browser_type":
        return createTypeTool(connection, limits.actionTimeoutMs);
      case "browser_press_key":
        return createPressKeyTool(connection);
      case "browser_screenshot":
        return createScreenshotTool(connection);
      default:
        return assertNever(name);
    }
  });
  return Object.freeze(tools);
}

type Connection = ReturnType<typeof asConnection>;

function createListTabsTool(connection: Connection): AnyTool {
  return createTool({
    name: "browser_list_tabs",
    description: "List Chromium tabs and identify the tab selected for subsequent browser tools.",
    inputSchema: noInput,
    execute: async () => ({ tabs: await connection.listTabs() }),
  });
}

function createOpenTabTool(connection: Connection): AnyTool {
  return createTool({
    name: "browser_open_tab",
    description: "Open and select a new blank Chromium tab.",
    inputSchema: noInput,
    execute: async (_args, context) =>
      connection.runAction(context.abortSignal, async () => {
        const page = await connection.openTab();
        return tabResult(connection, page);
      }),
  });
}

function createSelectTabTool(connection: Connection): AnyTool {
  return createTool({
    name: "browser_select_tab",
    description: "Select an existing Chromium tab by its browser tab ID.",
    inputSchema: tabInput,
    execute: async ({ tabId }, context) =>
      connection.runAction(context.abortSignal, async () =>
        tabResult(connection, connection.selectTab(tabId)),
      ),
  });
}

function createCloseTabTool(connection: Connection): AnyTool {
  return createTool({
    name: "browser_close_tab",
    description: "Close an existing Chromium tab by its browser tab ID.",
    inputSchema: tabInput,
    execute: async ({ tabId }, context) =>
      connection.runAction(context.abortSignal, async () => {
        await connection.closeTab(tabId);
        return { closedTabId: tabId, tabs: await connection.tabSummaries() };
      }),
  });
}

function createNavigateTool(
  connection: Connection,
  policy: BrowserNavigationPolicy,
  timeoutMs: number,
): AnyTool {
  return createTool({
    name: "browser_navigate",
    description: "Navigate the selected Chromium tab to an allowed HTTP or HTTPS URL.",
    inputSchema: navigateInput,
    execute: async ({ url, waitUntil }, context) =>
      connection.runAction(context.abortSignal, async () => {
        assertNavigationAllowed(url, policy);
        const page = connection.selectedPage();
        await page.goto(url, {
          timeout: timeoutMs,
          waitUntil: waitUntil ?? "load",
        });
        assertNavigationAllowed(page.url(), policy);
        return tabResult(connection, page);
      }),
  });
}

function createSnapshotTool(connection: Connection, timeoutMs: number, maxChars: number): AnyTool {
  return createTool({
    name: "browser_snapshot",
    description: "Inspect the selected tab using a bounded ARIA accessibility snapshot.",
    inputSchema: noInput,
    execute: async (_args, context) =>
      connection.runAction(context.abortSignal, async () => {
        const page = connection.selectedPage();
        const snapshot = await page.locator("body").ariaSnapshot({ timeout: timeoutMs });
        const truncated = snapshot.length > maxChars;
        return {
          ...(await tabResult(connection, page)),
          snapshot: truncated ? snapshot.slice(0, maxChars) : snapshot,
          truncated,
        };
      }),
  });
}

function createClickTool(connection: Connection, timeoutMs: number): AnyTool {
  return createTool({
    name: "browser_click",
    description: "Click one strictly matched element in the selected tab.",
    inputSchema: clickInput,
    execute: async ({ target }, context) =>
      connection.runAction(context.abortSignal, async () => {
        const page = connection.selectedPage();
        await locatorFor(page, target).click({ timeout: timeoutMs });
        return tabResult(connection, page);
      }),
  });
}

function createTypeTool(connection: Connection, timeoutMs: number): AnyTool {
  return createTool({
    name: "browser_type",
    description: "Replace the value of one strictly matched editable element.",
    inputSchema: typeInput,
    execute: async ({ target, text }, context) =>
      connection.runAction(context.abortSignal, async () => {
        const page = connection.selectedPage();
        await locatorFor(page, target).fill(text, { timeout: timeoutMs });
        return tabResult(connection, page);
      }),
  });
}

function createPressKeyTool(connection: Connection): AnyTool {
  return createTool({
    name: "browser_press_key",
    description: "Press an explicit keyboard key or key combination in the selected tab.",
    inputSchema: pressKeyInput,
    execute: async ({ key }, context) =>
      connection.runAction(context.abortSignal, async () => {
        const page = connection.selectedPage();
        await page.keyboard.press(key);
        return tabResult(connection, page);
      }),
  });
}

function createScreenshotTool(connection: Connection): AnyTool {
  return createTool({
    name: "browser_screenshot",
    description: "Capture the visible viewport of the selected Chromium tab as PNG.",
    inputSchema: screenshotInput,
    execute: async (_args, context) =>
      connection.runAction(context.abortSignal, async () => {
        const page = connection.selectedPage();
        const png = await page.screenshot({ type: "png", fullPage: false });
        const metadata = await tabResult(connection, page);
        return ToolOutput.content([
          { type: "text", text: JSON.stringify(metadata) },
          {
            type: "file",
            data: { type: "data", data: png.toString("base64") },
            mediaType: "image/png",
            filename: "browser-screenshot.png",
          },
        ]);
      }),
  });
}

async function tabResult(connection: Connection, page: Page) {
  return {
    tabId: connection.idFor(page),
    title: await page.title(),
    url: page.url(),
  };
}

type BrowserTarget = z.infer<typeof targetSchema>;

function locatorFor(page: Page, target: BrowserTarget): Locator {
  switch (target.by) {
    case "role": {
      const options: { name?: string; exact?: boolean } = {};
      if (target.name !== undefined) options.name = target.name;
      if (target.exact !== undefined) options.exact = target.exact;
      return page.getByRole(target.role as never, options);
    }
    case "text": {
      const options: { exact?: boolean } = {};
      if (target.exact !== undefined) options.exact = target.exact;
      return page.getByText(target.text, options);
    }
    case "label": {
      const options: { exact?: boolean } = {};
      if (target.exact !== undefined) options.exact = target.exact;
      return page.getByLabel(target.label, options);
    }
    case "placeholder": {
      const options: { exact?: boolean } = {};
      if (target.exact !== undefined) options.exact = target.exact;
      return page.getByPlaceholder(target.placeholder, options);
    }
    case "test-id":
      return page.getByTestId(target.testId);
    case "css":
      return page.locator(target.selector);
  }
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
