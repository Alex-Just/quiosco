import { describe, expect, it } from "vitest";
import { isZenEndPage, zenEndActions } from "./zenEndActions";

describe("zenEndActions", () => {
  it("offers archive and delete for an article that is not archived", () => {
    expect(zenEndActions({ status: "unread" })).toEqual(["archive", "delete"]);
    expect(zenEndActions({ status: "read" })).toEqual(["archive", "delete"]);
  });

  it("drops archive once the article is archived", () => {
    expect(zenEndActions({ status: "archived" })).toEqual(["delete"]);
  });
});

describe("isZenEndPage", () => {
  it("is true on the first and last paragraph", () => {
    expect(isZenEndPage(0, 3)).toBe(true);
    expect(isZenEndPage(2, 3)).toBe(true);
  });

  it("is false in the middle of the article", () => {
    expect(isZenEndPage(1, 3)).toBe(false);
  });

  it("is true for a single-paragraph article", () => {
    expect(isZenEndPage(0, 1)).toBe(true);
  });

  it("is false when there are no paragraphs", () => {
    expect(isZenEndPage(0, 0)).toBe(false);
  });
});
