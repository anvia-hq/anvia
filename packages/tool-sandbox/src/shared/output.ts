import type { SandboxProcessInfo } from "../types";
import { DockerSandboxError } from "../errors";

export class TailOutputCollector {
  private chunks: Buffer[] = [];
  private length = 0;
  private didTruncate = false;

  constructor(private readonly maxBytes: number) {}

  accept(chunk: Buffer): void {
    if (chunk.length === 0) return;
    if (this.maxBytes <= 0) {
      this.didTruncate = true;
      return;
    }

    if (chunk.length >= this.maxBytes) {
      this.chunks = [chunk.subarray(chunk.length - this.maxBytes)];
      this.length = this.maxBytes;
      this.didTruncate = true;
      return;
    }

    this.chunks.push(chunk);
    this.length += chunk.length;
    while (this.length > this.maxBytes) {
      const first = this.chunks[0];
      if (first === undefined) break;
      const overflow = this.length - this.maxBytes;
      if (first.length <= overflow) {
        this.chunks.shift();
        this.length -= first.length;
      } else {
        this.chunks[0] = first.subarray(overflow);
        this.length -= overflow;
      }
      this.didTruncate = true;
    }
  }

  snapshot(tailBytes?: number): { bytes: Uint8Array; truncated: boolean } {
    if (tailBytes !== undefined && (!Number.isInteger(tailBytes) || tailBytes < 0)) {
      throw processError("Process tailBytes must be a non-negative integer.");
    }
    const bytes = Buffer.concat(this.chunks, this.length);
    const selected =
      tailBytes === 0
        ? Buffer.alloc(0)
        : tailBytes === undefined || bytes.length <= tailBytes
          ? bytes
          : bytes.subarray(bytes.length - tailBytes);
    return {
      bytes: new Uint8Array(selected.buffer, selected.byteOffset, selected.byteLength).slice(),
      truncated: this.didTruncate || selected.length < bytes.length,
    };
  }
}

export function processError(message: string): DockerSandboxError {
  return new DockerSandboxError(message, "process");
}

export function copyProcessInfo(info: SandboxProcessInfo): SandboxProcessInfo {
  let copy: SandboxProcessInfo = {
    id: info.id,
    command: info.command,
    args: [...info.args],
    status: info.status,
    startedAt: info.startedAt,
  };
  if (info.cwd !== undefined) copy = { ...copy, cwd: info.cwd };
  if (info.exitCode !== undefined) copy = { ...copy, exitCode: info.exitCode };
  if (info.endedAt !== undefined) copy = { ...copy, endedAt: info.endedAt };
  return copy;
}

export async function waitForPromise(
  promise: Promise<void>,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  abortSignal?.throwIfAborted();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
        timeout.unref?.();
      }),
      new Promise<boolean>((_, reject) => {
        if (abortSignal === undefined) return;
        abort = () => reject(abortSignal.reason ?? new DOMException("Aborted", "AbortError"));
        if (abortSignal.aborted) abort();
        else abortSignal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abort !== undefined) abortSignal?.removeEventListener("abort", abort);
  }
}

export async function waitForDelay(timeoutMs: number, abortSignal?: AbortSignal): Promise<void> {
  await waitForPromise(
    new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, timeoutMs);
      timeout.unref?.();
    }),
    timeoutMs,
    abortSignal,
  );
}

export function createOutputCollector(maxBytes: number, onChunk?: (chunk: Uint8Array) => void) {
  const chunks: Buffer[] = [];
  let length = 0;
  let truncated = false;

  return {
    get truncated() {
      return truncated;
    },
    accept(chunk: Buffer) {
      onChunk?.(chunk);

      if (length >= maxBytes) {
        truncated = true;
        return;
      }

      const remaining = maxBytes - length;
      const next = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks.push(next);
      length += next.length;

      if (next.length < chunk.length) {
        truncated = true;
      }
    },
    bytes() {
      const bytes = Buffer.concat(chunks, length);
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
    },
  };
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
