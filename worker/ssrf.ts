const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_BRACKET_RE = /^\[[0-9a-f:.]+\]$/i;

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function validateTargetUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port && url.port !== "80" && url.port !== "443")
    return { ok: false, reason: "port" };

  // Strip a trailing dot so FQDN forms ("localhost.", "foo.local.") cannot
  // bypass the denylist checks below.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: "blocked-host" };
  if (host.endsWith(".local")) return { ok: false, reason: "blocked-host" };

  // All IP-literal hosts are rejected outright. WHATWG URL canonicalizes the
  // hex/decimal/octal spellings first, so this covers http://2130706433/ and
  // IPv4-mapped IPv6 such as http://[::ffff:169.254.169.254]/.
  if (IPV4_RE.test(host) || IPV6_BRACKET_RE.test(host))
    return { ok: false, reason: "ip-literal" };

  return { ok: true, url };
}
