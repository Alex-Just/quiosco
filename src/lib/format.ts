// Spain-style date/time, pinned to Europe/Madrid so it reads the same on any
// device locale: day-first numeric date and a 24-hour clock.
const dateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatDateTime(timestamp: number): string {
  return dateTimeFormatter.format(timestamp);
}

export function formatDate(timestamp: number): string {
  return dateFormatter.format(timestamp);
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** Compact elapsed time for phase status (e.g. 12s, 1m 05s, 1h 01m 01s). */
export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const hours = Math.floor(
    totalSeconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR),
  );
  const minutes = Math.floor(
    (totalSeconds % (SECONDS_PER_MINUTE * MINUTES_PER_HOUR)) /
      SECONDS_PER_MINUTE,
  );
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    const paddedMinutes = String(minutes).padStart(2, "0");
    return `${hours}h ${paddedMinutes}m ${paddedSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${paddedSeconds}s`;
  }
  return `${totalSeconds}s`;
}

/** Finished-phase summary, e.g. "Cleaned in 12s · Translated in 1m 05s". */
export function formatPhaseTimings(parts: {
  cleanDurationMs?: number | null;
  translateDurationMs?: number | null;
}): string | null {
  const bits: string[] = [];
  if (parts.cleanDurationMs != null) {
    bits.push(`Cleaned in ${formatDurationMs(parts.cleanDurationMs)}`);
  }
  if (parts.translateDurationMs != null) {
    bits.push(`Translated in ${formatDurationMs(parts.translateDurationMs)}`);
  }
  return bits.length > 0 ? bits.join(" · ") : null;
}
