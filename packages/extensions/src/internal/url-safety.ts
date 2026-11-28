import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { BlockList, isIP } from "node:net";

export type AddressResolver = (hostname: string) => Promise<readonly LookupAddress[]>;

export type UrlSafetyOptions = {
  allowedHosts?: readonly string[] | undefined;
  blockedHosts?: readonly string[] | undefined;
  allowedOrigins?: readonly string[] | undefined;
  allowPrivateAddresses?: boolean | undefined;
  resolveAddress?: AddressResolver | undefined;
};

export type SafeFetchOptions = UrlSafetyOptions & {
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  protectedHeaderNames?: readonly string[] | undefined;
  allowedMethods?: readonly string[] | undefined;
  body?: string | undefined;
  maxRedirects?: number | undefined;
  maxBytes?: number | undefined;
  timeoutMs?: number | undefined;
  abortSignal?: AbortSignal | undefined;
  fetch?: typeof globalThis.fetch | undefined;
};

export type SafeFetchResponse = {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyTruncated: boolean;
  byteLength: number;
};

export type ValidatedUrlResult = {
  url: URL;
  addresses: readonly LookupAddress[];
};

const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "cookie"]);
const BODY_HEADERS = new Set(["content-type", "content-length", "transfer-encoding"]);

const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

const defaultAddressResolver: AddressResolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export function parseHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: "${rawUrl}".`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Blocked URL protocol "${parsed.protocol}": only http: and https: are allowed.`,
    );
  }

  return parsed;
}

export function isPrivateIpAddress(address: string): boolean {
  const normalized = normalizeHost(address);
  const family = isIP(normalized);

  if (family === 4) {
    return blockedIpv4.check(normalized, "ipv4");
  }

  if (family === 6) {
    if (normalized === "::1" || normalized === "::") return true;

    return blockedIpv6.check(normalized, "ipv6");
  }

  return false;
}

