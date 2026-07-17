import {
  ComputerTerminal01Icon,
  Download01Icon,
  File01Icon,
  FolderOpenIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  StudioSandboxesSummary,
  StudioSandboxFileEntry,
  StudioSandboxFilesResponse,
  StudioSandboxPort,
  StudioSandboxPortsResponse,
  StudioSandboxProcess,
  StudioSandboxProcessesResponse,
  StudioSandboxProcessLogsResponse,
  StudioSandboxSummary,
} from "../../../../types";
import { responseErrorMessage } from "../../app-errors";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import {
  StudioEmptyState,
  StudioPageShell,
  StudioStatusBadge,
  StudioSurface,
} from "../../components/ui/studio";
import { cn } from "../../lib/utils";
import { errorMessage } from "../shared/format";

const maxInlinePreviewBytes = 1024 * 1024;
const textExtensions = new Set([
  "css",
  "csv",
  "env",
  "gitignore",
  "graphql",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mdx",
  "mjs",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);
const imageTypes = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

type LoadState = "idle" | "loading";
type FilePreview =
  | { kind: "binary" | "large"; file: StudioSandboxFileEntry }
  | { kind: "image"; file: StudioSandboxFileEntry; url: string }
  | { kind: "loading"; file: StudioSandboxFileEntry }
  | { kind: "text"; file: StudioSandboxFileEntry; text: string };

export function SandboxesPage(props: {
  enabled: boolean;
  initialSandboxRef?: string;
  onError: (message: string) => void;
  onSelectSandbox: (sandboxRef: string) => void;
}) {
  const [sandboxes, setSandboxes] = useState<StudioSandboxSummary[]>([]);
  const [summaryLoadState, setSummaryLoadState] = useState<LoadState>("idle");
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [currentPath, setCurrentPath] = useState(".");
  const [files, setFiles] = useState<StudioSandboxFileEntry[]>([]);
  const [fileLoadState, setFileLoadState] = useState<LoadState>("idle");
  const [preview, setPreview] = useState<FilePreview | undefined>();
  const [ports, setPorts] = useState<StudioSandboxPort[]>([]);
  const [processes, setProcesses] = useState<StudioSandboxProcess[]>([]);
  const [runtimeLoadState, setRuntimeLoadState] = useState<LoadState>("idle");
  const [selectedProcessId, setSelectedProcessId] = useState("");
  const [processLogs, setProcessLogs] = useState<StudioSandboxProcessLogsResponse | undefined>();
  const [localError, setLocalError] = useState("");
  const previewRequest = useRef<AbortController | undefined>(undefined);

  const selectedRef = props.initialSandboxRef ?? sandboxes[0]?.ref ?? "";
  const selectedSandbox = sandboxes.find((sandbox) => sandbox.ref === selectedRef);
  const selectedSandboxRef = selectedSandbox?.ref;
  const supportsPorts = selectedSandbox?.capabilities.ports ?? false;
  const supportsProcesses = selectedSandbox?.capabilities.processes ?? false;

  const reportError = useCallback(
    (error: unknown) => {
      const message = errorMessage(error);
      setLocalError(message);
      props.onError(message);
    },
    [props.onError],
  );

  useEffect(() => {
    if (!props.enabled) {
      setSandboxes([]);
      return;
    }
    const controller = new AbortController();
    setSummaryLoadState("loading");
    setLocalError("");
    void requestJson<StudioSandboxesSummary>(
      "/sandboxes",
      "Sandboxes",
      controller.signal,
      refreshSequence === 0 ? "default" : "reload",
    )
      .then((summary) => setSandboxes(summary.sandboxes))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) reportError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSummaryLoadState("idle");
      });
    return () => controller.abort();
  }, [props.enabled, refreshSequence, reportError]);

  useEffect(() => {
    if (props.initialSandboxRef === undefined && sandboxes[0] !== undefined) {
      props.onSelectSandbox(sandboxes[0].ref);
    }
  }, [props.initialSandboxRef, props.onSelectSandbox, sandboxes]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the route selection must reset sandbox-local view state.
  useEffect(() => {
    setCurrentPath(".");
    setFiles([]);
    setPreview(undefined);
    setPorts([]);
    setProcesses([]);
    setSelectedProcessId("");
    setProcessLogs(undefined);
    return () => previewRequest.current?.abort();
  }, [selectedRef]);

  useEffect(() => {
    if (selectedSandboxRef === undefined) {
      return;
    }
    const controller = new AbortController();
    setFileLoadState("loading");
    const params = new URLSearchParams({ path: currentPath });
    void requestJson<StudioSandboxFilesResponse>(
      `/sandboxes/${encodeURIComponent(selectedSandboxRef)}/files?${params}`,
      "Sandbox files",
      controller.signal,
      refreshSequence === 0 ? "default" : "reload",
    )
      .then((response) => setFiles(response.entries))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFiles([]);
          reportError(error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setFileLoadState("idle");
      });
    return () => controller.abort();
  }, [currentPath, refreshSequence, reportError, selectedSandboxRef]);

  useEffect(() => {
    if (selectedSandboxRef === undefined) {
      return;
    }
    const controller = new AbortController();
    setRuntimeLoadState("loading");
    const base = `/sandboxes/${encodeURIComponent(selectedSandboxRef)}`;
    const requests: Promise<void>[] = [];
    if (supportsPorts) {
      requests.push(
        requestJson<StudioSandboxPortsResponse>(
          `${base}/ports`,
          "Sandbox ports",
          controller.signal,
          refreshSequence === 0 ? "default" : "reload",
        ).then((response) => setPorts(response.ports)),
      );
    } else {
      setPorts([]);
    }
    if (supportsProcesses) {
      requests.push(
        requestJson<StudioSandboxProcessesResponse>(
          `${base}/processes`,
          "Sandbox processes",
          controller.signal,
          refreshSequence === 0 ? "default" : "reload",
        ).then((response) => {
          setProcesses(response.processes);
          setSelectedProcessId((current) =>
            response.processes.some((process) => process.id === current) ? current : "",
          );
        }),
      );
    } else {
      setProcesses([]);
      setSelectedProcessId("");
    }
    void Promise.all(requests)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) reportError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRuntimeLoadState("idle");
      });
    return () => controller.abort();
  }, [refreshSequence, reportError, selectedSandboxRef, supportsPorts, supportsProcesses]);

  useEffect(() => {
    if (selectedSandboxRef === undefined || selectedProcessId.length === 0) {
      setProcessLogs(undefined);
      return;
    }
    const controller = new AbortController();
    const base = `/sandboxes/${encodeURIComponent(selectedSandboxRef)}/processes`;
    void requestJson<StudioSandboxProcessLogsResponse>(
      `${base}/${encodeURIComponent(selectedProcessId)}/logs`,
      "Process logs",
      controller.signal,
      refreshSequence === 0 ? "default" : "reload",
    )
      .then(setProcessLogs)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) reportError(error);
      });
    return () => controller.abort();
  }, [refreshSequence, reportError, selectedProcessId, selectedSandboxRef]);

  useEffect(
    () => () => {
      if (preview?.kind === "image") URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const clearPreview = useCallback(() => {
    previewRequest.current?.abort();
    previewRequest.current = undefined;
    setPreview(undefined);
  }, []);

  const openFile = useCallback(
    async (file: StudioSandboxFileEntry) => {
      previewRequest.current?.abort();
      previewRequest.current = undefined;
      if (selectedSandboxRef === undefined) {
        return;
      }
      if ((file.size ?? 0) > maxInlinePreviewBytes) {
        setPreview({ kind: "large", file });
        return;
      }
      const extension = fileExtension(file.path);
      const imageType = imageTypes.get(extension);
      if (!textExtensions.has(extension) && imageType === undefined) {
        setPreview({ kind: "binary", file });
        return;
      }

      setPreview({ kind: "loading", file });
      setLocalError("");
      const controller = new AbortController();
      previewRequest.current = controller;
      try {
        const response = await fetch(fileContentUrl(selectedSandboxRef, file.path), {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await responseErrorMessage(response, "Sandbox file"));
        }
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > maxInlinePreviewBytes) {
          setPreview({ kind: "large", file });
          return;
        }
        if (imageType !== undefined) {
          const url = URL.createObjectURL(new Blob([bytes], { type: imageType }));
          setPreview({ kind: "image", file, url });
          return;
        }
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          setPreview({ kind: "text", file, text });
        } catch {
          setPreview({ kind: "binary", file });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        reportError(error);
        setPreview({ kind: "binary", file });
      } finally {
        if (previewRequest.current === controller) previewRequest.current = undefined;
      }
    },
    [reportError, selectedSandboxRef],
  );

  if (!props.enabled) {
    return (
      <StudioPageShell className="p-4" aria-label="Sandboxes">
        <StudioEmptyState
          title="No sandbox workspaces"
          text="Add tools created by createSandboxTools(session) to an agent to inspect its live workspace here."
        />
      </StudioPageShell>
    );
  }

  return (
    <StudioPageShell
      className="grid grid-rows-[auto_minmax(0,1fr)] gap-3 p-3"
      aria-label="Sandboxes"
    >
      <StudioSurface className="flex items-center justify-between gap-4 rounded-xl px-5 py-3.5">
        <div className="min-w-0">
          <h1 className="m-0 text-base font-semibold text-foreground">Live sandbox workspaces</h1>
          <p className="m-0 mt-0.5 text-xs leading-5 text-muted-foreground">
            Read-only files, published ports, and managed processes discovered from agent tools.
          </p>
        </div>
        <Button
          disabled={summaryLoadState === "loading"}
          size="sm"
          type="button"
          variant="secondary"
          onClick={() => setRefreshSequence((current) => current + 1)}
        >
          <StudioIcon icon={RefreshIcon} aria-hidden="true" />
          Refresh
        </Button>
      </StudioSurface>

      {sandboxes.length === 0 && summaryLoadState === "idle" ? (
        <StudioEmptyState
          className="h-full"
          title="No live sandboxes detected"
          text="Studio discovers sessions automatically from tools returned by createSandboxTools(session)."
        />
      ) : (
        <div className="grid min-h-0 min-w-0 grid-cols-[250px_minmax(300px,0.8fr)_minmax(400px,1.2fr)] gap-3 overflow-hidden">
          <SandboxRail
            sandboxes={sandboxes}
            selectedRef={selectedRef}
            onSelect={props.onSelectSandbox}
          />
          <FileBrowser
            currentPath={currentPath}
            files={files}
            loading={fileLoadState === "loading"}
            onOpenDirectory={(filePath) => {
              clearPreview();
              setCurrentPath(filePath);
            }}
            onOpenFile={(file) => void openFile(file)}
            onSelectPath={(filePath) => {
              clearPreview();
              setCurrentPath(filePath);
            }}
          />
          <div className="grid min-h-0 gap-3 overflow-y-auto pr-1">
            {selectedSandbox === undefined ? (
              <StudioEmptyState
                title="Sandbox unavailable"
                text="The requested live sandbox is not registered by this Studio runtime."
              />
            ) : (
              <>
                <SandboxOverview sandbox={selectedSandbox} error={localError} />
                <FilePreviewPanel preview={preview} sandboxRef={selectedSandbox.ref} />
                <RuntimePanel
                  loading={runtimeLoadState === "loading"}
                  logs={processLogs}
                  ports={ports}
                  processes={processes}
                  selectedProcessId={selectedProcessId}
                  supportsPorts={selectedSandbox.capabilities.ports}
                  supportsProcesses={selectedSandbox.capabilities.processes}
                  onSelectProcess={setSelectedProcessId}
                />
              </>
            )}
          </div>
        </div>
      )}
    </StudioPageShell>
  );
}

