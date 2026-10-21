import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { createSafeMcpFetch, parseAndValidateMcpUrl, parseMcpHttpUrl } from "./url-safety";

const privateAddresses = new BlockList();
privateAddresses.addSubnet("127.0.0.0", 8, "ipv4");
privateAddresses.addSubnet("10.0.0.0", 8, "ipv4");
privateAddresses.addSubnet("172.16.0.0", 12, "ipv4");
privateAddresses.addSubnet("192.168.0.0", 16, "ipv4");
privateAddresses.addAddress("::1", "ipv6");
privateAddresses.addSubnet("fc00::", 7, "ipv6");

/** A separate dispatcher prevents trusted sockets from being reused by strict requests. */
export function createTrustedEndpointFetch(endpoint: URL, addresses: readonly string[]) {
  parseMcpHttpUrl(endpoint);
  if (endpoint.username || endpoint.password || endpoint.hash || addresses.length === 0) {
    throw new TypeError("Invalid trusted MCP endpoint");
  }
  const pinned = addresses.map((address) => {
    const family = isIP(address);
    if (!family) throw new TypeError("Trusted MCP addresses must be IP literals");
    const url = new URL(`http://${family === 6 ? `[${address}]` : address}`);
    // Canonicalize IPv6 so alternate spellings cannot bypass the metadata exclusion.
    const normalized = url.hostname.replace(/^\[|\]$/g, "");
    if (normalized === "fd00:ec2::254" || normalized.startsWith("::ffff:")) {
      throw new TypeError("MCP metadata or mapped address blocked");
    }
    if (!privateAddresses.check(normalized, family === 6 ? "ipv6" : "ipv4")) {
      parseAndValidateMcpUrl(url);
    }
    return { address: normalized, family };
  });
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) && !pinned.some(({ address }) => address === hostname)) {
    throw new TypeError("MCP endpoint IP is not in trustedAddresses");
  }
  const lookup: LookupFunction = (host, options, callback) => {
    const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
    const matches = pinned.filter((entry) => !family || entry.family === family);
    if (host !== hostname || !matches.length) {
      callback(new Error("MCP endpoint does not match pinned addresses"), []);
    } else if (options.all) {
      callback(null, matches);
    } else {
      callback(null, matches[0]!.address, matches[0]!.family);
    }
  };
  const dispatcher = new Agent({ autoSelectFamily: true, connect: { lookup } });
  const strictFetch = createSafeMcpFetch();
  const fetch: ReturnType<typeof createSafeMcpFetch> = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href !== endpoint.href) return strictFetch(input, init);
    return undiciFetch(url, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
      redirect: "error",
    }) as unknown as ReturnType<typeof strictFetch>;
  };
  return { fetch, close: () => dispatcher.destroy() };
}
