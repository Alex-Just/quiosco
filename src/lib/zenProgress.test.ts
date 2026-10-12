import { describe, expect, it } from "vitest";
import {
  zenProgressLabel,
  zenProgressPercent,
  zenProgressRatio,
} from "./zenProgress";

describe("zenProgressLabel", () => {
  it("shows the 1-based page over the total", () => {
    expect(zenProgressLabel(0, 3)).toBe("1/3");
    expect(zenProgressLabel(2, 3)).toBe("3/3");
  });

  it("is empty when there are no paragraphs", () => {
    expect(zenProgressLabel(0, 0)).toBe("");
  });
});

describe("zenProgressRatio", () => {
  it("is zero when there are no paragraphs", () => {
    expect(zenProgressRatio(0, 0)).toBe(0);
  });

  it("grows as a solid fill with the current paragraph", () => {
    expect(zenProgressRatio(0, 3)).toBeCloseTo(1 / 3);
    expect(zenProgressRatio(2, 3)).toBe(1);
  });
});

describe("zenProgressPercent", () => {
  it("returns a CSS width percent for the solid fill", () => {
    expect(zenProgressPercent(0, 4)).toBe("25%");
    expect(zenProgressPercent(3, 4)).toBe("100%");
  });
});
