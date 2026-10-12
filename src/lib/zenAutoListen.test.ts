import { describe, expect, it } from "vitest";
import {
  loadZenAutoListen,
  saveZenAutoListen,
  ZEN_AUTO_LISTEN_KEY,
} from "./zenAutoListen";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("zenAutoListen", () => {
  it("is off by default", () => {
    expect(loadZenAutoListen(memoryStorage())).toBe(false);
  });

  it("persists the enabled flag", () => {
    const storage = memoryStorage();
    saveZenAutoListen(true, storage);
    expect(storage.getItem(ZEN_AUTO_LISTEN_KEY)).toBe("1");
    expect(loadZenAutoListen(storage)).toBe(true);
    saveZenAutoListen(false, storage);
    expect(loadZenAutoListen(storage)).toBe(false);
  });
});