function SandboxRail(props: {
  sandboxes: StudioSandboxSummary[];
  selectedRef: string;
  onSelect: (sandboxRef: string) => void;
}) {
  return (
    <StudioSurface className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-xl">
      <div className="border-b border-border/70 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Workspaces
        </span>
        <p className="m-0 mt-1 text-xs text-muted-foreground">
          {props.sandboxes.length} live {props.sandboxes.length === 1 ? "session" : "sessions"}
        </p>
      </div>
      <div className="min-h-0 overflow-y-auto p-2">
        {props.sandboxes.map((sandbox) => (
          <Button
            className={cn(
              "mb-1 grid h-auto min-h-16 w-full justify-stretch gap-1 rounded-lg px-3 py-2.5 text-left",
              sandbox.ref === props.selectedRef && "border-border bg-accent text-foreground",
            )}
            key={sandbox.ref}
            type="button"
            variant="ghost"
            onClick={() => props.onSelect(sandbox.ref)}
          >
            <span className="flex min-w-0 items-center justify-between gap-2">
              <strong className="truncate text-sm font-semibold text-foreground">
                {sandbox.id}
              </strong>
              <StudioStatusBadge className="shrink-0 px-1.5 py-0.5 text-[10px]">
                {sandbox.provider}
              </StudioStatusBadge>
            </span>
            <span className="truncate font-mono text-[11px] font-normal text-muted-foreground">
              {sandbox.workdir}
            </span>
          </Button>
        ))}
      </div>
    </StudioSurface>
  );
}

