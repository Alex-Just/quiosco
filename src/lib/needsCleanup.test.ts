import { describe, expect, it, vi } from "vitest";
import {
  CLEANUP_DECISION_STATE_CHARS,
  CLEANUP_NEED_MIN_PROBABILITY,
  CLEANUP_NEED_QUESTION_ID,
  JEV_MODEL_FALLBACK,
  JEV_MODEL_PRIMARY,
  shouldCheckCleanup,
  suggestCleanup,
} from "./needsCleanup";
import type { DecideRequest, DecideResponse } from "./types";

describe("shouldCheckCleanup", () => {
  it("returns true when the noul probability meets the threshold", () => {
    expect(
      shouldCheckCleanup({
        answers: {
          [CLEANUP_NEED_QUESTION_ID]: {
            type: "noul",
            noul: CLEANUP_NEED_MIN_PROBABILITY,
          },
        },
      }),
    ).toBe(true);
  });

  it("returns false when the noul probability is below the threshold", () => {
    expect(
      shouldCheckCleanup({
        answers: {
          [CLEANUP_NEED_QUESTION_ID]: {
            type: "noul",
            noul: CLEANUP_NEED_MIN_PROBABILITY - 0.01,
          },
        },
      }),
    ).toBe(false);
  });

  it("returns false for malformed answers", () => {
    expect(shouldCheckCleanup(null)).toBe(false);
    expect(shouldCheckCleanup({})).toBe(false);
    expect(
      shouldCheckCleanup({
        answers: { [CLEANUP_NEED_QUESTION_ID]: { type: "noul" } },
      }),
    ).toBe(false);
  });
});

describe("suggestCleanup", () => {
  it("truncates state, calls the primary model, and maps the answer", async () => {
    const long = "x".repeat(CLEANUP_DECISION_STATE_CHARS + 50);
    const decide = vi.fn(
      async (_request: DecideRequest): Promise<DecideResponse> => ({
        answers: {
          [CLEANUP_NEED_QUESTION_ID]: { type: "noul", noul: 0.9 },
        },
      }),
    );

    await expect(suggestCleanup(long, decide)).resolves.toBe(true);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        model: JEV_MODEL_PRIMARY,
        state: "x".repeat(CLEANUP_DECISION_STATE_CHARS),
        questions: expect.objectContaining({
          [CLEANUP_NEED_QUESTION_ID]: expect.objectContaining({ type: "noul" }),
        }),
      }),
    );
  });

  it("falls back to the paid model when the free model fails", async () => {
    const decide = vi.fn(
      async (request: DecideRequest): Promise<DecideResponse> => {
        if (request.model === JEV_MODEL_PRIMARY) throw new Error("free gone");
        return {
          answers: {
            [CLEANUP_NEED_QUESTION_ID]: { type: "noul", noul: 0.8 },
          },
        };
      },
    );

    const sample =
      "Main article paragraph with enough characters for the cleanup check.";
    await expect(suggestCleanup(sample, decide)).resolves.toBe(true);
    expect(decide.mock.calls.map((call) => call[0].model)).toEqual([
      JEV_MODEL_PRIMARY,
      JEV_MODEL_FALLBACK,
    ]);
  });

  it("returns false when both models fail or text is too short", async () => {
    const decide = vi.fn(
      async (_request: DecideRequest): Promise<DecideResponse> => {
        throw new Error("down");
      },
    );
    await expect(suggestCleanup("short", decide)).resolves.toBe(false);
    expect(decide).not.toHaveBeenCalled();
    const sample = "x".repeat(CLEANUP_DECISION_STATE_CHARS).slice(0, 80);
    await expect(suggestCleanup(sample, decide)).resolves.toBe(false);
    expect(decide).toHaveBeenCalled();
  });
});
