import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStore } from "./store";
import { clampZenIndex } from "./zenMode";

describe("zen position persistence", () => {
  it("round-trips zenIndex through the positions store", async () => {
    const store = await createStore(`zen-pos-${randomUUID()}`);
    const id = randomUUID();
    await store.setScrollPosition(id, 0, "translation", 17);
    const saved = await store.getScrollPosition(id);
    expect(saved?.zenIndex).toBe(17);
    expect(clampZenIndex(saved?.zenIndex ?? 0, 34)).toBe(17);
    store.close();
  });
});