function FileBrowser(props: {
  currentPath: string;
  files: StudioSandboxFileEntry[];
  loading: boolean;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (file: StudioSandboxFileEntry) => void;
  onSelectPath: (path: string) => void;
}) {
  const breadcrumbs = useMemo(() => sandboxBreadcrumbs(props.currentPath), [props.currentPath]);
  return (
    <StudioSurface className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] rounded-xl">
      <div className="border-b border-border/70 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Files
        </span>
        <p className="m-0 mt-1 text-xs text-muted-foreground">One level at a time</p>
      </div>
      <div className="flex min-h-10 items-center gap-1 overflow-x-auto border-b border-border/70 px-3 py-1.5">
        {breadcrumbs.map((breadcrumb, index) => (
          <span className="flex items-center gap-1" key={breadcrumb.path}>
            {index > 0 ? <span className="text-muted-foreground/60">/</span> : null}
            <Button
              className="h-7 min-h-7 px-2 font-mono text-xs"
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => props.onSelectPath(breadcrumb.path)}
            >
              {breadcrumb.label}
            </Button>
          </span>
        ))}
      </div>
      <div className="min-h-0 overflow-y-auto p-2">
        {props.loading ? (
          <p className="m-0 px-3 py-4 text-xs text-muted-foreground">Loading workspace</p>
        ) : null}
        {!props.loading && props.files.length === 0 ? (
          <p className="m-0 px-3 py-4 text-xs text-muted-foreground">This directory is empty.</p>
        ) : null}
        {props.files.map((file) => (
          <Button
            className="mb-0.5 grid h-10 min-h-10 w-full grid-cols-[18px_minmax(0,1fr)_auto] justify-stretch gap-2 rounded-md px-2.5 text-left text-xs font-medium"
            key={file.path}
            type="button"
            variant="ghost"
            onClick={() =>
              file.type === "directory" ? props.onOpenDirectory(file.path) : props.onOpenFile(file)
            }
          >
            <StudioIcon
              className="text-muted-foreground"
              icon={file.type === "directory" ? FolderOpenIcon : File01Icon}
              aria-hidden="true"
            />
            <span className="truncate text-foreground">{basename(file.path)}</span>
            <span className="font-mono text-[10px] font-normal text-muted-foreground">
              {file.type === "file" ? formatBytes(file.size) : file.type}
            </span>
          </Button>
        ))}
      </div>
    </StudioSurface>
  );
}

