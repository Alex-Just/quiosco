import type { KVNamespaceLike } from "./env";

export const DEFAULT_DAILY_CHUNK_BUDGET = 200;
const BUDGET_TTL_SECONDS = 172_800;

export interface BudgetResult {
  ok: boolean;
  used: number;
  limit: number;
}

export function budgetKey(date: Date): string {
  return `budget:${date.toISOString().slice(0, 10)}`;
}

export async function consumeChunks(
  kv: KVNamespaceLike,
  count: number,
  limit: number,
  now: Date = new Date(),
): Promise<BudgetResult> {
  const key = budgetKey(now);
  const used = Number.parseInt((await kv.get(key)) ?? "0", 10) || 0;
  if (used + count > limit) return { ok: false, used, limit };
  const next = used + count;
  await kv.put(key, String(next), { expirationTtl: BUDGET_TTL_SECONDS });
  return { ok: true, used: next, limit };
}
