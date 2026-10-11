const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_BRACKET_RE = /^\[[0-9a-f:.]+\]$/i;

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

type UrlFailure = Extract<UrlCheck, { ok: false }>;

export function validateTargetUrl(raw: string): UrlCheck {
  const url = parseHttpUrl(raw);
  if (!url) return { ok: false, reason: "invalid-url" };
  const failure =
    schemeFailure(url) ??
    credentialsFailure(url) ??
    portFailure(url) ??
    hostFailure(url);
  if (failure) return failure;
  return { ok: true, url };
}

function parseHttpUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function schemeFailure(url: URL): UrlFailure | null {
  if (url.protocol === "http:" || url.protocol === "https:") return null;
  return { ok: false, reason: "scheme" };
}

function credentialsFailure(url: URL): UrlFailure | null {
  if (!url.username && !url.password) return null;
  return { ok: false, reason: "credentials" };
}

function portFailure(url: URL): UrlFailure | null {
  if (!url.port || url.port === "80" || url.port === "443") return null;
  return { ok: false, reason: "port" };
}

function hostFailure(url: URL): UrlFailure | null {
  // Strip a trailing dot so FQDN forms ("localhost.", "foo.local.") cannot
  // bypass the denylist checks below.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local")) {
    return { ok: false, reason: "blocked-host" };
  }
  // All IP-literal hosts are rejected outright. WHATWG URL canonicalizes the
  // hex/decimal/octal spellings first, so this covers http://2130706433/ and
  // IPv4-mapped IPv6 such as http://[::ffff:169.254.169.254]/.
  if (IPV4_RE.test(host) || IPV6_BRACKET_RE.test(host)) {
    return { ok: false, reason: "ip-literal" };
  }
  return null;
}
