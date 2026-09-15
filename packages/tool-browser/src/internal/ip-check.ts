/**
 * Shared SSRF guard: classify a hostname as private, reserved, or public.
 *
 * Used by both the tool-level navigation check (tools.ts) and the worker-level
 * route enforcement (automation-worker.ts) so redirects and sub-navigations are
 * subject to the same blocking logic.
 */

export function isPrivateOrReservedHost(hostname: string): boolean {
  // Normalize: strip brackets for IPv6
  const host =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  // Block localhost and variations
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  // Try to parse as IPv4
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map(Number);

    // Validate octets are in range 0-255
    if (octets.some((octet) => octet > 255)) {
      return true; // Invalid IP, block it
    }

    const a = octets[0];
    const b = octets[1];
    const c = octets[2];
    const d = octets[3];

    // Guard: ensure all octets are defined
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      return true;
    }

    return isBlockedIpv4(a, b, c, d);
  }

  // Try to parse as IPv6
  const ipv6 = expandIpv6(host);
  if (ipv6 !== null) {
    return isBlockedIpv6(ipv6);
  }

  return false;
}

function isBlockedIpv4(a: number, b: number, c: number, _d: number): boolean {
  // 0.0.0.0/8 - Current network (only valid as source address)
  if (a === 0) return true;

  // 10.0.0.0/8 - Private network
  if (a === 10) return true;

  // 100.64.0.0/10 - Carrier-grade NAT (shared address space)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 127.0.0.0/8 - Loopback
  if (a === 127) return true;

  // 169.254.0.0/16 - Link-local (includes AWS metadata at 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 - Private network
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.2.0/24 - Documentation/test-net-1
  if (a === 192 && b === 0 && c === 2) return true;

  // 192.88.99.0/24 - 6to4 relay anycast
  if (a === 192 && b === 88 && c === 99) return true;

  // 192.168.0.0/16 - Private network
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 - Benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24 - Documentation/test-net-2
  if (a === 198 && b === 51 && c === 100) return true;

  // 203.0.113.0/24 - Documentation/test-net-3
  if (a === 203 && b === 0 && c === 113) return true;

  // 224.0.0.0/4 - Multicast
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 - Reserved
  if (a >= 240) return true;

  return false;
}

/**
 * Expand an IPv6 address to 8 groups of 4 hex digits (32 hex chars total).
 * Returns null if the input is not a valid IPv6 address.
 */
function expandIpv6(addr: string): string | null {
  // Handle IPv4-mapped IPv6: ::ffff:x.x.x.x
  const v4MappedMatch = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (v4MappedMatch?.[1] !== undefined) {
    const parts = v4MappedMatch[1].split(".").map(Number);
    if (parts.length === 4 && parts.every((p) => p >= 0 && p <= 255)) {
      // Return as blocked IPv4 address check
      return `__v4:${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}`;
    }
  }

  // Handle :: (compressed) notation
  if (addr === "::") return "00000000000000000000000000000000";

  let parts: string[];
  if (addr.includes("::")) {
    // Split on :: to get prefix and suffix
    const [prefix, suffix] = addr.split("::");
    const prefixParts = prefix ? prefix.split(":") : [];
    const suffixParts = suffix ? suffix.split(":") : [];
    const missing = 8 - prefixParts.length - suffixParts.length;
    parts = [...prefixParts, ...Array(missing).fill("0000"), ...suffixParts];
  } else {
    parts = addr.split(":");
  }

  if (parts.length !== 8) return null;

  // Validate and pad each group
  const expanded = parts.map((p) => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(p)) return null;
    return p.padStart(4, "0");
  });

  if (expanded.includes(null)) return null;
  return expanded.join("");
}

function isBlockedIpv6(expanded: string): boolean {
  // Handle IPv4-mapped detection marker (from dot notation)
  if (expanded.startsWith("__v4:")) {
    const v4Parts = expanded.slice(5).split(".").map(Number);
    const [a, b, c, d] = v4Parts;
    if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
      return isBlockedIpv4(a, b, c, d);
    }
    return true;
  }

  // expanded is 32 hex chars representing 8 groups of 4
  const g0 = parseInt(expanded.slice(0, 4), 16);

  // ::1 - Loopback
  if (expanded === "00000000000000000000000000000001") return true;

  // fe80::/10 - Link-local (g0 in range 0xFE80..0xFEBF)
  if (g0 >= 0xfe80 && g0 <= 0xfebf) return true;

  // fec0::/10 - Site-local (deprecated, g0 in range 0xFEC0..0xFEFF)
  if (g0 >= 0xfec0 && g0 <= 0xfeff) return true;

  // fc00::/7 - Unique local (g0 in range 0xFC00..0xFDFF)
  if (g0 >= 0xfc00 && g0 <= 0xfdff) return true;

  // Multicast ff00::/8
  if (g0 >= 0xff00) return true;

  // Unspecified ::
  if (expanded === "00000000000000000000000000000000") return true;

  // IPv4-mapped: first 80 bits zeros + ffff, then 32-bit IPv4 embedded
  // 00000000000000000000ffffxxxxxxxx
  if (
    expanded.startsWith("00000000000000000000ffff") ||
    expanded.startsWith("00000000000000000000FFFF")
  ) {
    const v4Hex = expanded.slice(24);
    const a = parseInt(v4Hex.slice(0, 2), 16);
    const b = parseInt(v4Hex.slice(2, 4), 16);
    const c = parseInt(v4Hex.slice(4, 6), 16);
    const d = parseInt(v4Hex.slice(6, 8), 16);
    return isBlockedIpv4(a, b, c, d);
  }

  return false;
}
