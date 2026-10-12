export const ZEN_AUTO_LISTEN_KEY = "quiosco.zenAutoListen.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Auto-listen is off until the reader opts in. */
export function loadZenAutoListen(
  storage: StorageLike = localStorage,
): boolean {
  return storage.getItem(ZEN_AUTO_LISTEN_KEY) === "1";
}

export function saveZenAutoListen(
  enabled: boolean,
  storage: StorageLike = localStorage,
): void {
  storage.setItem(ZEN_AUTO_LISTEN_KEY, enabled ? "1" : "0");
}
