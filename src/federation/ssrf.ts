import dns from "node:dns";
import net from "node:net";
import { URL } from "node:url";

// Standard private IPv4 ranges
const PRIVATE_IPV4_REGEX = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
// CGNAT (100.64.x.x – 100.127.x.x)
const CGNAT_IPV4_REGEX = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
// IPv6 unique local address (fc00::/7)
const PRIVATE_IPV6_REGEX = /^[fF][cCdD]/;
// IPv6 link-local (fe80::/10)
const LINK_LOCAL_IPV6_REGEX = /^fe[89ab][0-9a-f]/i;
// IPv4-mapped IPv6 (::ffff:0:0/96)
const IPV4_MAPPED_IPV6_REGEX = /^::ffff:/i;
const IPV4_MAPPED_PREFIX_RE = /^::ffff:/i;

const LOCALHOST_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "local",
  "broadcasthost",
  "loopback",
]);

/**
 * Parse an IPv4-mapped IPv6 address (::ffff:x.x.x.x or ::ffff:hex format)
 * and return the embedded IPv4 address, or null if not an IPv4-mapped address.
 */
function extractMappedIpv4(ip: string): string | null {
  const afterPrefix = ip.replace(IPV4_MAPPED_PREFIX_RE, "");
  if (afterPrefix === ip) {
    return null; // Not an IPv4-mapped address
  }
  // If the remaining part IS an IPv4 address, return it
  if (net.isIPv4(afterPrefix)) {
    return afterPrefix;
  }
  // Otherwise it might be hex format like 7f00:1 → 127.0.0.1
  // Parse as IPv6 to get the canonical representation
  if (net.isIPv6(`::ffff:${afterPrefix}`)) {
    // We know it's in the ::ffff:0:0/96 range
    // Parse the hex groups to reconstruct the IPv4
    const parts = afterPrefix.split(":");
    if (parts.length === 2) {
      const high = Number.parseInt(parts[0] ?? "", 16);
      const low = Number.parseInt(parts[1] ?? "", 16);
      if (!(Number.isNaN(high) || Number.isNaN(low))) {
        // biome-ignore lint/suspicious/noBitwiseOperators: IPv4 hex reconstruction
        return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
      }
    }
  }
  return null;
}

function isPrivateIp(hostname: string): boolean {
  const stripped = hostname.replace(/^\[|\]$/g, "");

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 — check the embedded IPv4
  if (IPV4_MAPPED_IPV6_REGEX.test(stripped)) {
    const ipv4Part = extractMappedIpv4(stripped);
    if (ipv4Part) {
      return isPrivateIpv4(ipv4Part);
    }
    // If we can't parse the embedded IPv4, be safe and reject
    return true;
  }

  // Pure IPv6
  if (stripped.includes(":")) {
    return (
      PRIVATE_IPV6_REGEX.test(stripped) ||
      LINK_LOCAL_IPV6_REGEX.test(stripped) ||
      stripped === "::1" ||
      stripped === "::" ||
      stripped === "0:0:0:0:0:0:0:1" ||
      stripped === "0:0:0:0:0:0:0:0"
    );
  }

  // IPv4
  return isPrivateIpv4(stripped);
}

function isPrivateIpv4(ip: string): boolean {
  return (
    PRIVATE_IPV4_REGEX.test(ip) ||
    ip.startsWith("169.254.") ||
    CGNAT_IPV4_REGEX.test(ip) ||
    ip.startsWith("0.") ||
    ip === "0.0.0.0" ||
    ip === "127.0.0.1" ||
    ip === "255.255.255.255"
  );
}

function isLocalhostName(hostname: string): boolean {
  return LOCALHOST_NAMES.has(hostname.toLowerCase());
}

function resolveHostname(hostname: string): Promise<string[]> {
  return new Promise((resolve) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        // If DNS resolution fails, reject the URL
        resolve([]);
        return;
      }
      const ips = (addresses as dns.LookupAddress[]).map((a) => a.address);
      resolve(ips);
    });
  });
}

export async function validateSourceUrl(
  urlStr: string,
  allowPrivate = false
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }

  // Only HTTP(S) schemes allowed
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  if (allowPrivate) {
    return true;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // Check hostname against known localhost names
  if (isLocalhostName(hostname)) {
    return false;
  }

  // Check literal IP addresses (no DNS resolution needed)
  if (isPrivateIp(hostname)) {
    return false;
  }

  // Resolve the hostname to IP addresses to catch DNS rebinding
  // and hostnames that resolve to private IPs (e.g., localtest.me → 127.0.0.1)
  const ips = await resolveHostname(hostname);
  if (ips.length === 0) {
    // DNS resolution failed or returned no records — reject
    return false;
  }
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      return false;
    }
  }

  return true;
}
