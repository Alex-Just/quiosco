import { describe, expect, it } from "vitest";
import { extractBearer, originAllowed, tokensMatch } from "./auth";

describe("extractBearer", () => {
  it("parses a bearer token", () => {
    const request = new Request("https://app.example/api/health", {
      headers: { Authorization: "Bearer abc123" },
    });
    expect(extractBearer(request)).toBe("abc123");
  });

  it("returns null for missing or malformed headers", () => {
    expect(
      extractBearer(new Request("https://app.example/api/health")),
    ).toBeNull();
    expect(
      extractBearer(
        new Request("https://app.example/api/health", {
          headers: { Authorization: "Basic x" },
        }),
      ),
    ).toBeNull();
    expect(
      extractBearer(
        new Request("https://app.example/api/health", {
          headers: { Authorization: "Bearer " },
        }),
      ),
    ).toBeNull();
  });
});

describe("tokensMatch", () => {
  it("accepts the exact token and rejects everything else", async () => {
    await expect(tokensMatch("secret", "secret")).resolves.toBe(true);
    await expect(tokensMatch("secret", "other")).resolves.toBe(false);
    await expect(tokensMatch("secret", "")).resolves.toBe(false);
  });
});

describe("originAllowed", () => {
  const request = (origin?: string) =>
    new Request(
      "https://app.example/api/health",
      origin ? { headers: { Origin: origin } } : undefined,
    );

  it("allows missing or same-origin headers", () => {
    expect(originAllowed(request())).toBe(true);
    expect(originAllowed(request("https://app.example"))).toBe(true);
  });

  it("rejects cross-origin origins", () => {
    expect(originAllowed(request("https://evil.example"))).toBe(false);
    expect(originAllowed(request("null"))).toBe(false);
  });
});
