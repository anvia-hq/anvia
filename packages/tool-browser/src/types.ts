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
import type { BrowserError } from "./errors";

export type BrowserLifecycleOptions = Readonly<{
  timeoutMs?: number | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type DockerBrowserClientOptions = Readonly<{
  sandboxClient: DockerSandboxClient;
  image: string;
}>;

export type PullDockerBrowserImageOptions = BrowserLifecycleOptions;

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
  timeoutMs?: number | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type ResumeDockerBrowserOptions = Readonly<{
  id: string;
  timeoutMs?: number | undefined;
  abortSignal?: AbortSignal | undefined;
}>;

export type BrowserCapability = "runtime" | "browser" | "automation" | "desktop";

export type BrowserCapabilityState =
  | "unknown"
  | "checking"
  | "ready"
  | "failed"
  | "stopped"
  | "destroyed";

export type BrowserCapabilitySnapshot = Readonly<{
  capability: BrowserCapability;
  state: BrowserCapabilityState;
  checkedAt?: string;
  error?: BrowserError;
}>;

export type BrowserReadinessSnapshot = Readonly<{
  state:
    | "unknown"
    | "checking"
    | "partial"
    | "ready"
    | "degraded"
    | "failed"
    | "stopped"
    | "destroyed";
  capabilities: Readonly<Record<BrowserCapability, BrowserCapabilitySnapshot>>;
}>;

export type BrowserWaitUntilReadyOptions = Readonly<{
  timeoutMs: number;
  abortSignal?: AbortSignal | undefined;
  capabilities?: readonly [BrowserCapability, ...BrowserCapability[]] | undefined;
}>;

export type BrowserSchedulingOptions =
  | Readonly<{
      mode: "serial";
      maxQueuedActions?: number;
    }>
  | Readonly<{
      mode: "per-tab";
      maxConcurrentTabs?: number;
      maxQueuedActions?: number;
    }>;

export type BrowserConnectOptions = Readonly<{
  timeoutMs?: number | undefined;
  abortSignal?: AbortSignal | undefined;
  scheduling?: BrowserSchedulingOptions | undefined;
}>;

export type BrowserControlAvailability = "available" | "degraded" | "disconnected" | "destroyed";

export type BrowserControlSnapshot = Readonly<{
  mode: "agent" | "human";
  state: "agent" | "agent-active" | "human-pending" | "human";
  availability: BrowserControlAvailability;
  activeAgentActions: number;
  humanPending: boolean;
  ownerId?: string;
  expiresAt?: string;
}>;

export type AcquireBrowserHumanControlOptions = Readonly<{
  ownerId: string;
  leaseTimeoutMs: number;
  timeoutMs?: number | undefined;
  abortSignal?: AbortSignal | undefined;
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
  /** Includes browser-handle lifecycle transitions such as `stopping` and `destroying`. */
  readonly state: DockerSandboxState;
  readonly desktop: BrowserDesktopEndpoint;
  readonly sandbox: DockerSandbox;
  inspector(options: DockerSandboxInspectionOptions): DockerSandboxInspector;
  readiness(): BrowserReadinessSnapshot;
  waitForCapabilities(options: BrowserWaitUntilReadyOptions): Promise<BrowserReadinessSnapshot>;
  waitUntilReady(options: BrowserWaitUntilReadyOptions): Promise<void>;
  connect(options?: BrowserConnectOptions): Promise<PlaywrightBrowserConnection>;
  stop(options?: BrowserLifecycleOptions): Promise<void>;
  /**
   * Starts an irreversible terminal transition. A timeout or cancellation bounds this caller's
   * wait; uncancellable sandbox cleanup remains owned and visible as `destroying` to later callers.
   */
  destroy(options?: BrowserLifecycleOptions): Promise<void>;
}

export type BrowserTab = Readonly<{
  id: string;
  title: string;
  url: string;
  selected: boolean;
}>;

export type BrowserActionOptions = BrowserLifecycleOptions;

export interface PlaywrightBrowserConnection extends AsyncDisposable {
  readonly closed: boolean;
  listTabs(options?: BrowserActionOptions): Promise<readonly BrowserTab[]>;
  disconnect(options?: BrowserLifecycleOptions): Promise<void>;
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
