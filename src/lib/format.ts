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
