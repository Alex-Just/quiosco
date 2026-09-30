import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  it("strips fragments", () => {
    expect(normalizeUrl("https://elpais.com/a.html#section")).toBe(
      "https://elpais.com/a.html",
    );
  });

  it("strips utm and known tracking params but keeps meaningful ones", () => {
    expect(
      normalizeUrl(
        "https://elpais.com/a.html?utm_source=x&fbclid=y&ssm=z&emk=q&page=2",
      ),
    ).toBe("https://elpais.com/a.html?page=2");
  });

  it("maps ABC _amp variants onto the canonical URL", () => {
    expect(normalizeUrl("https://www.abc.es/espana/x-nt_amp.html")).toBe(
      "https://www.abc.es/espana/x-nt.html",
    );
  });

  it("removes ?amp", () => {
    expect(normalizeUrl("https://www.lavanguardia.com/a.html?amp")).toBe(
      "https://www.lavanguardia.com/a.html",
    );
  });

  it("rejects non-http(s) and invalid URLs", () => {
    expect(normalizeUrl("ftp://example.com")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});
