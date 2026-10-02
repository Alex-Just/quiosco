// Guards every title source against page/share artifacts that must never
// become a title: Chrome's reader-mode share line
// ("Including link: chrome-distiller://…"), raw URLs, and long unbroken
// tokens (ids, hashes).
const LONG_TOKEN = /^\S{41,}$/;

export function isGarbageTitle(candidate: string): boolean {
  const title = candidate.trim();
  if (title.length === 0) return true;
  if (title.includes("://")) return true;
  if (/^including link\b/i.test(title)) return true;
  return LONG_TOKEN.test(title);
}
