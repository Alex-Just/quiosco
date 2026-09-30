import { describe, expect, it } from "vitest";
import { applySecurityHeaders, CSP, jsonResponse } from "./headers";

describe("applySecurityHeaders", () => {
  it("adds the security header set", () => {
    const response = applySecurityHeaders(new Response("hi"));
    expect(response.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Strict-Transport-Security")).toContain(
      "max-age=",
    );
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(response.headers.get("Cache-Control")).toBeNull();
  });

  it("sets no-store when asked and preserves the status", async () => {
    const response = applySecurityHeaders(jsonResponse({ error: "x" }, 404), {
      noStore: true,
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "x" });
  });

  it("never emits CORS headers", () => {
    const response = applySecurityHeaders(new Response("hi"));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