function SandboxOverview(props: { sandbox: StudioSandboxSummary; error: string }) {
  return (
    <StudioSurface className="rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Active sandbox
          </span>
          <h2 className="m-0 mt-1 truncate text-lg font-semibold text-foreground">
            {props.sandbox.id}
          </h2>
          <p className="m-0 mt-1 truncate font-mono text-xs text-muted-foreground">
            {props.sandbox.workdir}
          </p>
        </div>
        <StudioStatusBadge>{props.sandbox.provider}</StudioStatusBadge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <MetadataList label="Agents" values={props.sandbox.agentIds} />
        <MetadataList label="Sandbox tools" values={props.sandbox.toolNames} />
      </div>
      {props.error.length > 0 ? (
        <p className="m-0 mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
          {props.error}
        </p>
      ) : null}
    </StudioSurface>
  );
}

function MetadataList(props: { label: string; values: string[] }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/45 p-3">
      <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </span>
      <p className="m-0 mt-1 break-words font-mono leading-5 text-foreground">
        {props.values.join(", ") || "-"}
      </p>
    </div>
  );
}

function FilePreviewPanel(props: { preview: FilePreview | undefined; sandboxRef: string }) {
  const file = props.preview?.file;
  return (
    <StudioSurface className="grid min-h-64 grid-rows-[auto_minmax(0,1fr)] rounded-xl">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border/70 px-4 py-2">
        <div className="min-w-0">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Preview
          </span>
          <p className="m-0 mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {file?.path ?? "Select a file"}
          </p>
        </div>
        {file !== undefined ? (
          <Button asChild size="sm" variant="secondary">
            <a href={fileContentUrl(props.sandboxRef, file.path, true)}>
              <StudioIcon icon={Download01Icon} aria-hidden="true" />
              Download
            </a>
          </Button>
        ) : null}
      </div>
      <div className="grid min-h-0 place-items-center overflow-auto bg-background/35 p-4">
        {props.preview === undefined ? (
          <p className="m-0 text-center text-xs leading-5 text-muted-foreground">
            Choose a regular file to inspect its contents.
          </p>
        ) : null}
        {props.preview?.kind === "loading" ? (
          <p className="m-0 text-xs text-muted-foreground">Loading preview</p>
        ) : null}
        {props.preview?.kind === "text" ? (
          <pre className="m-0 h-full min-h-48 w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-card/60 p-4 font-mono text-xs leading-5 text-foreground">
            {props.preview.text}
          </pre>
        ) : null}
        {props.preview?.kind === "image" ? (
          <img
            className="max-h-96 max-w-full rounded-lg border border-border/70 object-contain"
            src={props.preview.url}
            alt={basename(props.preview.file.path)}
          />
        ) : null}
        {props.preview?.kind === "binary" ? (
          <PreviewNotice text="This file type is download-only and will not be rendered in Studio." />
        ) : null}
        {props.preview?.kind === "large" ? (
          <PreviewNotice text="This file is larger than the 1 MiB inline preview limit." />
        ) : null}
      </div>
    </StudioSurface>
  );
}

