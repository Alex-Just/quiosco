import { describe, expect, it } from "vitest";
import { shouldReloadOnControllerChange } from "./pwa";

describe("shouldReloadOnControllerChange", () => {
  it("reloads when an updated worker takes over an already-controlled page", () => {
    expect(shouldReloadOnControllerChange(true, false)).toBe(true);
  });

  it("does not reload on the first install (no previous controller)", () => {
    expect(shouldReloadOnControllerChange(false, false)).toBe(false);
  });

  it("does not reload while a translation is running", () => {
    expect(shouldReloadOnControllerChange(true, true)).toBe(false);
  });
});
