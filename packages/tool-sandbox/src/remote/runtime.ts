import { DockerSandboxError } from "../errors";
import { normalizeSandboxPath } from "../path";
import { decodeUtf8 } from "../shared/output";
import {
  assertOptionsObject,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
  assertReadOptions,
  combineSignals,
  resolvePortWaitOptions,
  resolveTextFilePageOptions,
  validateExecOptions,
  validateProcessStartOptions,
} from "../shared/validation";
import type {
  SandboxExecOptions,
  SandboxExecResult,
  SandboxExecStreamEvent,
  SandboxFileEntry,
  SandboxListFilesOptions,
  SandboxListProcessesOptions,
  SandboxPortStatus,
  SandboxProcessInfo,
  SandboxProcessLogs,
  SandboxProcessStartOptions,
  SandboxPublishedPort,
  SandboxReadFileOptions,
  SandboxReadProcessLogsOptions,
  SandboxReadTextFilePageOptions,
  SandboxRuntime,
  SandboxStopProcessOptions,
  SandboxTextFilePage,
  SandboxWaitForPortOptions,
  SandboxWriteFileOptions,
  SandboxWriteTextFileOptions,
} from "../types";
import type { CallOptions, HubConnection } from "./connection";
import {
  type MethodParams,
  type MethodResult,
  type SandboxMethod,
  compact,
  decodeBytes,
  decodeExecResult,
  decodeProcessLogs,
  encodeBytes,
  encodeInput,
} from "./protocol";
import { rpc } from "./rpc";

/** Where a runtime gets a live daemon connection from. */
export interface RemoteLinkSource {
  /** Current workdir: the connected daemon's if known, otherwise the configured one. */
  workdir(): string;
  /** Wait for a connected daemon, or fail with `sandbox_unavailable` after the connect timeout. */
  acquire(signal?: AbortSignal): Promise<HubConnection>;
}

export interface RemoteSandboxRuntimeOptions {
  id: string;
  source: RemoteLinkSource;
  /** Bytes an execStream consumer may fall behind by before the stream is aborted. */
  maxStreamBufferBytes?: number | undefined;
}

const defaultMaxStreamBufferBytes = 1024 * 1024;

/**
 * A {@link SandboxRuntime} backed by a daemon that dialled in to a hub. Calls that are safe to
 * repeat (reads, and mutations carrying an `operationId`) transparently ride out a reconnect.
 * A mutation without an `operationId` fails with `sandbox_unavailable` instead, because it may
 * already have run.
 */
export class RemoteSandboxRuntime implements SandboxRuntime {
  readonly id: string;
  readonly provider = "remote";
  readonly publishedPorts: readonly SandboxPublishedPort[] = Object.freeze([]);
  private readonly source: RemoteLinkSource;
  private readonly maxStreamBufferBytes: number;

  constructor(options: RemoteSandboxRuntimeOptions) {
    this.id = options.id;
    this.source = options.source;
    this.maxStreamBufferBytes = options.maxStreamBufferBytes ?? defaultMaxStreamBufferBytes;
  }

  get workdir(): string {
    return this.source.workdir();
  }

  async exec(options: SandboxExecOptions): Promise<SandboxExecResult> {
    validateExecOptions(options);
    assertOperationId(options.operationId);
    const result = await this.call("exec", execParams(options), {
      operationId: options.operationId,
      signal: options.abortSignal,
    });
    return decodeExecResult(result);
  }

