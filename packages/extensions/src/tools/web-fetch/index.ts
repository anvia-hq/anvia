import { createTool, createToolkit, type Toolkit, type ToolkitOptions } from "@anvia/core/tool";
import { z } from "zod";
import { truncateText } from "../../internal/truncate";
import { safeFetch, type UrlSafetyOptions } from "../../internal/url-safety";
import { extractHtmlTitle, htmlToReadableText } from "./html-to-text";

export type WebFetchToolName = "web_fetch";

export type WebFetchOptions = ToolkitOptions<WebFetchToolName> &
  UrlSafetyOptions & {
    /** Maximum response bytes read from the network. Default 1_000_000 (1 MB). */
    maxBytes?: number | undefined;
    /** Maximum characters returned to the model. Default 16_000. */
    maxChars?: number | undefined;
    /** Maximum HTTP redirects followed. Default 5. */
    maxRedirects?: number | undefined;
    /** Custom User-Agent header. */
    userAgent?: string | undefined;
    /** Additional request headers sent on every fetch. */
    headers?: Record<string, string> | undefined;
    /** Custom fetch implementation (useful for testing). */
    fetch?: typeof globalThis.fetch | undefined;
  };

const DEFAULT_USER_AGENT = "anvia-web-fetch/0.1";
const DEFAULT_INSTRUCTIONS =
  "Use web_fetch to read the content of a specific http(s) URL. Prefer targeted pages rather than fetching many URLs at once.";

export function webFetch(options: WebFetchOptions = {}): Toolkit {
  const maxBytes = options.maxBytes ?? 1_000_000;
  const maxChars = options.maxChars ?? 16_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 15_000;

  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("webFetch maxBytes must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) {
    throw new RangeError("webFetch maxChars must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new RangeError("webFetch maxRedirects must be a non-negative safe integer.");
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("webFetch timeoutMs must be a positive finite number.");
  }

  const normalizedCustomHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    normalizedCustomHeaders[key.toLowerCase()] = value;
  }

  const requestHeaders: Record<string, string> = {
    accept: "text/html, text/plain, application/json, text/markdown;q=0.9, */*;q=0.1",
    "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
    ...normalizedCustomHeaders,
  };
  const protectedHeaderNames = Object.keys(normalizedCustomHeaders);

  const fetchTool = createTool({
    name: "web_fetch",
    description: "Fetch a web page or text document over HTTP(S) and return its readable content.",
    inputSchema: z.object({
      url: z.string().min(1).describe("The http:// or https:// URL to fetch."),
      format: z
        .enum(["text", "raw"])
        .optional()
        .describe('Return cleaned readable text (default "text") or raw response body ("raw").'),
    }),
    handler: async (args, context) => {
      const response = await safeFetch(args.url, {
        method: "GET",
        headers: requestHeaders,
        protectedHeaderNames,
        allowedHosts: options.allowedHosts,
        allowedOrigins: options.allowedOrigins,
        blockedHosts: options.blockedHosts,
        allowPrivateAddresses: options.allowPrivateAddresses,
        resolveAddress: options.resolveAddress,
        maxBytes,
        maxRedirects,
        timeoutMs,
        abortSignal: context.abortSignal,
        fetch: options.fetch,
      });

      const contentType = response.headers["content-type"] ?? "";
      const lowerContentType = contentType.toLowerCase();
      const isHtml =
        lowerContentType.includes("text/html") ||
        lowerContentType.includes("application/xhtml+xml") ||
        /^\s*<(?:!doctype|html)\b/i.test(response.bodyText);

      const title = isHtml ? extractHtmlTitle(response.bodyText) : undefined;
      const body =
        args.format === "raw" || !isHtml
          ? response.bodyText
          : htmlToReadableText(response.bodyText);
      const { text, truncated } = truncateText(body, maxChars);

      const payload: Record<string, unknown> = {
        url: response.url,
        status: response.status,
        contentType,
        content: text,
        truncated: truncated || response.bodyTruncated,
      };

      if (title !== undefined) payload.title = title;

      return payload;
    },
  });

  return createToolkit<WebFetchToolName>(
    {
      name: "web-fetch",
      tools: [fetchTool],
      instructions: DEFAULT_INSTRUCTIONS,
    },
    options,
  );
}
