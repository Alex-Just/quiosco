export const STORE_CHANGE_EVENT = "quiosco:store";

export interface StoreChangeDetail {
  id: string;
}

/** Notify open article views that a row changed (e.g. streamed partials). */
export function notifyStoreChange(id: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<StoreChangeDetail>(STORE_CHANGE_EVENT, {
      detail: { id },
    }),
  );
}

export function isStoreChangeForArticle(
  event: Event,
  articleId: string,
): boolean {
  const detail = (event as CustomEvent<StoreChangeDetail>).detail;
  return detail?.id === articleId;
}
