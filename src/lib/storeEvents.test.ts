// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  isStoreChangeForArticle,
  notifyStoreChange,
  STORE_CHANGE_EVENT,
} from "./storeEvents";

describe("storeEvents", () => {
  it("dispatches a store-change event with the article id", () => {
    const handler = vi.fn();
    window.addEventListener(STORE_CHANGE_EVENT, handler);
    notifyStoreChange("article-1");
    window.removeEventListener(STORE_CHANGE_EVENT, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({ id: "article-1" });
  });

  it("matches only the open article id", () => {
    const event = new CustomEvent(STORE_CHANGE_EVENT, {
      detail: { id: "article-1" },
    });
    expect(isStoreChangeForArticle(event, "article-1")).toBe(true);
    expect(isStoreChangeForArticle(event, "other")).toBe(false);
  });
});
