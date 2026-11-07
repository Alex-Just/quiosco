import { describe, expect, it } from "vitest";
import {
  clampSwipeOffset,
  isHorizontalDrag,
  SWIPE_ACTION_WIDTH,
  swipeShouldOpen,
} from "./listSwipe";

describe("clampSwipeOffset", () => {
  it("stops at the closed position on a rightward drag", () => {
    expect(clampSwipeOffset(24)).toBe(0);
  });

  it("stops at the action width on a long leftward drag", () => {
    expect(clampSwipeOffset(-500)).toBe(-SWIPE_ACTION_WIDTH);
  });

  it("follows shorter leftward drags", () => {
    expect(clampSwipeOffset(-40)).toBe(-40);
  });

  it("accepts a custom action width", () => {
    expect(clampSwipeOffset(-500, 64)).toBe(-64);
  });
});

describe("swipeShouldOpen", () => {
  it("opens once the row passes half the action width", () => {
    expect(swipeShouldOpen(-SWIPE_ACTION_WIDTH / 2)).toBe(true);
    expect(swipeShouldOpen(-SWIPE_ACTION_WIDTH)).toBe(true);
  });

  it("stays closed below half the action width", () => {
    expect(swipeShouldOpen(-SWIPE_ACTION_WIDTH / 2 + 1)).toBe(false);
    expect(swipeShouldOpen(0)).toBe(false);
  });
});

describe("isHorizontalDrag", () => {
  it("accepts a mostly horizontal movement past the threshold", () => {
    expect(isHorizontalDrag(-24, 4)).toBe(true);
  });

  it("rejects vertical scrolling", () => {
    expect(isHorizontalDrag(4, -24)).toBe(false);
  });

  it("rejects movement below the threshold", () => {
    expect(isHorizontalDrag(5, 1)).toBe(false);
  });
});