  async *execStream(options: SandboxExecOptions): AsyncIterable<SandboxExecStreamEvent> {
    validateExecOptions(options);
    assertOperationId(options.operationId);
    const streamAbort = new AbortController();
    const signal = combineSignals(options.abortSignal, streamAbort.signal);
    const queue: SandboxExecStreamEvent[] = [];
    let queuedBytes = 0;
    let wake: (() => void) | undefined;
    let complete = false;
    let failure: unknown;
    const push = (event: SandboxExecStreamEvent) => {
      if (event.type !== "result") {
        queuedBytes += event.data.byteLength;
        if (queuedBytes > this.maxStreamBufferBytes) {
          streamAbort.abort(
            new DockerSandboxError("Sandbox stream consumer is too slow.", "protocol"),
          );
          return;
        }
      }
      queue.push(event);
      wake?.();
      wake = undefined;
    };

    const run = this.call("execStream", execParams(options), {
      operationId: options.operationId,
      signal,
      onStream: (stream, data) => push({ type: stream, data }),
    }).then((result) => push({ type: "result", result: decodeExecResult(result) }));
    void run.then(
      () => {
        complete = true;
        wake?.();
      },
      (error) => {
        failure = error;
        complete = true;
        wake?.();
      },
    );

    try {
      while (!complete || queue.length > 0) {
        const event = queue.shift();
        if (event !== undefined) {
          if (event.type !== "result") queuedBytes -= event.data.byteLength;
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (failure !== undefined) throw failure;
    } finally {
      if (!complete) streamAbort.abort(new DOMException("Stream closed", "AbortError"));
      await run.catch(() => undefined);
    }
  }

  async readFile(options: SandboxReadFileOptions): Promise<Uint8Array> {
    assertReadOptions(options);
    const result = await this.call(
      "readFile",
      { path: normalizeSandboxPath(options.path) },
      { signal: options.abortSignal },
    );
    return decodeBytes(result.base64);
  }

  async readTextFile(options: SandboxReadFileOptions): Promise<string> {
    return decodeUtf8(await this.readFile(options));
  }

  async readTextFilePage(options: SandboxReadTextFilePageOptions): Promise<SandboxTextFilePage> {
    assertReadOptions(options);
    const page = resolveTextFilePageOptions(options);
    const result = await this.call(
      "readTextFilePage",
      { path: normalizeSandboxPath(options.path), ...page },
      { signal: options.abortSignal },
    );
    return result;
  }

  async writeFile(options: SandboxWriteFileOptions): Promise<void> {
    assertOptionsObject(options);
    if (!(options.data instanceof Uint8Array)) throw new TypeError("data must be a Uint8Array.");
    assertOperationId(options.operationId);
    await this.call(
      "writeFile",
      { path: normalizeSandboxPath(options.path), base64: encodeBytes(options.data) },
      { operationId: options.operationId, signal: options.abortSignal },
    );
  }

  async writeTextFile(options: SandboxWriteTextFileOptions): Promise<void> {
    assertOptionsObject(options);
    if (typeof options.text !== "string") throw new TypeError("text must be a string.");
    await this.writeFile(
      compact({
        path: options.path,
        data: new TextEncoder().encode(options.text),
        operationId: options.operationId,
        abortSignal: options.abortSignal,
      }),
    );
  }

  async listFiles(options: SandboxListFilesOptions = {}): Promise<readonly SandboxFileEntry[]> {
    assertOptionsObject(options);
    const path = normalizeSandboxPath(options.path ?? ".", { allowRoot: true });
    const result = await this.call("listFiles", { path }, { signal: options.abortSignal });
    return result.entries.map((entry) => compact(entry));
  }

  async startProcess(options: SandboxProcessStartOptions): Promise<SandboxProcessInfo> {
    validateProcessStartOptions(options);
    assertOperationId(options.operationId);
    const result = await this.call(
      "startProcess",
      compact({
        command: options.command,
        args: options.args === undefined ? undefined : [...options.args],
        cwd: options.cwd,
        env: options.env === undefined ? undefined : { ...options.env },
      }),
      { operationId: options.operationId, signal: options.abortSignal },
    );
    return compact(result);
  }

  async listProcesses(
    options: SandboxListProcessesOptions = {},
  ): Promise<readonly SandboxProcessInfo[]> {
    assertOptionsObject(options);
    const result = await this.call("listProcesses", {}, { signal: options.abortSignal });
    return result.processes.map((process) => compact(process));
  }

  async readProcessLogs(options: SandboxReadProcessLogsOptions): Promise<SandboxProcessLogs> {
    assertOptionsObject(options);
    assertNonEmptyString(options.processId, "processId");
    if (options.tailBytes !== undefined)
      assertNonNegativeSafeInteger(options.tailBytes, "tailBytes");
    const result = await this.call(
      "readProcessLogs",
      compact({ processId: options.processId, tailBytes: options.tailBytes }),
      { signal: options.abortSignal },
    );
    return decodeProcessLogs(result);
  }

  async stopProcess(options: SandboxStopProcessOptions): Promise<SandboxProcessInfo> {
    assertOptionsObject(options);
    assertNonEmptyString(options.processId, "processId");
    if (options.gracePeriodMs !== undefined) {
      assertNonNegativeSafeInteger(options.gracePeriodMs, "gracePeriodMs");
    }
    assertOperationId(options.operationId);
    const result = await this.call(
      "stopProcess",
      compact({ processId: options.processId, gracePeriodMs: options.gracePeriodMs }),
      { operationId: options.operationId, signal: options.abortSignal },
    );
    return compact(result);
  }

  /** Resolves once something accepts connections on the sandbox's loopback interface. */
  async waitForPort(options: SandboxWaitForPortOptions): Promise<SandboxPortStatus> {
    assertOptionsObject(options);
    const { timeoutMs, intervalMs } = resolvePortWaitOptions(options);
    return this.call(
      "waitForPort",
      { containerPort: options.containerPort, timeoutMs, intervalMs },
      { signal: options.abortSignal },
    );
  }

  private call<M extends SandboxMethod>(
    method: M,
    params: MethodParams<M>,
    options: CallOptions,
  ): Promise<MethodResult<M>> {
    return rpc(this.source, method, params, options);
  }
}

function execParams(options: SandboxExecOptions): MethodParams<"exec"> {
  return compact({
    command: options.command,
    args: options.args === undefined ? undefined : [...options.args],
    cwd: options.cwd,
    env: options.env === undefined ? undefined : { ...options.env },
    timeoutMs: options.timeoutMs,
    input: encodeInput(options.input),
  });
}

function assertOperationId(value: string | undefined): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError("operationId must be a non-empty string of at most 256 characters.");
  }
}
