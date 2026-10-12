import { describe, expect, it } from "vitest";
import { isZenProgressSegmentActive, zenProgressLabel } from "./zenProgress";

describe("zenProgressLabel", () => {
  it("shows the 1-based page over the total", () => {
    expect(zenProgressLabel(0, 3)).toBe("1/3");
    expect(zenProgressLabel(2, 3)).toBe("3/3");
  });

  it("is empty when there are no paragraphs", () => {
    expect(zenProgressLabel(0, 0)).toBe("");
  });
});

describe("isZenProgressSegmentActive", () => {
  it("marks every segment up to the current page", () => {
    expect(isZenProgressSegmentActive(0, 0)).toBe(true);
    expect(isZenProgressSegmentActive(1, 0)).toBe(false);
    expect(isZenProgressSegmentActive(1, 1)).toBe(true);
    expect(isZenProgressSegmentActive(2, 1)).toBe(false);
  });
});
