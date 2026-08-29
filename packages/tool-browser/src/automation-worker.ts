import { randomUUID } from "node:crypto";
import type { Browser, Locator, Page, Route } from "playwright-core";
import { chromium } from "playwright-core";
import type {
  AutomationCancel,
  AutomationCommand,
  AutomationRequest,
  AutomationResponse,
  BrowserTarget,
  SerializedError,
} from "./automation-protocol";
import type { BrowserNavigationPolicy, BrowserTab } from "./types";

type ActiveOperation = {
  cancelled: boolean;
  page?: Page;
  completed: Promise<void>;
  complete: () => void;
};

let browser: Browser | undefined;
let selected: Page | undefined;
const tabIds = new WeakMap<Page, string>();
const pagesById = new Map<string, Page>();
const operations = new Map<number, ActiveOperation>();
let navigationPolicyKey: string | undefined;

process.once("disconnect", () => {
  void closeAfterParentExit();
});

process.on("message", (message: AutomationRequest | AutomationCancel) => {
  if (message.kind === "cancel") {
    void cancelOperation(message);
    return;
  }
  void runRequest(message);
});

async function runRequest(request: AutomationRequest): Promise<void> {
  let complete: (() => void) | undefined;
  const operation: ActiveOperation = {
    cancelled: false,
    completed: new Promise<void>((resolve) => {
      complete = resolve;
    }),
    complete: () => complete?.(),
  };
  operations.set(request.id, operation);
  try {
    const value = await execute(request, operation);
    send({ kind: "response", id: request.id, ok: true, value });
  } catch (error) {
    send({ kind: "response", id: request.id, ok: false, error: serializeError(error) });
  } finally {
    operation.complete();
    operations.delete(request.id);
  }
}

async function cancelOperation(request: AutomationCancel): Promise<void> {
  const operation = operations.get(request.id);
  if (operation !== undefined) {
    operation.cancelled = true;
    await operation.page?.close().catch(() => undefined);
    await operation.completed;
  }
  send({ kind: "cancelled", id: request.id });
}

async function execute(request: AutomationRequest, operation: ActiveOperation): Promise<unknown> {
  const command: AutomationCommand = request;
  switch (command.method) {
    case "connect": {
      if (browser !== undefined) throw new Error("Automation worker is already connected.");
      const connected = await chromium.connectOverCDP(command.params.endpointUrl, {
        timeout: command.params.timeoutMs,
      });
      try {
        if (operation.cancelled) throw new Error("Connection attempt was cancelled.");
        const context = connected.contexts()[0];
        if (context === undefined) {
          throw new Error("CDP connection did not expose a browser context.");
        }
        const session = await connected.newBrowserCDPSession();
        try {
          await session.send("Browser.getVersion");
        } finally {
          await session.detach().catch(() => undefined);
        }
        if (operation.cancelled) throw new Error("Connection attempt was cancelled.");
      } catch (error) {
        await connected.close().catch(() => undefined);
        throw error;
      }
      browser = connected;
      selected = pages()[0];
      for (const page of pages()) idFor(page);
      connected.once("disconnected", () => {
        browser = undefined;
        send({ kind: "event", event: "disconnected" });
      });
      return undefined;
    }
    case "disconnect": {
      const connected = browser;
      browser = undefined;
      selected = undefined;
      if (connected !== undefined) await connected.close();
      return undefined;
    }
    case "listTabs":
      return tabSummaries();
    case "setNavigationPolicy":
      await setNavigationPolicy(command.params.policy);
      return undefined;
    case "openTab": {
      const context = assertBrowser().contexts()[0];
      if (context === undefined) throw new Error("Browser has no CDP context.");
      const page = await context.newPage();
      operation.page = page;
      if (operation.cancelled) {
        await page.close().catch(() => undefined);
        throw new Error("Open-tab operation was cancelled.");
      }
      selected = page;
      return tabResult(page);
    }
    case "selectTab": {
      const page = pageFor(command.params.tabId);
      selected = page;
      return tabResult(page);
    }
    case "closeTab": {
      const page = pageFor(command.params.tabId);
      operation.page = page;
      await page.close();
      if (page === selected) selected = pages()[0];
      return { closedTabId: command.params.tabId, tabs: await tabSummaries() };
    }
    case "navigate": {
      const page = targetPage(command.params.tabId, operation);
      await page.goto(command.params.url, {
        timeout: command.params.timeoutMs,
        waitUntil: command.params.waitUntil,
      });
      return tabResult(page);
    }
    case "snapshot": {
      const page = targetPage(command.params.tabId, operation);
      const snapshot = await page.locator("body").ariaSnapshot({
        timeout: command.params.timeoutMs,
      });
      const truncated = snapshot.length > command.params.maxChars;
      return {
        ...(await tabResult(page)),
        snapshot: truncated ? snapshot.slice(0, command.params.maxChars) : snapshot,
        truncated,
      };
    }
    case "click": {
      const page = targetPage(command.params.tabId, operation);
      await locatorFor(page, command.params.target).click({ timeout: command.params.timeoutMs });
      return tabResult(page);
    }
    case "type": {
      const page = targetPage(command.params.tabId, operation);
      await locatorFor(page, command.params.target).fill(command.params.text, {
        timeout: command.params.timeoutMs,
      });
      return tabResult(page);
    }
    case "pressKey": {
      const page = targetPage(command.params.tabId, operation);
      await page.keyboard.press(command.params.key);
      return tabResult(page);
    }
    case "screenshot": {
      const page = targetPage(command.params.tabId, operation);
      const png = await page.screenshot({
        type: "png",
        fullPage: false,
        timeout: command.params.timeoutMs,
      });
      return { metadata: await tabResult(page), pngBase64: png.toString("base64") };
    }
  }
}

