import { URL } from "node:url";

const PRIVATE_IPV4_REGEX = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
const PRIVATE_IPV6_REGEX = /^[fF][cCdD]/;
const LOCALHOST_REGEX = /^localhost$/i;

export function validateSourceUrl(
  urlStr: string,
  allowPrivate = false
): boolean {
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

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  if (allowPrivate) {
    return true;
  }

  // Reject localhost
  if (
    LOCALHOST_REGEX.test(hostname) ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1"
  ) {
    return false;
  }

  // Reject private IPs
  if (PRIVATE_IPV4_REGEX.test(hostname)) {
    return false;
  }

  if (PRIVATE_IPV6_REGEX.test(hostname)) {
    return false;
  }

  return true;
}
