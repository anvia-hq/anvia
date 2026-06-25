import { getResolvedLangfuseConfig, resolveLangfuseConfig } from "./config.js";
import { LangfuseScoreError } from "./scoring.js";
import type {
  LangfuseChatMessage,
  LangfusePrompt,
  LangfusePromptClient,
  LangfusePromptClientOptions,
  LangfusePromptGetOptions,
  LangfuseTracing,
} from "./types.js";

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export function createLangfusePromptClient(
  tracing: Pick<LangfuseTracing, "score">,
  options: LangfusePromptClientOptions = {},
): LangfusePromptClient {
  const resolvedConfig = resolveLangfuseConfig(options, getResolvedLangfuseConfig(tracing));
  const baseUrl = resolvedConfig.baseUrl;
  const publicKey = resolvedConfig.publicKey;
  const secretKey = resolvedConfig.secretKey;
  const defaultTtl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const timeoutMs = options.timeoutMs ?? resolvedConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const cache = new Map<string, { prompt: LangfusePrompt; expiresAt: number }>();
  const authHeader = buildAuthHeader(publicKey, secretKey);

  async function request<T>(input: string): Promise<T> {
    const response = await fetch(input, {
      method: "GET",
      headers: { ...authHeader },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new LangfuseScoreError(
        `Langfuse request failed: ${response.status} ${response.statusText}: ${body}`,
        [],
      );
    }
    return (await response.json()) as T;
  }

  async function getPrompt(
    name: string,
    opts: LangfusePromptGetOptions = {},
  ): Promise<LangfusePrompt> {
    const key = `${name}::${opts.version ?? ""}::${opts.label ?? ""}`;
    const ttl = opts.cacheTtlMs ?? defaultTtl;
    if (opts.refresh !== true) {
      const cached = cache.get(key);
      if (cached !== undefined && cached.expiresAt > Date.now()) {
        return cached.prompt;
      }
    }
    const url = new URL(`${baseUrl}/api/public/v2/prompts/${encodeURIComponent(name)}`);
    if (opts.version !== undefined) {
      url.searchParams.set("version", String(opts.version));
    }
    if (opts.label !== undefined) {
      url.searchParams.set("label", opts.label);
    }
    const raw = await request<{
      name: string;
      version: number;
      labels?: string[];
      prompt: unknown;
      type: "text" | "chat";
      tags?: string[];
    }>(url.toString());
    const prompt: LangfusePrompt = {
      name: raw.name,
      version: raw.version,
      labels: raw.labels ?? [],
      prompt: normalizePrompt(raw.prompt, raw.type),
      type: raw.type,
      ...(raw.tags === undefined ? {} : { tags: raw.tags }),
      resolvedAt: new Date(),
    };
    cache.set(key, { prompt, expiresAt: Date.now() + ttl });
    return prompt;
  }

  function getPromptText(name: string, opts?: LangfusePromptGetOptions): Promise<string> {
    return getPrompt(name, opts).then((prompt) => {
      if (typeof prompt.prompt !== "string") {
        throw new Error(`Prompt ${name} is a chat prompt; expected text`);
      }
      return prompt.prompt;
    });
  }

  function getPromptChat(
    name: string,
    opts?: LangfusePromptGetOptions,
  ): Promise<LangfuseChatMessage[]> {
    return getPrompt(name, opts).then((prompt) => {
      if (typeof prompt.prompt === "string") {
        throw new Error(`Prompt ${name} is a text prompt; expected chat`);
      }
      return prompt.prompt;
    });
  }

  function refresh(): void {
    cache.clear();
  }

  return { getPrompt, getPromptText, getPromptChat, refresh };
}

function normalizePrompt(raw: unknown, type: "text" | "chat"): string | LangfuseChatMessage[] {
  if (type === "text") {
    if (typeof raw === "string") return raw;
    throw new Error("Expected text prompt to be a string");
  }
  if (!Array.isArray(raw)) {
    throw new Error("Expected chat prompt to be an array of messages");
  }
  return raw.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Expected chat message to be an object");
    }
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if (typeof content !== "string") {
      throw new Error("Expected chat message content to be a string");
    }
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {
      throw new Error(`Unexpected chat message role: ${String(role)}`);
    }
    return { role, content };
  });
}

function buildAuthHeader(
  publicKey: string | undefined,
  secretKey: string | undefined,
): Record<string, string> {
  if (publicKey === undefined || secretKey === undefined) {
    return {};
  }
  const encoded = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  return { Authorization: `Basic ${encoded}` };
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable>";
  }
}
