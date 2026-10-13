const FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
const FLAG_AT_START = /^[\u{1F1E6}-\u{1F1FF}]{2}/u;
const REGIONAL_INDICATOR = /[\u{1F1E6}-\u{1F1FF}]/u;
const LONE_REGIONAL_AT_START =
  /^([\u{1F1E6}-\u{1F1FF}])(?![\u{1F1E6}-\u{1F1FF}])/u;
const LEADING_PLACEHOLDERS = /^(?:\uFFFC|\u200B|\uFEFF)+/u;
const VS16_BETWEEN_REGIONALS =
  /([\u{1F1E6}-\u{1F1FF}])\uFE0F([\u{1F1E6}-\u{1F1FF}])/gu;

/** Russian flag: regional R + U. Used when Cyrillic follows a broken marker. */
const FLAG_RUSSIAN = "\u{1F1F7}\u{1F1FA}";
/** Share of letters that must be Cyrillic before we infer 🇷🇺. */
const CYRILLIC_LETTER_RATIO = 0.5;

/** True when the sentence begins with a regional-indicator flag emoji. */
export function startsWithFlag(text: string): boolean {
  return FLAG_AT_START.test(text.replace(/^\s+/, ""));
}

/**
 * Repair broken language-flag markers so stanza split and spacing still work.
 * Models (and Word-pasted rules) sometimes emit U+FFFC (Android "OBJ") or a
 * lone regional indicator instead of a real flag pair.
 */
export function repairFlagMarkers(text: string): string {
  const withoutVs16 = text.replace(VS16_BETWEEN_REGIONALS, "$1$2");
  return withoutVs16.split("\n").map(repairFlagLineStart).join("\n");
}

function repairFlagLineStart(line: string): string {
  const leadingWs = /^\s*/.exec(line)?.[0] ?? "";
  let rest = line.slice(leadingWs.length);
  const hadPlaceholder = LEADING_PLACEHOLDERS.test(rest);
  rest = rest.replace(LEADING_PLACEHOLDERS, "");

  if (FLAG_AT_START.test(rest)) return `${leadingWs}${rest}`;

  const lone = LONE_REGIONAL_AT_START.exec(rest);
  if (lone) {
    const afterLone = rest.slice(lone[0].length).replace(/^\s+/, "");
    const completed = completeLoneRegional(lone[1] ?? "", afterLone);
    if (completed) return `${leadingWs}${withFlagPrefix(completed, afterLone)}`;
    rest = afterLone;
  }

  if (hadPlaceholder || lone) {
    const inferred = flagForScript(rest);
    if (inferred) return `${leadingWs}${withFlagPrefix(inferred, rest)}`;
  }

  return `${leadingWs}${rest}`;
}

function withFlagPrefix(flag: string, text: string): string {
  if (!text) return flag;
  return text.startsWith(" ") ? `${flag}${text}` : `${flag} ${text}`;
}

function completeLoneRegional(ri: string, after: string): string | null {
  if (!ri || !REGIONAL_INDICATOR.test(ri)) return null;
  const inferred = flagForScript(after);
  if (inferred?.startsWith(ri)) return inferred;
  return null;
}

function flagForScript(text: string): string | null {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters) return null;
  let cyrillic = 0;
  for (const ch of letters) {
    if (/\p{Script=Cyrillic}/u.test(ch)) cyrillic += 1;
  }
  if (cyrillic / letters.length >= CYRILLIC_LETTER_RATIO) return FLAG_RUSSIAN;
  return null;
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
