const FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
const FLAG_AT_START = /^[\u{1F1E6}-\u{1F1FF}]{2}/u;

/** True when the sentence begins with a regional-indicator flag emoji. */
export function startsWithFlag(text: string): boolean {
  return FLAG_AT_START.test(text.replace(/^\s+/, ""));
}

/**
 * Put a blank line before each flag line after the first content line, so
 * Spanish/Russian blocks read as separate stanzas.
 */
export function spaceFlagLines(text: string): string {
  // "…text\n🇷🇺 …" or "…text 🇷🇺 …" → blank line before the flag.
  const withBreaks = text
    .replace(
      new RegExp(`([^\\n])[ \\t]*\\n[ \\t]*(${FLAG.source})`, "gu"),
      "$1\n\n$2",
    )
    .replace(
      new RegExp(`([^\\n\\s])[ \\t]+(${FLAG.source})`, "gu"),
      "$1\n\n$2",
    );
  // Collapse 3+ newlines to a single blank line.
  return withBreaks.replace(/\n{3,}/g, "\n\n");
}

/**
 * Gap between tappable sentences: blank line before a flag-led sentence.
 * Render this as a sibling text node after the sentence button — not as
 * trailing text inside the button. Trailing newlines inside an inline
 * button wrap the next stanza mid-line in Blink/WebKit (short lines and
 * Spanish ¿…? both hit it).
 */
export function gapBeforeSentence(next: string): string {
  return startsWithFlag(next) ? "\n\n" : " ";
}
