/** How long the Zen Copy control shows "Copied" after a successful write. */
export const ZEN_COPY_RESET_MS = 1500;

/**
 * Copy the original text of the current Zen page to the clipboard.
 * Same speakable string the Listen control uses.
 */
export async function copyZenPageOriginal(
  text: string,
  setCopied: (copied: boolean) => void,
  setHint?: (hint: string | null) => void,
): Promise<void> {
  const value = text.trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), ZEN_COPY_RESET_MS);
  } catch {
    setHint?.("Could not copy the page.");
  }
}
