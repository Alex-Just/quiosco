import { describe, expect, it } from "vitest";
import { classifyShare, deriveTitle, firstUrl } from "./share";
import type { SharePayload } from "./types";

const payload = (partial: Partial<SharePayload>): SharePayload => ({
  title: "",
  text: "",
  url: "",
  receivedAt: 0,
  ...partial,
});

// No trailing whitespace: classifyShare trims before measuring, so longText(n)
// must still be exactly n chars after trim (the boundary test relies on this).
const longText = (n: number) => "palabra".repeat(Math.ceil(n / 7)).slice(0, n);

describe("firstUrl", () => {
  it("finds the first http(s) URL", () => {
    expect(firstUrl("hello https://example.com/a?b=1 world")).toBe(
      "https://example.com/a?b=1",
    );
  });
  it("returns null when there is none", () => {
    expect(firstUrl("no links here")).toBeNull();
  });
});

describe("classifyShare", () => {
  it("detects URL mode from the url param alone", () => {
    const result = classifyShare(payload({ url: "https://elpais.com/a.html" }));
    expect(result).toEqual({
      mode: "url",
      url: "https://elpais.com/a.html",
      title: "",
    });
  });

  it("detects URL mode when Chrome puts the URL in text", () => {
    const result = classifyShare(
      payload({ text: "https://elpais.com/a.html", title: "Un titular" }),
    );
    expect(result).toEqual({
      mode: "url",
      url: "https://elpais.com/a.html",
      title: "Un titular",
    });
  });

  it("detects URL mode when text is just the title", () => {
    const result = classifyShare(
      payload({
        url: "https://elpais.com/a.html",
        text: "Un titular",
        title: "Un titular",
      }),
    );
    expect(result.mode).toBe("url");
  });

  it("uses TEXT mode for long text with an attached URL", () => {
    const text = `${longText(500)} https://elpais.com/a.html`;
    const result = classifyShare(
      payload({ url: "https://elpais.com/a.html", text }),
    );
    expect(result.mode).toBe("text");
    if (result.mode === "text") {
      expect(result.url).toBe("https://elpais.com/a.html");
      expect(result.text).not.toContain("https://elpais.com/a.html");
      expect(result.text.length).toBeGreaterThanOrEqual(400);
    }
  });

  it("uses TEXT mode for long text without a URL", () => {
    const result = classifyShare(payload({ text: longText(450) }));
    expect(result.mode).toBe("text");
    if (result.mode === "text") expect(result.url).toBeNull();
  });

  it("treats exactly 400 chars as text and 399 as manual", () => {
    expect(classifyShare(payload({ text: longText(400) })).mode).toBe("text");
    expect(classifyShare(payload({ text: longText(399) })).mode).toBe("manual");
  });

  it("falls back to manual for short non-URL text", () => {
    const result = classifyShare(payload({ text: "mira esto", title: "t" }));
    expect(result).toEqual({
      mode: "manual",
      text: "mira esto",
      title: "t",
      url: null,
    });
  });

  it("falls back to manual when everything is empty", () => {
    expect(classifyShare(payload({})).mode).toBe("manual");
  });
});

describe("deriveTitle", () => {
  it("prefers the extracted title", () => {
    expect(
      deriveTitle({
        extractedTitle: "Extracted",
        sharedTitle: "Shared",
        text: "x",
        url: null,
      }),
    ).toBe("Extracted");
  });
  it("falls back to the shared title", () => {
    expect(
      deriveTitle({
        extractedTitle: null,
        sharedTitle: "Shared",
        text: "x",
        url: null,
      }),
    ).toBe("Shared");
  });
  it("falls back to the first non-empty line", () => {
    expect(
      deriveTitle({
        extractedTitle: null,
        sharedTitle: "",
        text: "\nFirst line\nrest",
        url: null,
      }),
    ).toBe("First line");
  });
  it("falls back to the hostname", () => {
    expect(
      deriveTitle({
        extractedTitle: null,
        sharedTitle: "",
        text: "",
        url: "https://elpais.com/a.html",
      }),
    ).toBe("elpais.com");
  });
  it("returns Untitled when nothing is available", () => {
    expect(
      deriveTitle({
        extractedTitle: null,
        sharedTitle: "",
        text: "",
        url: null,
      }),
    ).toBe("Untitled");
  });
});
