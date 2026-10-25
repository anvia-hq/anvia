/**
 * Shared SSRF guard for Grok provider tool URLs: classify a hostname as private,
 * reserved, or public.
 *
 * Called from the MCP serverUrl validation in ./tools.ts before the URL is handed
 * to the provider, so tool configurations cannot point at loopback, private, or
 * link-local destinations (including cloud metadata addresses).
 *
 * Blocked ranges follow the IANA IPv4/IPv6 special-purpose address registries
 * (this list originally mirrored @anvia/browser's ip-check, a package that has
 * since been removed); addresses that IANA marks
 * globally reachable inside otherwise special-purpose space stay reachable.
 *
 * IPv4 spellings are normalized by the WHATWG URL parser before this guard runs
 * (`127.1`, `2130706433`, `0x7f.0.0.1`, and `0177.0.0.1` all arrive as `127.0.0.1`),
 * and hosts that are not valid literals are left to DNS.
 */

type AddressRange = readonly [network: string, prefix: number];

/** Non-global IPv4 ranges plus transition mechanisms that can encode another address. */
const BLOCKED_IPV4: readonly AddressRange[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private network
  ["100.64.0.0", 10], // shared address space (carrier-grade NAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes cloud metadata at 169.254.169.254
  ["172.16.0.0", 12], // private network
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.88.99.0", 24], // 6to4 relay anycast (deprecated)
  ["192.168.0.0", 16], // private network
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255
];

/** Non-global IPv6 ranges plus transition mechanisms that can encode another address. */
const BLOCKED_IPV6: readonly AddressRange[] = [
  ["::", 96], // unspecified, loopback, and deprecated IPv4-compatible addresses
  ["::ffff:0:0", 96], // IPv4-mapped (alternate spelling of an IPv4 destination)
  ["64:ff9b:1::", 48], // NAT64 local-use prefix
  ["100::", 64], // discard-only
  ["100:0:0:1::", 64], // dummy IPv6 prefix
  ["2001::", 32], // Teredo
  ["2001:2::", 48], // benchmarking
  ["2001:10::", 28], // ORCHID (deprecated)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["3fff::", 20], // documentation
  ["5f00::", 16], // segment routing SIDs
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
];

/** IANA marks these two /32s globally reachable although 192.0.0.0/24 is not. */
const GLOBALLY_REACHABLE_IPV4: ReadonlySet<number> = new Set([0xc0000009, 0xc000000a]);

const BLOCKED_IPV4_RANGES = compileIpv4Ranges(BLOCKED_IPV4);
const BLOCKED_IPV6_RANGES = compileIpv6Ranges(BLOCKED_IPV6);

export function isPrivateOrReservedHost(hostname: string): boolean {
  const host = stripBrackets(hostname).toLowerCase().replace(/\.+$/, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;

  const ipv4 = parseIpv4(host);
  if (ipv4 !== null) return isBlockedIpv4(ipv4);

  const ipv6 = parseIpv6(host);
  if (ipv6 !== null) return isBlockedIpv6(ipv6);

  return false;
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isBlockedIpv4(value: number): boolean {
  if (GLOBALLY_REACHABLE_IPV4.has(value)) return false;
  for (const [network, prefix] of BLOCKED_IPV4_RANGES) {
    if (isInIpv4Range(value, network, prefix)) return true;
  }
  return false;
}

function isBlockedIpv6(value: bigint): boolean {
  for (const [network, prefix] of BLOCKED_IPV6_RANGES) {
    if (isInIpv6Range(value, network, prefix)) return true;
  }
  return false;
}

function isInIpv4Range(value: number, network: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const shift = 32 - prefix;
  return value >>> shift === network >>> shift;
}

function isInIpv6Range(value: bigint, network: bigint, prefix: number): boolean {
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return value >> shift === network >> shift;
}

/** Parse a dotted quad into its unsigned 32-bit value, or null when it is not one. */
function parseIpv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result;
}

/** Parse an IPv6 address (with optional embedded IPv4) into its 128-bit value. */
function parseIpv6(value: string): bigint | null {
  // Zone identifiers (`fe80::1%eth0`) are invalid inside URLs; strip the zone so a
  // caller passing one directly still gets the address classified.
  const zone = value.indexOf("%");
  const address = zone === -1 ? value : value.slice(0, zone);

  let text = address;
  const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (embedded !== null) {
    const ipv4 = parseIpv4(embedded[1] ?? "");
    if (ipv4 === null) return null;
    const groups = `${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
    text = `${address.slice(0, embedded.index)}${groups}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const groups = text.split(":");
    return groups.length === 8 ? foldHexGroups(groups) : null;
  }

  const [head = "", tail = ""] = halves;
  const leading = head === "" ? [] : head.split(":");
  const trailing = tail === "" ? [] : tail.split(":");
  const missing = 8 - leading.length - trailing.length;
  if (missing < 1) return null;
  const foldedHead = foldHexGroups(leading);
  const foldedTail = foldHexGroups(trailing);
  if (foldedHead === null || foldedTail === null) return null;
  return (foldedHead << BigInt(16 * (missing + trailing.length))) | foldedTail;
}

function foldHexGroups(groups: readonly string[]): bigint | null {
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function compileIpv4Ranges(
  ranges: readonly AddressRange[],
): ReadonlyArray<readonly [number, number]> {
  return ranges.map(([network, prefix]) => {
    const value = parseIpv4(network);
    if (value === null) throw new TypeError(`Invalid IPv4 range: ${network}/${prefix}`);
    return [value, prefix] as const;
  });
}

function compileIpv6Ranges(
  ranges: readonly AddressRange[],
): ReadonlyArray<readonly [bigint, number]> {
  return ranges.map(([network, prefix]) => {
    const value = parseIpv6(network);
    if (value === null) throw new TypeError(`Invalid IPv6 range: ${network}/${prefix}`);
    return [value, prefix] as const;
  });
}
