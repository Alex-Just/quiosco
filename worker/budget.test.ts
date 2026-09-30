import { describe, expect, it } from "vitest";
import { budgetKey, consumeChunks } from "./budget";

const fakeKv = () => {
  const map = new Map<string, string>();
  return {
    map,
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
  };
};

describe("budget", () => {
  it("counts chunks under the limit", async () => {
    const kv = fakeKv();
    await expect(consumeChunks(kv, 1, 10)).resolves.toEqual({
      ok: true,
      used: 1,
      limit: 10,
    });
    await expect(consumeChunks(kv, 2, 10)).resolves.toEqual({
      ok: true,
      used: 3,
      limit: 10,
    });
  });

  it("blocks when the limit would be exceeded, without incrementing", async () => {
    const kv = fakeKv();
    await consumeChunks(kv, 9, 10);
    await expect(consumeChunks(kv, 2, 10)).resolves.toEqual({
      ok: false,
      used: 9,
      limit: 10,
    });
    await expect(kv.get(budgetKey(new Date()))).resolves.toBe("9");
  });

  it("uses one key per UTC day", async () => {
    const kv = fakeKv();
    await consumeChunks(kv, 1, 10, new Date("2026-09-30T23:00:00Z"));
    await consumeChunks(kv, 1, 10, new Date("2026-10-01T01:00:00Z"));
    expect(kv.map.size).toBe(2);
  });
});
