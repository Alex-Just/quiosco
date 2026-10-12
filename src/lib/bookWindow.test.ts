import { describe, expect, it } from "vitest";
import type { BookSentenceUnit } from "./bookText";
import {
  type BookWindowLimits,
  nextWindow,
  type WindowPlan,
} from "./bookWindow";

const LIMITS: BookWindowLimits = {
  maxChars: 12,
  maxSentences: 2,
  contextChars: 6,
  runwayChars: 10,
};

function u(text: string): BookSentenceUnit {
  return { paragraphIndex: 0, text, skipped: false };
}

function skip(text = "***"): BookSentenceUnit {
  return { paragraphIndex: 0, text, skipped: true };
}

function planFor(
  units: readonly BookSentenceUnit[],
  anchor: number,
  cached: readonly number[] = [],
) {
  return nextWindow({
    units,
    anchor,
    cached: (unitIndex) => cached.includes(unitIndex),
    limits: LIMITS,
  });
}

function nonSkippedIn(
  units: readonly BookSentenceUnit[],
  plan: WindowPlan | null,
): BookSentenceUnit[] {
  if (!plan) return [];
  return units.slice(plan.start, plan.end).filter((unit) => !unit.skipped);
}

describe("nextWindow", () => {
  it("returns null when the runway ahead of the anchor is covered", () => {
    const units = [u("2222222"), u("3333333")];
    expect(planFor(units, 0, [0, 1])).toBeNull();
  });

  it("returns null when only skipped units remain after the anchor", () => {
    const units = [u("2222222"), skip(), skip()];
    expect(planFor(units, 0, [0])).toBeNull();
  });

  it("starts at the anchor when the anchor unit is missing", () => {
    const units = [u("2222222"), u("3333333")];
    const plan = planFor(units, 1);
    expect(plan?.start).toBe(1);
    expect(plan).toEqual({
      start: 1,
      end: 2,
      contextBefore: [],
      contextAfter: [],
    });
  });

  it("starts after the cached run and includes the anchor region", () => {
    const units = [u("2222222"), u("3333333")];
    const plan = planFor(units, 0, [0]);
    expect(plan?.start).toBe(1);
    expect(plan).toEqual({
      start: 1,
      end: 2,
      contextBefore: [],
      contextAfter: [],
    });
  });

  it("caps the window by characters", () => {
    const units = [u("2222222"), u("3333333"), u("4444444")];
    const plan = planFor(units, 0);
    expect(plan).toEqual({
      start: 0,
      end: 1,
      contextBefore: [],
      contextAfter: [],
    });
    expect(nonSkippedIn(units, plan)).toHaveLength(1);
  });

  it("caps the window by sentence count", () => {
    const units = [u("aa"), u("bb"), u("cc"), u("dd"), u("ee")];
    const plan = planFor(units, 0);
    expect(plan?.end).toBe(2);
    expect(nonSkippedIn(units, plan)).toHaveLength(2);
  });

  it("includes skipped units inside the range but not in the counts", () => {
    const units = [
      u("2222222"), // cached, outside the window
      u("aaaaaa"), // window[0]
      skip(), // inside the range
      u("bbbbbb"), // window[1]
      u("cccccc"), // over maxSentences
    ];
    const plan = planFor(units, 0, [0]);
    expect(plan).toEqual({
      start: 1,
      end: 4,
      contextBefore: [],
      contextAfter: ["cccccc"],
    });
    expect(nonSkippedIn(units, plan)).toHaveLength(2);

    // A skip inside the covered run is stepped over too: were its text
    // counted, the runway sum would be 10 and the plan null.
    const runway = [u("2222222"), skip(), u("3333333")];
    expect(planFor(runway, 0, [0])).toEqual({
      start: 2,
      end: 3,
      contextBefore: [],
      contextAfter: [],
    });
  });

  it("collects context on both sides in reading order within contextChars", () => {
    const units = [
      u("hh"), // too old to fit the before budget
      u("aa"),
      u("bbb"),
      u("cccc"), // anchor, window[0]
      u("dddddd"), // window[1]
      u("ee"),
      u("fff"),
      u("gg"), // beyond the after budget
    ];
    const plan = planFor(units, 3, [0, 1, 2]);
    expect(plan).toEqual({
      start: 3,
      end: 5,
      contextBefore: ["aa", "bbb"],
      contextAfter: ["ee", "fff"],
    });
  });

  it("always includes one unit when the first missing unit exceeds maxChars", () => {
    const units = [u("aaaaaaaaaaaaaaa"), u("bb")];
    const plan = planFor(units, 0);
    expect(plan).toEqual({
      start: 0,
      end: 1,
      contextBefore: [],
      contextAfter: ["bb"],
    });
    expect(nonSkippedIn(units, plan)).toHaveLength(1);
  });

  it("returns null for an empty list and clamps out-of-range anchors", () => {
    expect(planFor([], 0)).toBeNull();
    expect(planFor([], 7)).toBeNull();
    const units = [u("2222222"), u("3333333")];
    expect(planFor(units, 7)?.start).toBe(1);
    expect(planFor(units, -7)?.start).toBe(0);
  });
});