function assertBrowser(): Browser {
  if (browser === undefined || !browser.isConnected())
    throw new Error("Browser connection is closed.");
  return browser;
}

function pages(): Page[] {
  return browser?.contexts().flatMap((context) => context.pages()) ?? [];
}

function idFor(page: Page): string {
  const existing = tabIds.get(page);
  if (existing !== undefined) return existing;
  const id = randomUUID();
  tabIds.set(page, id);
  pagesById.set(id, page);
  page.once("close", () => pagesById.delete(id));
  return id;
}

function pageFor(id: string): Page {
  assertBrowser();
  const page = pagesById.get(id);
  if (page === undefined || page.isClosed() || !pages().includes(page)) {
    throw new Error(`Browser tab does not exist: ${id}`);
  }
  return page;
}

function targetPage(id: string, operation: ActiveOperation): Page {
  const page = pageFor(id);
  operation.page = page;
  return page;
}

async function tabSummaries(): Promise<readonly BrowserTab[]> {
  assertBrowser();
  if (selected?.isClosed()) selected = pages()[0];
  return Promise.all(
    pages().map(async (page) => ({
      id: idFor(page),
      title: await page.title(),
      url: page.url(),
      selected: page === selected,
    })),
  );
}

async function tabResult(page: Page) {
  return { tabId: idFor(page), title: await page.title(), url: page.url() };
}

async function setNavigationPolicy(policy: BrowserNavigationPolicy): Promise<void> {
  const key = JSON.stringify(policy);
  if (navigationPolicyKey !== undefined) {
    if (navigationPolicyKey !== key) {
      throw new TypeError("Browser connection already has a different navigation policy.");
    }
    return;
  }
  navigationPolicyKey = key;
  await Promise.all(
    assertBrowser()
      .contexts()
      .map((context) => context.route("**/*", (route) => enforceNavigationPolicy(route, policy))),
  );
}

async function enforceNavigationPolicy(
  route: Route,
  policy: BrowserNavigationPolicy,
): Promise<void> {
  const request = route.request();
  const frame = request.frame();
  if (
    request.isNavigationRequest() &&
    frame === frame.page().mainFrame() &&
    !isNavigationAllowed(request.url(), policy)
  ) {
    await route.abort("blockedbyclient");
    return;
  }
  await route.continue();
}

function isNavigationAllowed(value: string, policy: BrowserNavigationPolicy): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username.length > 0 || url.password.length > 0) return false;
  return policy.mode === "allow-all-http" || policy.origins.includes(url.origin);
}

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

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const value: { name: string; message: string; stack?: string; code?: string } = {
      name: error.name,
      message: error.message,
    };
    if (error.stack !== undefined) value.stack = error.stack;
    if ("code" in error && typeof error.code === "string") value.code = error.code;
    return value;
  }
  return { name: "Error", message: String(error) };
}

function send(message: AutomationResponse): void {
  if (!process.connected || process.send === undefined) return;
  process.send(message, () => undefined);
}

async function closeAfterParentExit(): Promise<void> {
  const forceExit = setTimeout(() => process.exit(1), 2_000);
  const connected = browser;
  browser = undefined;
  await connected?.close().catch(() => undefined);
  clearTimeout(forceExit);
  process.exit(0);
}