export async function assertSafeUrl(
  rawUrl: string,
  options: UrlSafetyOptions = {},
): Promise<ValidatedUrlResult> {
  const parsed = parseHttpUrl(rawUrl);
  const hostname = normalizeHost(parsed.hostname);

  if (hostname.length === 0) {
    throw new Error("URL hostname must not be empty.");
  }

  if (options.allowedOrigins !== undefined) {
    const allowedOriginSet = new Set(options.allowedOrigins.map((origin) => origin.toLowerCase()));

    if (!allowedOriginSet.has(parsed.origin.toLowerCase())) {
      throw new Error(`Origin "${parsed.origin}" is not in the allowedOrigins policy.`);
    }
  }

  if (
    options.blockedHosts !== undefined &&
    matchesHostPatternList(hostname, options.blockedHosts)
  ) {
    throw new Error(`Host "${hostname}" is blocked by policy.`);
  }

  if (options.allowedHosts !== undefined) {
    if (!matchesHostPatternList(hostname, options.allowedHosts)) {
      throw new Error(`Host "${hostname}" is not in the allowedHosts policy.`);
    }
  }

  if (!options.allowPrivateAddresses) {
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      throw new Error(`Host "${hostname}" is blocked because private addresses are disallowed.`);
    }

    const literalFamily = isIP(hostname);

    if (literalFamily !== 0) {
      if (isPrivateIpAddress(hostname)) {
        throw new Error(
          `IP address "${hostname}" is blocked because private addresses are disallowed.`,
        );
      }

      return { url: parsed, addresses: [{ address: hostname, family: literalFamily }] };
    }

    const resolve = options.resolveAddress ?? defaultAddressResolver;
    const addresses = await resolve(hostname);

    if (addresses.length === 0) {
      throw new Error(`Could not resolve hostname "${hostname}".`);
    }

    for (const entry of addresses) {
      if (isPrivateIpAddress(entry.address)) {
        throw new Error(
          `Host "${hostname}" resolved to blocked private address "${entry.address}".`,
        );
      }
    }

    return { url: parsed, addresses };
  }

  return { url: parsed, addresses: [] };
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const timeoutMs = options.timeoutMs ?? 15_000;

  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new RangeError("maxRedirects must be a non-negative safe integer.");
  }

  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive safe integer.");
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number.");
  }

  const protectedHeaders = new Set<string>(SENSITIVE_HEADERS);
  for (const name of options.protectedHeaderNames ?? []) {
    protectedHeaders.add(name.toLowerCase());
  }

  const allowedMethodSet =
    options.allowedMethods === undefined
      ? undefined
      : new Set(options.allowedMethods.map((m) => m.toUpperCase()));

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`)),
    timeoutMs,
  );
  const signal =
    options.abortSignal === undefined
      ? controller.signal
      : AbortSignal.any([options.abortSignal, controller.signal]);

  try {
    let currentUrl = rawUrl;
    let method = (options.method ?? "GET").toUpperCase();
    let body = options.body;
    let currentHeaders = normalizeHeaderMap(options.headers);

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      if (allowedMethodSet !== undefined && !allowedMethodSet.has(method)) {
        throw new Error(`HTTP method "${method}" is not allowed.`);
      }

      const validated = await assertSafeUrl(currentUrl, options);
      const response =
        options.fetch !== undefined
          ? await executeWithCustomFetch(options.fetch, validated.url, {
              method,
              headers: currentHeaders,
              body,
              maxBytes,
              signal,
            })
          : await executeWithPinnedNodeRequest(validated.url, validated.addresses, {
              method,
              headers: currentHeaders,
              body,
              maxBytes,
              signal,
            });

      if (isRedirectStatus(response.status)) {
        const location = response.headers.location;

        if (location === undefined) {
          throw new Error(`Redirect response (${response.status}) missing Location header.`);
        }

        if (redirectCount === maxRedirects) {
          throw new Error(`Exceeded maximum redirect limit (${maxRedirects}).`);
        }

        const nextUrl = new URL(location, validated.url);
        const crossOrigin = nextUrl.origin.toLowerCase() !== validated.url.origin.toLowerCase();
        const protocolDowngrade =
          validated.url.protocol === "https:" && nextUrl.protocol === "http:";

        if (protocolDowngrade && hasAnyHeader(currentHeaders, protectedHeaders)) {
          throw new Error(
            "Blocked redirect that downgrades from https: to http: while sensitive headers are present.",
          );
        }

        if (crossOrigin) {
          currentHeaders = omitHeaders(currentHeaders, protectedHeaders);
        }

        currentUrl = nextUrl.toString();

        if (
          (response.status === 303 && method !== "GET" && method !== "HEAD") ||
          ((response.status === 301 || response.status === 302) && method === "POST")
        ) {
          method = "GET";
          body = undefined;
          currentHeaders = omitHeaders(currentHeaders, BODY_HEADERS);
        }

        continue;
      }

      return response;
    }

    throw new Error(`Exceeded maximum redirect limit (${maxRedirects}).`);
  } finally {
    clearTimeout(timer);
  }
}

async function executeWithCustomFetch(
  fetchImpl: typeof globalThis.fetch,
  url: URL,
  params: {
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
    maxBytes: number;
    signal: AbortSignal;
  },
): Promise<SafeFetchResponse> {
  const requestInit: RequestInit = {
    method: params.method,
    redirect: "manual",
    signal: params.signal,
  };

  if (Object.keys(params.headers).length > 0) {
    requestInit.headers = params.headers;
  }

  if (params.body !== undefined && params.method !== "GET" && params.method !== "HEAD") {
    requestInit.body = params.body;
  }

  const response = await fetchImpl(url.toString(), requestInit);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  if (isRedirectStatus(response.status)) {
    await response.body?.cancel().catch(() => {});
    return {
      url: url.toString(),
      status: response.status,
      statusText: response.statusText,
      headers,
      bodyText: "",
      bodyTruncated: false,
      byteLength: 0,
    };
  }

  const { text, truncated, byteLength } = await readResponseTextWithLimit(
    response,
    params.maxBytes,
  );
  return {
    url: url.toString(),
    status: response.status,
    statusText: response.statusText,
    headers,
    bodyText: text,
    bodyTruncated: truncated,
    byteLength,
  };
}

function executeWithPinnedNodeRequest(
  url: URL,
  pinnedAddresses: readonly LookupAddress[],
  params: {
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
    maxBytes: number;
    signal: AbortSignal;
  },
): Promise<SafeFetchResponse> {
  return new Promise<SafeFetchResponse>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const pinnedLookup: LookupFunction | undefined =
      pinnedAddresses.length > 0
        ? (_hostname, lookupOptions, callback) => {
            if (typeof lookupOptions === "object" && lookupOptions !== null && lookupOptions.all) {
              callback(
                null,
                pinnedAddresses.map((entry) => ({
                  address: entry.address,
                  family: entry.family,
                })),
              );
              return;
            }

            const first = pinnedAddresses[0]!;
            callback(null, first.address, first.family);
          }
        : undefined;

    const reqOptions: https.RequestOptions = {
      protocol: url.protocol,
      hostname: normalizeHost(url.hostname),
      port: url.port === "" ? undefined : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: params.method,
      headers: {
        host: url.host,
        ...params.headers,
      },
      signal: params.signal,
    };

    if (pinnedLookup !== undefined) {
      reqOptions.lookup = pinnedLookup;
    }

    if (url.protocol === "https:" && isIP(normalizeHost(url.hostname)) === 0) {
      reqOptions.servername = normalizeHost(url.hostname);
    }

    const req = transport.request(reqOptions, (res) => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;

        headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
      }

      const status = res.statusCode ?? 0;
      const statusText = res.statusMessage ?? "";

      if (isRedirectStatus(status)) {
        res.resume();
        resolve({
          url: url.toString(),
          status,
          statusText,
          headers,
          bodyText: "",
          bodyTruncated: false,
          byteLength: 0,
        });
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let truncated = false;
      let settled = false;

      const finish = () => {
        if (settled) return;

        settled = true;
        const combined = Buffer.concat(chunks, totalBytes);
        const decoder = new TextDecoder("utf-8", { fatal: false });
        resolve({
          url: url.toString(),
          status,
          statusText,
          headers,
          bodyText: decoder.decode(combined),
          bodyTruncated: truncated,
          byteLength: totalBytes,
        });
      };

      res.on("data", (chunk: Buffer | string) => {
        if (settled) return;

        const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;

        if (totalBytes + buf.byteLength > params.maxBytes) {
          const remaining = params.maxBytes - totalBytes;

          if (remaining > 0) {
            chunks.push(buf.subarray(0, remaining));
            totalBytes += remaining;
          }

          truncated = true;
          res.destroy();
          finish();
          return;
        }

        chunks.push(buf);
        totalBytes += buf.byteLength;
      });

      res.on("end", finish);
      res.on("close", finish);
      res.on("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });

    req.on("error", reject);

    if (params.body !== undefined && params.method !== "GET" && params.method !== "HEAD") {
      req.write(params.body);
    }

    req.end();
  });
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean; byteLength: number }> {
  if (response.body === null) {
    return { text: "", truncated: false, byteLength: 0 };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (value === undefined) continue;

      if (totalBytes + value.byteLength > maxBytes) {
        const remaining = maxBytes - totalBytes;

        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining));
          totalBytes += remaining;
        }

        truncated = true;
        await reader.cancel();
        break;
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  return {
    text: decoder.decode(combined),
    truncated,
    byteLength: totalBytes,
  };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function normalizeHost(hostname: string): string {
  const unbracketed =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return unbracketed.trim().toLowerCase().replace(/\.+$/, "");
}

function matchesHostPatternList(hostname: string, patterns: readonly string[]): boolean {
  for (const rawPattern of patterns) {
    const pattern = normalizeHost(rawPattern);

    if (pattern.length === 0) continue;

    if (pattern === hostname) return true;

    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);

      if (suffix.length > 1 && hostname.endsWith(suffix) && hostname.length > suffix.length) {
        return true;
      }
    }
  }
  return false;
}

function normalizeHeaderMap(headers: Record<string, string> | undefined): Record<string, string> {
  if (headers === undefined) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

function omitHeaders(
  headers: Record<string, string>,
  namesToOmit: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!namesToOmit.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

function hasAnyHeader(headers: Record<string, string>, names: ReadonlySet<string>): boolean {
  for (const key of Object.keys(headers)) {
    if (names.has(key.toLowerCase())) return true;
  }
  return false;
}
