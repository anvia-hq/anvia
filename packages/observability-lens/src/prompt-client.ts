import type { JsonValue } from "@anvia/core/completion";
import type { ResolvedLensConfig } from "./config.js";
import { isRecord } from "./type-guards.js";
import type { Writable } from "./type-utils.js";
import type {
  LensChatMessage,
  LensPrompt,
  LensPromptClient,
  LensPromptClientOptions,
  LensPromptGetOptions,
} from "./types.js";

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_CACHE_ENTRIES = 100;
const DEFAULT_LABEL = "production";

export class LensPromptError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly code: string,
  ) {
    super(message);
    this.name = "LensPromptError";
  }
}

export class LensPromptCompilationError extends LensPromptError {
  constructor(code: "missing_variable" | "invalid_variable", message: string) {
    super(message, undefined, code);
    this.name = "LensPromptCompilationError";
  }
}

type PromptSelector = { label: string } | { version: number };
type PendingEntry = {
  controller: AbortController;
  promise: Promise<LensPrompt>;
  callers: number;
};
// Alternating literal text and variable placeholders, parsed exactly once per template.
type TemplatePart = string | { variable: string };

type PromptStores = {
  baseUrl: string;
  authorization: string;
  timeoutMs: number;
  cacheTtlMs: number;
  cache: Map<string, { prompt: LensPrompt; expires: number }>;
  pending: Map<string, PendingEntry>;
};

export function createLensPromptClient(
  tracingConfig: ResolvedLensConfig,
  options: LensPromptClientOptions = {},
  lifecycle?: { assertOpen(): void; signal: AbortSignal },
): LensPromptClient {
  const baseUrl = (options.baseUrl ?? tracingConfig.baseUrl).replace(/\/+$/, "");
  const publicKey = options.publicKey ?? tracingConfig.publicKey;
  const secretKey = options.secretKey ?? tracingConfig.secretKey;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new TypeError("Anvia Lens prompt timeoutMs must be a positive timer-safe integer");
  }
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0) {
    throw new TypeError("Anvia Lens prompt cacheTtlMs must be a non-negative number");
  }
  const authorization = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;
  const stores: PromptStores = {
    baseUrl,
    authorization,
    timeoutMs,
    cacheTtlMs,
    cache: new Map(),
    pending: new Map(),
  };
  let epoch = 0;

  return {
    clearCache() {
      lifecycle?.assertOpen();
      epoch += 1;
      stores.cache.clear();
      stores.pending.clear();
    },
    async getPrompt(getOptions: LensPromptGetOptions) {
      lifecycle?.assertOpen();
      const { name, label, version, signal } = getOptions;
      const normalizedName = typeof name === "string" ? name.trim() : "";
      if (normalizedName.length === 0) throw new TypeError("Anvia Lens prompt name is required");
      if (label !== undefined && version !== undefined) {
        throw new TypeError("Anvia Lens prompt requires exactly one of label or version");
      }
      if (version !== undefined && (!Number.isSafeInteger(version) || version <= 0)) {
        throw new TypeError("Anvia Lens prompt version must be a positive safe integer");
      }
      if (label !== undefined && (typeof label !== "string" || label.trim().length === 0)) {
        throw new TypeError("Anvia Lens prompt label is required");
      }
      const mode = getOptions.cache ?? "default";
      if (mode !== "default" && mode !== "reload" && mode !== "no-store") {
        throw new TypeError("Anvia Lens prompt cache mode is invalid");
      }
      if (signal?.aborted) {
        throw new LensPromptError("Lens prompt request aborted", undefined, "aborted");
      }
      const selector: PromptSelector =
        version === undefined
          ? { label: (label as string | undefined)?.trim() ?? DEFAULT_LABEL }
          : { version };
      const key = JSON.stringify([normalizedName, selector]);
      const cached = stores.cache.get(key);
      if (mode === "default" && cached !== undefined && cached.expires > Date.now()) {
        stores.cache.delete(key);
        stores.cache.set(key, cached);
        return cached.prompt;
      }
      // Expired entries are never a fallback: a failed refresh must surface its error.
      if (cached !== undefined && cached.expires <= Date.now()) stores.cache.delete(key);
      const generation = epoch;
      const existing = mode === "default" ? stores.pending.get(key) : undefined;
      const entry =
        existing ??
        createPendingEntry(
          key,
          normalizedName,
          selector,
          mode,
          generation,
          () => epoch,
          stores,
          lifecycle?.signal,
        );
      if (existing === undefined && mode !== "no-store") stores.pending.set(key, entry);
      entry.callers += 1;
      try {
        return await awaitWithAbort(entry.promise, signal);
      } finally {
        entry.callers -= 1;
        // The shared request only aborts once no caller is waiting on it anymore.
        if (entry.callers === 0) {
          if (stores.pending.get(key) === entry) stores.pending.delete(key);
          entry.controller.abort();
        }
      }
    },
  };
}

