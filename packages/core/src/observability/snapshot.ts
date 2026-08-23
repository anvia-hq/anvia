export function observerSnapshot<T>(value: T): T {
  if (containsError(value, new WeakSet<object>())) {
    return cloneObserverFallback(value, new WeakMap<object, object>());
  }
  try {
    return globalThis.structuredClone(value);
  } catch {
    return cloneObserverFallback(value, new WeakMap<object, object>());
  }
}

function cloneObserverFallback<T>(value: T, seen: WeakMap<object, object>): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const existing = seen.get(value);
  if (existing !== undefined) {
    return existing as T;
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    clone.push(...value.map((item) => cloneObserverFallback(item, seen)));
    return clone as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (value instanceof Error) {
    const clone = Object.create(Object.getPrototypeOf(value)) as Error;
    seen.set(value, clone);
    Object.defineProperties(clone, {
      name: { configurable: true, writable: true, value: value.name },
      message: { configurable: true, writable: true, value: value.message },
    });
    if (value.stack !== undefined) {
      Object.defineProperty(clone, "stack", {
        configurable: true,
        writable: true,
        value: value.stack,
      });
    }
    if (value.cause !== undefined) {
      Object.defineProperty(clone, "cause", {
        configurable: true,
        writable: true,
        value: cloneObserverFallback(value.cause, seen),
      });
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "name" || key === "message" || key === "stack" || key === "cause") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if ("value" in descriptor) {
        descriptor.value = cloneObserverFallback(descriptor.value, seen);
      }
      Object.defineProperty(clone, key, descriptor);
    }
    return clone as T;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }
  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  for (const [key, item] of Object.entries(value)) {
    clone[key] = cloneObserverFallback(item, seen);
  }
  return clone as T;
}

function containsError(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (value instanceof Error) return true;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsError(item, seen));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).some((item) => containsError(item, seen));
}
