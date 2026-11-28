import { createTool, createToolkit, type Toolkit, type ToolkitOptions } from "@anvia/core/tool";
import { z } from "zod";
import { truncateText } from "../../internal/truncate";
import { parseHttpUrl, safeFetch, type UrlSafetyOptions } from "../../internal/url-safety";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
export type HttpClientToolName = "http_request";

export type HttpClientOptions = ToolkitOptions<HttpClientToolName> &
  UrlSafetyOptions & {
    /** Optional base URL. Relative request paths resolve against it. */
    baseUrl?: string | undefined;
    /** HTTP methods the model may call. Defaults to GET, POST, PUT, PATCH, DELETE, HEAD. */
    allowedMethods?: readonly HttpMethod[] | undefined;
    /** Config-level headers (e.g. auth tokens) always injected and never overridden by the model. */
    headers?: Record<string, string> | undefined;
    /** Maximum response bytes read from the network. Default 512_000. */
    maxBytes?: number | undefined;
    /** Maximum characters returned to the model. Default 16_000. */
    maxChars?: number | undefined;
    /** Maximum HTTP redirects followed. Default 3. */
    maxRedirects?: number | undefined;
    /** Custom fetch implementation (useful for testing). */
    fetch?: typeof globalThis.fetch | undefined;
  };

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
const DEFAULT_INSTRUCTIONS =
  "Use http_request to call configured HTTP endpoints. Authentication headers are injected automatically; do not include secrets in parameters.";

export function httpClient(options: HttpClientOptions): Toolkit {
  const parsedBase = options.baseUrl === undefined ? undefined : parseHttpUrl(options.baseUrl);

  if (options.allowedHosts !== undefined && options.allowedHosts.length === 0) {
    throw new TypeError("httpClient allowedHosts must not be empty when specified.");
  }

  let allowedHosts: readonly string[] | undefined;
  let allowedOrigins: readonly string[] | undefined = options.allowedOrigins;

  if (options.allowedHosts !== undefined) {
    allowedHosts = options.allowedHosts;
  } else if (parsedBase !== undefined) {
    allowedHosts = [parsedBase.hostname];
    allowedOrigins ??= [parsedBase.origin];
  }

  if (allowedHosts === undefined || allowedHosts.length === 0) {
    throw new TypeError("httpClient requires either baseUrl or at least one allowedHosts entry.");
  }

  const allowedMethods = (options.allowedMethods ?? ALL_METHODS).map(
    (method) => method.toUpperCase() as HttpMethod,
  );

  if (allowedMethods.length === 0) {
    throw new TypeError("httpClient allowedMethods must not be empty.");
  }

  const maxBytes = options.maxBytes ?? 512_000;
  const maxChars = options.maxChars ?? 16_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 15_000;

  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("httpClient maxBytes must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) {
    throw new RangeError("httpClient maxChars must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new RangeError("httpClient maxRedirects must be a non-negative safe integer.");
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("httpClient timeoutMs must be a positive finite number.");
  }

  const allowedMethodSet = new Set<string>(allowedMethods);
  const configHeaders = normalizeHeaders(options.headers);
  const protectedHeaderNames = Object.keys(configHeaders);

  const requestTool = createTool({
    name: "http_request",
    description:
      parsedBase !== undefined
        ? `Send an HTTP request to ${parsedBase.origin} (methods: ${allowedMethods.join(", ")}).`
        : `Send an HTTP request to allowed hosts (${allowedHosts.join(", ")}; methods: ${allowedMethods.join(", ")}).`,
    inputSchema: z.object({
      method: z
        .enum(ALL_METHODS)
        .default("GET")
        .describe(`HTTP method. Allowed: ${allowedMethods.join(", ")}.`),
      url: z
        .string()
        .min(1)
        .describe(
          parsedBase !== undefined
            ? "Relative path (resolved against baseUrl) or full allowed http(s) URL."
            : "Full allowed http(s) URL.",
        ),
      query: z.record(z.string(), z.string()).optional().describe("Optional query parameters."),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional request headers (cannot override configured auth headers)."),
      body: z.string().optional().describe("Optional request body string (e.g. JSON)."),
    }),
    handler: async (args, context) => {
      const method = args.method.toUpperCase();

      if (!allowedMethodSet.has(method)) {
        throw new Error(
          `HTTP method "${method}" is not allowed. Allowed methods: ${allowedMethods.join(", ")}.`,
        );
      }

      const resolvedUrl = resolveRequestUrl(args.url, parsedBase);

      if (args.query !== undefined) {
        for (const [key, value] of Object.entries(args.query)) {
          resolvedUrl.searchParams.set(key, value);
        }
      }

      const mergedHeaders = mergeHeaders(args.headers, configHeaders);
      const response = await safeFetch(resolvedUrl.toString(), {
        method,
        headers: mergedHeaders,
        protectedHeaderNames,
        allowedMethods,
        body: args.body,
        allowedHosts,
        allowedOrigins,
        blockedHosts: options.blockedHosts,
        allowPrivateAddresses: options.allowPrivateAddresses,
        resolveAddress: options.resolveAddress,
        maxBytes,
        maxRedirects,
        timeoutMs,
        abortSignal: context.abortSignal,
        fetch: options.fetch,
      });

      const { text, truncated } = truncateText(response.bodyText, maxChars);
      return {
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: text,
        truncated: truncated || response.bodyTruncated,
      };
    },
  });

  return createToolkit<HttpClientToolName>(
    {
      name: "http-client",
      tools: [requestTool],
      instructions: DEFAULT_INSTRUCTIONS,
    },
    options,
  );
}

function resolveRequestUrl(raw: string, baseUrl: URL | undefined): URL {
  if (baseUrl !== undefined) {
    try {
      return new URL(raw, baseUrl);
    } catch {
      throw new Error(`Invalid request URL "${raw}".`);
    }
  }

  return parseHttpUrl(raw);
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (headers === undefined) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

function mergeHeaders(
  modelHeaders: Record<string, string> | undefined,
  configHeaders: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};

  if (modelHeaders !== undefined) {
    for (const [key, value] of Object.entries(modelHeaders)) {
      merged[key.toLowerCase()] = value;
    }
  }

  for (const [key, value] of Object.entries(configHeaders)) {
    merged[key] = value;
  }

  return merged;
}
