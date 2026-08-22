import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { BlockList, isIP } from "node:net";
import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Agent, Pool, fetch as undiciFetch } from "undici";

type FetchLike = NonNullable<StreamableHTTPClientTransportOptions["fetch"]>;

export type McpAddressResolver = (hostname: string) => Promise<LookupAddress[]>;

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

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
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
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
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

const defaultAddressResolver: McpAddressResolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export function parseAndValidateMcpUrl(url: string | URL): URL {
  const parsed = parseMcpHttpUrl(url);
  validateMcpHostname(parsed.hostname);
  return parsed;
}

export function parseMcpHttpUrl(url: string | URL): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid MCP URL: ${url}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`MCP URL blocked: only HTTP(S) URLs are allowed (${parsed.protocol})`);
  }

  return parsed;
}

export async function resolveAndValidateMcpHostname(
  hostname: string,
  resolveAddresses: McpAddressResolver = defaultAddressResolver,
): Promise<LookupAddress[]> {
  const normalizedHostname = normalizeHostname(hostname);
  validateMcpHostname(normalizedHostname);

  const family = isIP(normalizedHostname);
  if (family !== 0) {
    return [{ address: normalizedHostname, family }];
  }

  let addresses: LookupAddress[];
  try {
    addresses = await resolveAddresses(normalizedHostname);
  } catch (cause) {
    throw new Error(`Unable to resolve MCP URL hostname (${normalizedHostname})`, { cause });
  }

  if (addresses.length === 0) {
    throw new Error(`Unable to resolve MCP URL hostname (${normalizedHostname})`);
  }

  for (const { address } of addresses) {
    validateMcpHostname(address);
  }

  return addresses;
}

export function createSafeMcpLookup(
  resolveAddresses: McpAddressResolver = defaultAddressResolver,
): LookupFunction {
  return (hostname, options, callback) => {
    void resolveAndValidateMcpHostname(hostname, resolveAddresses).then(
      (addresses) => {
        const requestedFamily = normalizeRequestedFamily(options.family);
        const matchingAddresses =
          requestedFamily === 0
            ? addresses
            : addresses.filter(({ family }) => family === requestedFamily);

        if (matchingAddresses.length === 0) {
          const error = new Error(`No matching address family for MCP URL (${hostname})`);
          Object.assign(error, { code: "EAI_ADDRFAMILY" });
          callback(error, []);
          return;
        }

        if (options.all) {
          callback(null, matchingAddresses);
          return;
        }

        const address = matchingAddresses[0];
        if (!address) {
          callback(new Error(`Unable to resolve MCP URL hostname (${hostname})`), []);
          return;
        }
        callback(null, address.address, address.family);
      },
      (cause: unknown) => {
        callback(asError(cause), []);
      },
    );
  };
}

export function createSafeMcpFetch(): FetchLike {
  return (url, init) => {
    parseAndValidateMcpUrl(url);
    return undiciFetch(url as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: safeMcpDispatcher,
    }) as unknown as ReturnType<FetchLike>;
  };
}

function validateMcpHostname(hostname: string): void {
  const normalizedHostname = normalizeHostname(hostname);

  if (normalizedHostname === "localhost" || normalizedHostname.endsWith(".localhost")) {
    throw new Error(`MCP URL blocked: localhost not allowed (${normalizedHostname})`);
  }

  const family = isIP(normalizedHostname);
  if (family === 0) {
    return;
  }

  if (
    (family === 4 && normalizedHostname.startsWith("127.")) ||
    (family === 6 && normalizedHostname === "::1")
  ) {
    throw new Error(`MCP URL blocked: localhost not allowed (${normalizedHostname})`);
  }

  if (normalizedHostname === "169.254.169.254" || normalizedHostname === "fd00:ec2::254") {
    throw new Error(`MCP URL blocked: cloud metadata endpoint not allowed (${normalizedHostname})`);
  }

  if (
    (family === 4 && blockedIpv4Addresses.check(normalizedHostname, "ipv4")) ||
    (family === 6 && blockedIpv6Addresses.check(normalizedHostname, "ipv6"))
  ) {
    const range = family === 4 ? "IP" : "IPv6";
    throw new Error(`MCP URL blocked: private ${range} range not allowed (${normalizedHostname})`);
  }
}

function normalizeHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return withoutBrackets.toLowerCase().replace(/\.+$/, "");
}

function normalizeRequestedFamily(family: number | string | undefined): 0 | 4 | 6 {
  if (family === 4 || family === "IPv4") {
    return 4;
  }
  if (family === 6 || family === "IPv6") {
    return 6;
  }
  return 0;
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

const safeMcpDispatcher = new Agent({
  autoSelectFamily: true,
  connect: {
    lookup: createSafeMcpLookup(),
  },
  factory(origin, options) {
    parseAndValidateMcpUrl(origin);
    return new Pool(origin, options as Pool.Options);
  },
});