function PreviewNotice(props: { text: string }) {
  return (
    <div className="grid max-w-sm justify-items-center gap-2 text-center">
      <StudioIcon className="h-6 w-6 text-muted-foreground" icon={File01Icon} aria-hidden="true" />
      <p className="m-0 text-xs leading-5 text-muted-foreground">{props.text}</p>
    </div>
  );
}

function RuntimePanel(props: {
  loading: boolean;
  logs: StudioSandboxProcessLogsResponse | undefined;
  ports: StudioSandboxPort[];
  processes: StudioSandboxProcess[];
  selectedProcessId: string;
  supportsPorts: boolean;
  supportsProcesses: boolean;
  onSelectProcess: (processId: string) => void;
}) {
  return (
    <StudioSurface className="rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Runtime
          </span>
          <p className="m-0 mt-1 text-xs text-muted-foreground">
            Published ports and managed processes
          </p>
        </div>
        {props.loading ? <StudioStatusBadge>Refreshing</StudioStatusBadge> : null}
      </div>

      <div className="mt-4 grid gap-4">
        <RuntimeSection title="Ports">
          {!props.supportsPorts ? (
            <RuntimeEmpty text="Published ports are not supported by this sandbox." />
          ) : props.ports.length === 0 ? (
            <RuntimeEmpty text="No ports are published." />
          ) : (
            <div className="grid gap-1">
              {props.ports.map((port) => (
                <div
                  className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 rounded-md border border-border/60 px-3 py-2 font-mono text-xs"
                  key={`${port.containerPort}:${port.hostPort}`}
                >
                  <span className="text-foreground">
                    {port.containerPort}/{port.protocol}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {port.host}:{port.hostPort}
                  </span>
                </div>
              ))}
            </div>
          )}
        </RuntimeSection>

        <RuntimeSection title="Processes">
          {!props.supportsProcesses ? (
            <RuntimeEmpty text="Managed processes are not supported by this sandbox." />
          ) : props.processes.length === 0 ? (
            <RuntimeEmpty text="No managed processes are recorded." />
          ) : (
            <div className="grid gap-1">
              {props.processes.map((process) => (
                <Button
                  className={cn(
                    "grid h-auto min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] justify-stretch gap-3 rounded-md px-3 py-2 text-left",
                    process.id === props.selectedProcessId &&
                      "border-border bg-accent text-foreground",
                  )}
                  key={process.id}
                  type="button"
                  variant="ghost"
                  onClick={() => props.onSelectProcess(process.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <StudioIcon
                      className="text-muted-foreground"
                      icon={ComputerTerminal01Icon}
                      aria-hidden="true"
                    />
                    <span className="truncate font-mono text-xs text-foreground">
                      {[process.command, ...process.args].join(" ")}
                    </span>
                  </span>
                  <StudioStatusBadge className="px-1.5 py-0.5 text-[10px]">
                    {process.status}
                  </StudioStatusBadge>
                </Button>
              ))}
            </div>
          )}
        </RuntimeSection>

        {props.selectedProcessId.length > 0 ? (
          <RuntimeSection title="Process logs">
            {props.logs === undefined ? (
              <RuntimeEmpty text="Loading the latest bounded output." />
            ) : (
              <div className="grid gap-2">
                <LogBlock
                  label="stdout"
                  text={props.logs.stdout}
                  truncated={props.logs.stdoutTruncated}
                />
                <LogBlock
                  label="stderr"
                  text={props.logs.stderr}
                  truncated={props.logs.stderrTruncated}
                />
              </div>
            )}
          </RuntimeSection>
        ) : null}
      </div>
    </StudioSurface>
  );
}

function RuntimeSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function RuntimeEmpty(props: { text: string }) {
  return (
    <p className="m-0 rounded-md border border-dashed border-border/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
      {props.text}
    </p>
  );
}

function LogBlock(props: { label: string; text: string; truncated: boolean }) {
  return (
    <div className="overflow-hidden rounded-md border border-border/70 bg-background/55">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span>{props.label}</span>
        {props.truncated ? <span>truncated</span> : null}
      </div>
      <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-foreground">
        {props.text || "No output"}
      </pre>
    </div>
  );
}

async function requestJson<T>(
  url: string,
  label: string,
  signal: AbortSignal,
  cache: RequestCache = "default",
): Promise<T> {
  const response = await fetch(url, { cache, signal });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, label));
  }
  return (await response.json()) as T;
}

function sandboxBreadcrumbs(filePath: string): Array<{ label: string; path: string }> {
  const segments = filePath === "." ? [] : filePath.split("/").filter(Boolean);
  const breadcrumbs = [{ label: "/", path: "." }];
  for (let index = 0; index < segments.length; index += 1) {
    breadcrumbs.push({
      label: segments[index] ?? "",
      path: segments.slice(0, index + 1).join("/"),
    });
  }
  return breadcrumbs;
}

function fileContentUrl(sandboxRef: string, filePath: string, download = false): string {
  const params = new URLSearchParams({ path: filePath });
  if (download) params.set("download", "1");
  return `/sandboxes/${encodeURIComponent(sandboxRef)}/files/content?${params}`;
}

function fileExtension(filePath: string): string {
  const name = basename(filePath).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(dot + 1);
}

function basename(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}

function formatBytes(size: number | undefined): string {
  if (size === undefined) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}
