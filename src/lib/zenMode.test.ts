import { describe, expect, it } from "vitest";
import {
  clampZenIndex,
  stepZenIndex,
  ZEN_SWIPE_MIN_DISTANCE_PX,
  zenIndexAfterSwipe,
  zenSwipeBlockedBySelection,
} from "./zenMode";

describe("clampZenIndex", () => {
  it("keeps the index inside the paragraph range", () => {
    expect(clampZenIndex(-1, 5)).toBe(0);
    expect(clampZenIndex(2, 5)).toBe(2);
    expect(clampZenIndex(9, 5)).toBe(4);
  });

  it("does not wipe a restored index when total is briefly 0", () => {
    expect(clampZenIndex(11, 0)).toBe(11);
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

describe("zenSwipeBlockedBySelection", () => {
  it("blocks a touch gesture that changed the selection", () => {
    // Long-press starts a selection, or the finger extends the live one.
    expect(
      zenSwipeBlockedBySelection({
        pointerType: "touch",
        selectionActive: true,
        selectionChanged: true,
      }),
    ).toBe(true);
  });

  it("keeps a touch swipe under an unchanged, stale selection", () => {
    expect(
      zenSwipeBlockedBySelection({
        pointerType: "touch",
        selectionActive: true,
        selectionChanged: false,
      }),
    ).toBe(false);
  });

  it("keeps mouse drags swiping even when they select text", () => {
    expect(
      zenSwipeBlockedBySelection({
        pointerType: "mouse",
        selectionActive: true,
        selectionChanged: true,
      }),
    ).toBe(false);
  });

  it("keeps a touch gesture without a selection", () => {
    expect(
      zenSwipeBlockedBySelection({
        pointerType: "touch",
        selectionActive: false,
        selectionChanged: false,
      }),
    ).toBe(false);
  });
});
