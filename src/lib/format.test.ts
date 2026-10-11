import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDurationMs,
  formatPhaseTimings,
} from "./format";

// Fixed instants so the expectations do not depend on the runner's timezone;
// the formatters pin Europe/Madrid (CEST in October, CET in January).
describe("formatDateTime", () => {
  it("renders Spain date and 24-hour time", () => {
    expect(formatDateTime(Date.UTC(2026, 9, 1, 12, 13))).toBe(
      "01/10/2026, 14:13",
    );
  });

  it("follows the Madrid DST offset in winter", () => {
    expect(formatDateTime(Date.UTC(2026, 0, 15, 12, 13))).toBe(
      "15/01/2026, 13:13",
    );
  });
});

describe("formatDate", () => {
  it("renders a day-first numeric date", () => {
    expect(formatDate(Date.UTC(2026, 9, 1, 12, 13))).toBe("01/10/2026");
  });
});

describe("formatDurationMs", () => {
  it("formats seconds under a minute", () => {
    expect(formatDurationMs(0)).toBe("0s");
    expect(formatDurationMs(12_400)).toBe("12s");
  });

  it("formats minutes and leftover seconds", () => {
    expect(formatDurationMs(65_000)).toBe("1m 05s");
    expect(formatDurationMs(600_000)).toBe("10m 00s");
  });

  it("formats hours when needed", () => {
    expect(formatDurationMs(3_661_000)).toBe("1h 01m 01s");
  });
});

describe("formatPhaseTimings", () => {
  it("joins finished clean and translate times", () => {
    expect(
      formatPhaseTimings({
        cleanDurationMs: 12_000,
        translateDurationMs: 65_000,
      }),
    ).toBe("Cleaned in 12s · Translated in 1m 05s");
  });

  it("omits missing phases", () => {
    expect(formatPhaseTimings({ translateDurationMs: 8_000 })).toBe(
      "Translated in 8s",
    );
    expect(formatPhaseTimings({})).toBeNull();
  });
});