function createPendingEntry(
  key: string,
  name: string,
  selector: PromptSelector,
  mode: "default" | "reload" | "no-store",
  generation: number,
  currentEpoch: () => number,
  stores: PromptStores,
  lifecycleSignal: AbortSignal | undefined,
): PendingEntry {
  const controller = new AbortController();
  const url = new URL(`${stores.baseUrl}/api/public/prompts/${encodeURIComponent(name)}`);
  if ("label" in selector) url.searchParams.set("label", selector.label);
  else url.searchParams.set("version", String(selector.version));
  const requestSignal =
    lifecycleSignal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, lifecycleSignal]);
  let entry!: PendingEntry;
  // The finally closure only reads `entry` asynchronously, after it is assigned below.
  const promise = requestPrompt(
    url,
    stores.authorization,
    stores.timeoutMs,
    requestSignal,
    name,
    selector,
  )
    .then((prompt) => {
      // Only the current request may write: reload supersedes older retrievals,
      // and clearCache invalidates in-flight results. No-store never writes.
      if (
        mode !== "no-store" &&
        generation === currentEpoch() &&
        stores.pending.get(key) === entry &&
        !requestSignal.aborted &&
        stores.cacheTtlMs > 0
      ) {
        stores.cache.delete(key);
        stores.cache.set(key, { prompt, expires: Date.now() + stores.cacheTtlMs });
        if (stores.cache.size > MAX_CACHE_ENTRIES) {
          const oldest = stores.cache.keys().next();
          if (oldest.done !== true) stores.cache.delete(oldest.value);
        }
      }
      return prompt;
    })
    .finally(() => {
      if (stores.pending.get(key) === entry) stores.pending.delete(key);
    });
  entry = { controller, promise, callers: 0 };
  return entry;
}

