import { AcpError } from "./errors.js";

/** Session-owned reservation registry for later permission/editor bridges. */
export class PendingRequests {
  private readonly pending = new Set<AbortController>();
  private closed = false;

  constructor(private readonly maximum: number) {}

  get size(): number {
    return this.pending.size;
  }

  async run<T>(start: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) throw new AcpError("connection_closed");
    if (this.pending.size >= this.maximum) throw new AcpError("resource_limit");
    const controller = new AbortController();
    this.pending.add(controller);
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new AcpError("connection_closed"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const result = await Promise.race([start(controller.signal), aborted]);
      if (controller.signal.aborted) throw new AcpError("connection_closed");
      return result;
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
      this.pending.delete(controller);
    }
  }

  close(): void {
    this.closed = true;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }
}
