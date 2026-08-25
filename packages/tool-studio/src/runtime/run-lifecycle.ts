export type StudioRunLease = {
  readonly abortSignal: AbortSignal;
  finish(): void;
};

export class StudioRunLifecycle {
  private readonly shutdownController = new AbortController();
  private readonly active = new Set<symbol>();
  private drainPromise: Promise<void> | undefined;
  private resolveDrain: (() => void) | undefined;
  private closed = false;

  start(requestSignal: AbortSignal): StudioRunLease | undefined {
    if (this.closed) return undefined;

    const token = Symbol("studio-run");
    this.active.add(token);
    let finished = false;
    return {
      abortSignal: AbortSignal.any([requestSignal, this.shutdownController.signal]),
      finish: () => {
        if (finished) return;
        finished = true;
        this.active.delete(token);
        if (this.active.size === 0) {
          this.resolveDrain?.();
          this.resolveDrain = undefined;
          this.drainPromise = undefined;
        }
      },
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.shutdownController.abort(new Error("Anvia Studio is shutting down."));
  }

  async drain(timeoutMs: number): Promise<void> {
    this.close();
    if (this.active.size === 0) return;

    this.drainPromise ??= new Promise<void>((resolve) => {
      this.resolveDrain = resolve;
    });
    await withTimeout(this.drainPromise, timeoutMs);
  }
}

async function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Anvia Studio shutdown timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
