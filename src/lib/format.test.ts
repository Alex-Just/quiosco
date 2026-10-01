import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format";

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
