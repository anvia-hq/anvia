import type {
  DockerSandbox,
  DockerSandboxClient,
  DockerSandboxInspectionOptions,
  DockerSandboxInspector,
  DockerSandboxResources,
  DockerSandboxRuntimeLimits,
  DockerSandboxState,
  DockerSandboxWorkspace,
} from "@anvia/sandbox";

export type DockerBrowserClientOptions = Readonly<{
  sandboxClient: DockerSandboxClient;
  image: string;
}>;

export type PullDockerBrowserImageOptions = Readonly<{
  abortSignal?: AbortSignal;
}>;

export type BrowserViewport = Readonly<{
  width: number;
  height: number;
}>;

export type BrowserDesktopOptions = Readonly<{
  protocol: "novnc";
  password: string;
  viewport: BrowserViewport;
}>;

export type CreateDockerBrowserOptions = Readonly<{
  id?: string;
  workspace: DockerSandboxWorkspace;
  network: Readonly<{ mode: "bridge" }>;
  desktop: BrowserDesktopOptions;
  resources?: DockerSandboxResources;
  runtime?: DockerSandboxRuntimeLimits;
  abortSignal?: AbortSignal;
}>;

export type ResumeDockerBrowserOptions = Readonly<{
  id: string;
  abortSignal?: AbortSignal;
}>;

export type BrowserWaitUntilReadyOptions = Readonly<{
  timeoutMs: number;
  abortSignal?: AbortSignal;
}>;

export type BrowserConnectOptions = Readonly<{
  abortSignal?: AbortSignal;
}>;

export type BrowserControlSnapshot = Readonly<{
  mode: "agent" | "human";
  ownerId?: string;
  expiresAt?: string;
}>;

export type AcquireBrowserHumanControlOptions = Readonly<{
  ownerId: string;
  leaseTimeoutMs: number;
  abortSignal?: AbortSignal;
}>;

export type RenewBrowserHumanControlOptions = Readonly<{
  leaseTimeoutMs: number;
}>;

export interface BrowserHumanControlLease extends AsyncDisposable {
  readonly id: string;
  readonly ownerId: string;
  readonly expiresAt: string;
  renew(options: RenewBrowserHumanControlOptions): BrowserControlSnapshot;
  release(): void;
}

export interface BrowserControl {
  snapshot(): BrowserControlSnapshot;
  acquireHumanControl(
    options: AcquireBrowserHumanControlOptions,
  ): Promise<BrowserHumanControlLease>;
}

export type BrowserDesktopEndpoint = Readonly<{
  protocol: "novnc";
  containerPort: 6080;
  control: BrowserControl;
}>;

export interface DockerBrowser extends AsyncDisposable {
  readonly id: string;
  readonly state: DockerSandboxState;
  readonly desktop: BrowserDesktopEndpoint;
  readonly sandbox: DockerSandbox;
  inspector(options: DockerSandboxInspectionOptions): DockerSandboxInspector;
  waitUntilReady(options: BrowserWaitUntilReadyOptions): Promise<void>;
  connect(options?: BrowserConnectOptions): Promise<PlaywrightBrowserConnection>;
  stop(options?: Readonly<{ abortSignal?: AbortSignal }>): Promise<void>;
  destroy(): Promise<void>;
}

export type BrowserTab = Readonly<{
  id: string;
  title: string;
  url: string;
  selected: boolean;
}>;

export interface PlaywrightBrowserConnection extends AsyncDisposable {
  readonly closed: boolean;
  listTabs(): Promise<readonly BrowserTab[]>;
  disconnect(): Promise<void>;
}

export type BrowserToolName =
  | "browser_list_tabs"
  | "browser_open_tab"
  | "browser_select_tab"
  | "browser_close_tab"
  | "browser_navigate"
  | "browser_snapshot"
  | "browser_click"
  | "browser_type"
  | "browser_press_key"
  | "browser_screenshot";

export type BrowserNavigationPolicy =
  | Readonly<{ mode: "allow-all-http" }>
  | Readonly<{ mode: "origins"; origins: readonly string[] }>;

export type BrowserToolLimits = Readonly<{
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
  snapshotMaxChars?: number;
}>;

export type CreateBrowserToolsOptions = Readonly<{
  connection: PlaywrightBrowserConnection;
  tools: readonly [BrowserToolName, ...BrowserToolName[]];
  navigation: BrowserNavigationPolicy;
  limits?: BrowserToolLimits;
}>;
