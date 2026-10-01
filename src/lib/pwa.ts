// A new service worker activates immediately after a deploy (skipWaiting +
// clientsClaim), but the open page keeps running the old JS until it reloads.
// Reload once so the app never stays on a stale build. Skip the first install
// (the page had no controller before, so there is nothing stale to replace)
// and in-flight translations (they resume from stored state, and reloading
// mid-run would interrupt the user).
export function shouldReloadOnControllerChange(
  hadController: boolean,
  translating: boolean,
): boolean {
  return hadController && !translating;
}
