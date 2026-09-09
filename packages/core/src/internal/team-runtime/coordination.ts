import { abortError, throwIfAborted } from "../abort";

/** Races caller-owned work without leaving abort listeners installed after settlement. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => undefined);
    return Promise.reject(abortError(signal.reason));
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(abortError(signal.reason));
    };
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** A versioned notification avoids losing a wakeup between a check and a wait. */
export class TeamChanges {
  version = 0;
  private listeners = new Set<() => void>();

  notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  wait(version: number, signal: AbortSignal, timeoutMs?: number): Promise<void> {
    throwIfAborted(signal);
    if (version !== this.version) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        this.listeners.delete(done);
        signal.removeEventListener("abort", abort);
        if (timer !== undefined) clearTimeout(timer);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(abortError(signal.reason));
      };
      this.listeners.add(done);
      signal.addEventListener("abort", abort, { once: true });
      if (timeoutMs !== undefined) timer = setTimeout(done, timeoutMs);
    });
  }
}

/** FIFO admission. Waits and human interactions return their permit temporarily. */
export class TeamSlots {
  private active = 0;
  private readonly changes = new TeamChanges();
  private readonly queue: object[] = [];

  constructor(private readonly maximum: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    const ticket = {};
    this.queue.push(ticket);
    try {
      while (true) {
        throwIfAborted(signal);
        const version = this.changes.version;
        if (this.queue[0] === ticket && this.active < this.maximum) {
          this.queue.shift();
          this.active += 1;
          this.changes.notify();
          let released = false;
          return () => {
            if (released) return;
            released = true;
            this.active -= 1;
            this.changes.notify();
          };
        }
        await this.changes.wait(version, signal);
      }
    } finally {
      const index = this.queue.indexOf(ticket);
      if (index !== -1) this.queue.splice(index, 1);
      this.changes.notify();
    }
  }
}
