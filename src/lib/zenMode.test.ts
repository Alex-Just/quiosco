import { describe, expect, it } from "vitest";
import {
  clampZenIndex,
  stepZenIndex,
  ZEN_SWIPE_MIN_DISTANCE_PX,
  zenIndexAfterSwipe,
} from "./zenMode";

describe("clampZenIndex", () => {
  it("keeps the index inside the paragraph range", () => {
    expect(clampZenIndex(-1, 5)).toBe(0);
    expect(clampZenIndex(2, 5)).toBe(2);
    expect(clampZenIndex(9, 5)).toBe(4);
    expect(clampZenIndex(0, 0)).toBe(0);
  });
});

describe("stepZenIndex", () => {
  it("steps without wrapping past the ends", () => {
    expect(stepZenIndex(0, 3, -1)).toBe(0);
    expect(stepZenIndex(0, 3, 1)).toBe(1);
    expect(stepZenIndex(2, 3, 1)).toBe(2);
  });
});

describe("zenIndexAfterSwipe", () => {
  const base = { startX: 100, startY: 200, endX: 100, index: 1, total: 4 };

  it("advances on a clear upward swipe", () => {
    expect(
      zenIndexAfterSwipe({
        ...base,
        endY: 200 - ZEN_SWIPE_MIN_DISTANCE_PX - 1,
      }),
    ).toBe(2);
  });

  it("goes back on a clear downward swipe", () => {
    expect(
      zenIndexAfterSwipe({
        ...base,
        endY: 200 + ZEN_SWIPE_MIN_DISTANCE_PX + 1,
      }),
    ).toBe(0);
  });

  it("ignores short or mostly horizontal gestures", () => {
    expect(zenIndexAfterSwipe({ ...base, endY: 210 })).toBe(1);
    expect(
      zenIndexAfterSwipe({
        ...base,
        endX: 200,
        endY: 200 - ZEN_SWIPE_MIN_DISTANCE_PX - 1,
      }),
    ).toBe(1);
  });
});