async function requestPrompt(
  url: URL,
  authorization: string,
  timeoutMs: number,
  requestSignal: AbortSignal,
  name: string,
  selector: PromptSelector,
): Promise<LensPrompt> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const combined = AbortSignal.any([requestSignal, timeout.signal]);
  const operation = async (): Promise<LensPrompt> => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: authorization },
        signal: combined,
      });
    } catch {
      throw new LensPromptError("Unable to reach Anvia Lens", undefined, "network_error");
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new LensPromptError(
        "Lens returned invalid JSON",
        response.status,
        response.ok ? "invalid_response" : "request_failed",
      );
    }
    if (!response.ok) {
      // Server messages may echo prompt content or credentials; only the code is kept.
      const code =
        isRecord(value) && isRecord(value.error) && typeof value.error.code === "string"
          ? value.error.code
          : "request_failed";
      throw new LensPromptError(
        `Lens prompt request failed (${response.status})`,
        response.status,
        code,
      );
    }
    return parsePrompt(value, response.status, name, selector);
  };
  try {
    return await operation();
  } catch (error) {
    if (requestSignal.aborted) {
      throw new LensPromptError("Lens prompt request aborted", undefined, "aborted");
    }
    if (timeout.signal.aborted) {
      throw new LensPromptError("Lens prompt request timed out", undefined, "timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) {
    return Promise.reject(new LensPromptError("Lens prompt request aborted", undefined, "aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new LensPromptError("Lens prompt request aborted", undefined, "aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
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

function parsePrompt(
  value: unknown,
  status: number,
  name: string,
  selector: PromptSelector,
): LensPrompt {
  const invalid = () =>
    new LensPromptError("Lens returned an invalid prompt", status, "invalid_response");
  if (
    !isRecord(value) ||
    value.name !== name ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version <= 0 ||
    !isRecord(value.config) ||
    !isJsonValue(value.config) ||
    !Array.isArray(value.labels) ||
    !value.labels.every((label) => typeof label === "string") ||
    !isRecord(value.selector) ||
    Object.keys(value.selector).length !== 1
  ) {
    throw invalid();
  }
  // The response selector and identity must exactly match the normalized request.
  if ("label" in selector) {
    if (value.selector.label !== selector.label || !value.labels.includes(selector.label))
      throw invalid();
  } else if (value.selector.version !== selector.version || value.version !== selector.version) {
    throw invalid();
  }
  const variables = new Set<string>();
  const base = {
    name,
    version: value.version,
    ref: Object.freeze({ name, version: value.version }),
    config: deepFreezeJson(value.config) as { readonly [key: string]: JsonValue },
    labels: Object.freeze([...(value.labels as string[])]),
    selector: Object.freeze({ ...selector }) as
      | { readonly label: string }
      | { readonly version: number },
  };
  if (value.type === "text") {
    if (typeof value.template !== "string" || value.messages !== null) throw invalid();
    const parts = parseTemplate(value.template, variables);
    return Object.freeze({
      ...base,
      type: "text" as const,
      template: value.template,
      messages: null,
      variables: Object.freeze([...variables] as string[]),
      compile: (values: Readonly<Record<string, string>> = {}) => renderTemplate(parts, values),
    });
  }
  if (value.type !== "chat") throw invalid();
  if (value.template !== null || !Array.isArray(value.messages) || value.messages.length === 0)
    throw invalid();
  const messages = value.messages.map((message: unknown): LensChatMessage => {
    if (
      !isRecord(message) ||
      !isChatRole(message.role) ||
      typeof message.content !== "string" ||
      (message.name !== undefined && typeof message.name !== "string")
    ) {
      throw invalid();
    }
    const parsed: Writable<LensChatMessage> = {
      role: message.role,
      content: message.content,
    };
    if (message.name !== undefined) parsed.name = message.name;
    return Object.freeze(parsed);
  });
  const parts = messages.map((message) => parseTemplate(message.content, variables));
  return Object.freeze({
    ...base,
    type: "chat" as const,
    template: null,
    messages: Object.freeze(messages),
    variables: Object.freeze([...variables] as string[]),
    compile: (values: Readonly<Record<string, string>> = {}) =>
      messages.map((message, index) => ({
        ...message,
        content: renderTemplate(parts[index] as TemplatePart[], values),
      })),
  });
}

function parseTemplate(template: string, variables: Set<string>): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const pattern = /\\?\{\{\s*([a-zA-Z_][a-zA-Z0-9_.-]*)\s*\}\}/g;
  let offset = 0;
  for (const match of template.matchAll(pattern)) {
    parts.push(template.slice(offset, match.index));
    if (match[0].startsWith("\\")) {
      // An escaped placeholder renders as its literal text without registering a variable.
      parts.push(match[0].slice(1));
    } else {
      const variable = match[1] as string;
      variables.add(variable);
      parts.push({ variable });
    }
    offset = (match.index ?? 0) + match[0].length;
  }
  parts.push(template.slice(offset));
  return parts;
}

function renderTemplate(parts: TemplatePart[], values: Readonly<Record<string, string>>): string {
  const missing: string[] = [];
  let rendered = "";
  for (const part of parts) {
    if (typeof part === "string") {
      rendered += part;
      continue;
    }
    if (!Object.hasOwn(values, part.variable)) {
      missing.push(part.variable);
      continue;
    }
    const value = values[part.variable];
    if (typeof value !== "string") {
      throw new LensPromptCompilationError(
        "invalid_variable",
        `Anvia Lens prompt variable "${part.variable}" must be a string`,
      );
    }
    // Values are concatenated verbatim: no recursive replacement of placeholders.
    rendered += value;
  }
  if (missing.length > 0) {
    throw new LensPromptCompilationError(
      "missing_variable",
      `Anvia Lens prompt is missing variables: ${missing.join(", ")}`,
    );
  }
  return rendered;
}

function isChatRole(value: unknown): value is LensChatMessage["role"] {
  return value === "system" || value === "user" || value === "assistant" || value === "tool";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function deepFreezeJson(value: JsonValue): JsonValue {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}
