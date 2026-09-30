import { describe, expect, it } from "vitest";
import { validateTargetUrl } from "./ssrf";

describe("validateTargetUrl", () => {
  it("accepts normal public http(s) URLs", () => {
    const result = validateTargetUrl("https://elpais.com/a.html?x=1");
    expect(result.ok).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateTargetUrl("ftp://example.com")).toMatchObject({
      ok: false,
      reason: "scheme",
    });
    expect(validateTargetUrl("javascript:alert(1)")).toMatchObject({
      ok: false,
      reason: "scheme",
    });
  });

  it("rejects embedded credentials", () => {
    expect(validateTargetUrl("https://user:pass@example.com/")).toMatchObject({
      ok: false,
      reason: "credentials",
    });
  });

  it("rejects non-standard ports", () => {
    expect(validateTargetUrl("https://example.com:8443/")).toMatchObject({
      ok: false,
      reason: "port",
    });
    expect(validateTargetUrl("http://example.com:80/")).toMatchObject({
      ok: true,
    });
    expect(validateTargetUrl("https://example.com:443/")).toMatchObject({
      ok: true,
    });
  });

  it("rejects every IP-literal host, including canonicalized spellings", () => {
    expect(validateTargetUrl("http://127.0.0.1/")).toMatchObject({
      ok: false,
      reason: "ip-literal",
    });
    expect(validateTargetUrl("http://2130706433/")).toMatchObject({
      ok: false,
      reason: "ip-literal",
    });
    expect(validateTargetUrl("http://[::ffff:169.254.169.254]/")).toMatchObject(
      {
        ok: false,
        reason: "ip-literal",
      },
    );
    expect(validateTargetUrl("http://[::1]/")).toMatchObject({
      ok: false,
      reason: "ip-literal",
    });
    expect(validateTargetUrl("http://100.100.100.200/")).toMatchObject({
      ok: false,
      reason: "ip-literal",
    });
  });

  it("rejects blocked hostnames", () => {
    expect(validateTargetUrl("http://localhost/")).toMatchObject({
      ok: false,
      reason: "blocked-host",
    });
    expect(validateTargetUrl("http://foo.local/")).toMatchObject({
      ok: false,
      reason: "blocked-host",
    });
    expect(validateTargetUrl("http://metadata.google.internal/")).toMatchObject(
      {
        ok: false,
        reason: "blocked-host",
      },
    );
  });

  it("rejects trailing-dot FQDN forms of blocked hostnames", () => {
    expect(validateTargetUrl("http://localhost./")).toMatchObject({
      ok: false,
      reason: "blocked-host",
    });
    expect(validateTargetUrl("http://foo.local./")).toMatchObject({
      ok: false,
      reason: "blocked-host",
    });
    expect(
      validateTargetUrl("http://metadata.google.internal./"),
    ).toMatchObject({
      ok: false,
      reason: "blocked-host",
    });
  });

  it("rejects invalid URLs", () => {
    expect(validateTargetUrl("not a url")).toMatchObject({
      ok: false,
      reason: "invalid-url",
    });
  });
});
