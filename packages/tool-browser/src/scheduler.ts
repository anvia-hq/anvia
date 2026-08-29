import { BrowserError, cancellationError } from "./errors";

type Task<T> = {
  abortSignal?: AbortSignal;
  abort?: () => void;
  controller: AbortController;
  operation: (abortSignal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type Resource = {
  running: boolean;
  ready: boolean;
  tasks: Task<unknown>[];
};

export class ResourceScheduler {
  private readonly resources = new Map<string, Resource>();
  private readonly readyResources: string[] = [];
  private readonly activeTasks = new Set<Task<unknown>>();
  private readonly serial: boolean;
  private readonly maxConcurrentResources: number;
  private readonly maxQueuedActions: number;
  private activeResources = 0;
  private queuedActions = 0;
  private closedError: BrowserError | undefined;

  constructor(options: {
    mode: "serial" | "per-tab";
    maxConcurrentResources: number;
    maxQueuedActions: number;
  }) {
    this.serial = options.mode === "serial";
    this.maxConcurrentResources = options.maxConcurrentResources;
    this.maxQueuedActions = options.maxQueuedActions;
  }

  run<T>(
    resourceKey: string,
    abortSignal: AbortSignal | undefined,
    operation: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closedError !== undefined) return Promise.reject(this.closedError);
    if (abortSignal?.aborted) {
      return Promise.reject(abortReason(abortSignal, "agent-action-queue"));
    }
    if (this.queuedActions >= this.maxQueuedActions) {
      return Promise.reject(
        new BrowserError("Browser action queue capacity was reached.", "agent_action_busy", {
          phase: "agent-action-queue",
        }),
      );
    }

    const key = this.serial ? "browser" : resourceKey;
    let resource = this.resources.get(key);
    if (resource === undefined) {
      resource = { running: false, ready: false, tasks: [] };
      this.resources.set(key, resource);
    }

    return new Promise<T>((resolve, reject) => {
      const task: Task<T> = {
        controller: new AbortController(),
        operation,
        resolve,
        reject,
        ...(abortSignal === undefined ? {} : { abortSignal }),
      };
      if (abortSignal !== undefined) {
        task.abort = () => {
          const current = this.resources.get(key);
          const index = current?.tasks.indexOf(task as Task<unknown>) ?? -1;
          if (index === -1) return;
          current?.tasks.splice(index, 1);
          this.queuedActions -= 1;
          abortSignal.removeEventListener("abort", task.abort!);
          reject(abortReason(abortSignal, "agent-action-queue"));
          this.deleteIdleResource(key, current);
        };
        abortSignal.addEventListener("abort", task.abort, { once: true });
      }
      resource.tasks.push(task as Task<unknown>);
      this.queuedActions += 1;
      this.markReady(key, resource);
      this.pump();
    });
  }

  close(error = new BrowserError("Browser connection is closed.", "connection_closed")): void {
    if (this.closedError !== undefined) return;
    this.closedError = error;
    for (const task of this.activeTasks) task.controller.abort(error);
    for (const [key, resource] of this.resources) {
      for (const task of resource.tasks.splice(0)) {
        this.queuedActions -= 1;
        if (task.abort !== undefined) task.abortSignal?.removeEventListener("abort", task.abort);
        task.reject(error);
      }
      resource.ready = false;
      if (!resource.running) this.resources.delete(key);
    }
    this.readyResources.length = 0;
  }

  private markReady(key: string, resource: Resource): void {
    if (resource.running || resource.ready || resource.tasks.length === 0) return;
    resource.ready = true;
    this.readyResources.push(key);
  }

  private pump(): void {
    while (
      this.closedError === undefined &&
      this.activeResources < this.maxConcurrentResources &&
      this.readyResources.length > 0
    ) {
      const key = this.readyResources.shift();
      if (key === undefined) return;
      const resource = this.resources.get(key);
      if (resource === undefined || resource.running || resource.tasks.length === 0) continue;
      resource.ready = false;
      const task = resource.tasks.shift();
      if (task === undefined) continue;
      this.queuedActions -= 1;
      if (task.abort !== undefined) task.abortSignal?.removeEventListener("abort", task.abort);
      resource.running = true;
      this.activeResources += 1;
      this.activeTasks.add(task);
      const effectiveSignal =
        task.abortSignal === undefined
          ? task.controller.signal
          : AbortSignal.any([task.abortSignal, task.controller.signal]);
      let operation: Promise<unknown>;
      try {
        operation = task.operation(effectiveSignal);
      } catch (error) {
        operation = Promise.reject(error);
      }
      void operation.then(task.resolve, task.reject).finally(() => {
        this.activeTasks.delete(task);
        resource.running = false;
        this.activeResources -= 1;
        this.markReady(key, resource);
        this.deleteIdleResource(key, resource);
        this.pump();
      });
    }
  }

  private deleteIdleResource(key: string, resource: Resource | undefined): void {
    if (resource !== undefined && !resource.running && resource.tasks.length === 0) {
      this.resources.delete(key);
    }
  }
}

type MutexWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  abortSignal?: AbortSignal;
  abort?: () => void;
};

export class AsyncMutex {
  private readonly waiters: MutexWaiter[] = [];
  private locked = false;
  private closedError: BrowserError | undefined;

  async run<T>(abortSignal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(abortSignal);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  close(error = new BrowserError("Browser connection is closed.", "connection_closed")): void {
    if (this.closedError !== undefined) return;
    this.closedError = error;
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.abort !== undefined) {
        waiter.abortSignal?.removeEventListener("abort", waiter.abort);
      }
      waiter.reject(error);
    }
  }

  private acquire(abortSignal: AbortSignal | undefined): Promise<() => void> {
    if (this.closedError !== undefined) return Promise.reject(this.closedError);
    if (abortSignal?.aborted) {
      return Promise.reject(abortReason(abortSignal, "browser-resource-lock"));
    }
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(this.releaseCallback());
    }
    return new Promise((resolve, reject) => {
      const waiter: MutexWaiter = {
        resolve,
        reject,
        ...(abortSignal === undefined ? {} : { abortSignal }),
      };
      if (abortSignal !== undefined) {
        waiter.abort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index === -1) return;
          this.waiters.splice(index, 1);
          reject(abortReason(abortSignal, "browser-resource-lock"));
        };
        abortSignal.addEventListener("abort", waiter.abort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private releaseCallback(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.waiters.shift();
      if (waiter === undefined) {
        this.locked = false;
        return;
      }
      if (waiter.abort !== undefined) {
        waiter.abortSignal?.removeEventListener("abort", waiter.abort);
      }
      waiter.resolve(this.releaseCallback());
    };
  }
}

function abortReason(abortSignal: AbortSignal, phase: string): BrowserError {
  return abortSignal.reason instanceof BrowserError
    ? abortSignal.reason
    : cancellationError(abortSignal.reason, phase);
}
