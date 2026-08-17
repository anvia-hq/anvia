import { randomUUID } from "node:crypto";
import type { Browser, Page, Route } from "playwright-core";
import { chromium } from "playwright-core";
import type { BrowserControlState } from "./control";
import { BrowserError } from "./errors";
import type { BrowserNavigationPolicy, BrowserTab, PlaywrightBrowserConnection } from "./types";

export async function connectPlaywrightBrowser(options: {
  endpointUrl: string;
  control: BrowserControlState;
  abortSignal?: AbortSignal;
}): Promise<PlaywrightBrowserConnectionImpl> {
  options.abortSignal?.throwIfAborted();
  const browser = await chromium.connectOverCDP(options.endpointUrl);
  if (options.abortSignal?.aborted) {
    await browser.close().catch(() => undefined);
    options.abortSignal.throwIfAborted();
  }
  return new PlaywrightBrowserConnectionImpl(browser, options.control);
}

export class PlaywrightBrowserConnectionImpl implements PlaywrightBrowserConnection {
  private readonly browser: Browser;
  private readonly control: BrowserControlState;
  private readonly tabIds = new WeakMap<Page, string>();
  private selected: Page | undefined;
  private isClosed = false;
  private actionTail = Promise.resolve();
  private navigationPolicyKey: string | undefined;
  private navigationGuard = Promise.resolve();

  constructor(browser: Browser, control: BrowserControlState) {
    this.browser = browser;
    this.control = control;
    this.selected = this.pages()[0];
    this.browser.once("disconnected", () => {
      this.isClosed = true;
    });
  }

  get closed(): boolean {
    return this.isClosed || !this.browser.isConnected();
  }

  async listTabs(): Promise<readonly BrowserTab[]> {
    return this.runAction(undefined, () => this.tabSummaries());
  }

  async tabSummaries(): Promise<readonly BrowserTab[]> {
    return Object.freeze(
      await Promise.all(
        this.pages().map(async (page) =>
          Object.freeze({
            id: this.idFor(page),
            title: await page.title(),
            url: page.url(),
            selected: page === this.selected,
          }),
        ),
      ),
    );
  }

  async runAction<T>(
    abortSignal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.actionTail;
    let release: (() => void) | undefined;
    this.actionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      this.assertOpen();
      await this.navigationGuard;
      return await this.control.runAgentAction(() => this.withAbort(abortSignal, operation));
    } finally {
      release?.();
    }
  }

  setNavigationPolicy(policy: BrowserNavigationPolicy): void {
    this.assertOpen();
    const key = JSON.stringify(policy);
    if (this.navigationPolicyKey !== undefined) {
      if (this.navigationPolicyKey !== key) {
        throw new TypeError("Browser connection already has a different navigation policy.");
      }
      return;
    }
    this.navigationPolicyKey = key;
    const routeHandler = (route: Route) => enforceNavigationPolicy(route, policy);
    this.navigationGuard = Promise.all(
      this.browser.contexts().map((context) => context.route("**/*", routeHandler)),
    ).then(() => undefined);
    void this.navigationGuard.catch(() => undefined);
  }

  selectedPage(): Page {
    this.assertOpen();
    if (this.selected !== undefined && !this.selected.isClosed()) return this.selected;
    const page = this.pages()[0];
    if (page === undefined) {
      throw new BrowserError("Browser has no open tabs.", "invalid_state");
    }
    this.selected = page;
    return page;
  }

  async openTab(): Promise<Page> {
    const context = this.browser.contexts()[0];
    if (context === undefined) {
      throw new BrowserError("Browser has no CDP context.", "invalid_state");
    }
    const page = await context.newPage();
    this.selected = page;
    this.idFor(page);
    return page;
  }

  selectTab(id: string): Page {
    const page = this.pageFor(id);
    this.selected = page;
    return page;
  }

  async closeTab(id: string): Promise<void> {
    const page = this.pageFor(id);
    await page.close();
    if (page === this.selected) this.selected = this.pages()[0];
  }

  idFor(page: Page): string {
    const existing = this.tabIds.get(page);
    if (existing !== undefined) return existing;
    const id = randomUUID();
    this.tabIds.set(page, id);
    return id;
  }

  async disconnect(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    await this.browser.close().catch(() => undefined);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  private pages(): Page[] {
    return this.browser.contexts().flatMap((context) => context.pages());
  }

  private pageFor(id: string): Page {
    const page = this.pages().find((candidate) => this.idFor(candidate) === id);
    if (page === undefined) {
      throw new BrowserError(`Browser tab does not exist: ${id}`, "invalid_state");
    }
    return page;
  }

  private assertOpen(): void {
    if (this.closed) throw new BrowserError("Browser connection is closed.", "connection_closed");
  }

  private async withAbort<T>(
    abortSignal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    abortSignal?.throwIfAborted();
    if (abortSignal === undefined) return operation();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        abortSignal.removeEventListener("abort", onAbort);
        callback();
      };
      const onAbort = () => {
        void this.disconnect().finally(() => finish(() => reject(abortSignal.reason)));
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
      void operation().then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }
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

export function asConnection(
  connection: PlaywrightBrowserConnection,
): PlaywrightBrowserConnectionImpl {
  if (!(connection instanceof PlaywrightBrowserConnectionImpl)) {
    throw new TypeError("connection must be created by DockerBrowser.connect().");
  }
  return connection;
}
