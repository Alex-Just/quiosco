import type { ApiClient } from "./api";
import {
  applyRemoteSettings,
  clearSettingsDirty,
  isSettingsDirty,
} from "./settings";
import type { ArticleStore } from "./store";
import type { Article, Settings, SyncArticleRow, SyncResponse } from "./types";

const CURSOR_KEY = "quiosco.sync.cursor";
const LAST_SYNC_KEY = "quiosco.sync.at";
const MAX_BATCH_ROWS = 10;
const MAX_BATCH_BYTES = 2_000_000;
const PAGE_SIZE = 500;

export interface SyncSummary {
  pushed: number;
  pulled: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export async function syncNow(
  store: ArticleStore,
  settings: Settings,
  api: ApiClient,
  storage: StorageLike = localStorage,
): Promise<SyncSummary> {
  let cursor = Number(storage.getItem(CURSOR_KEY) ?? "0") || 0;
  const all = await store.listAll();
  const dirty = all.filter((article) => article.dirty);
  const batches = batchRows(dirty);
  let settingsRow =
    isSettingsDirty(storage) && settings.updatedAt
      ? { updatedAt: settings.updatedAt, data: serializeSettings(settings) }
      : null;

  let pushed = 0;
  let pulled = 0;
  let lastCount = 0;
  const requests = batches.length > 0 ? batches : [[]];
  for (const batch of requests) {
    const response = await api.sync({
      cursor,
      articles: batch.map(toRow),
      settings: settingsRow,
    });
    settingsRow = null;
    pushed += batch.length;
    pulled += response.articles.length;
    lastCount = response.articles.length;
    cursor = response.cursor;
    await applyResponse(store, storage, response);
  }
  while (lastCount === PAGE_SIZE) {
    const response = await api.sync({ cursor, articles: [], settings: null });
    pulled += response.articles.length;
    lastCount = response.articles.length;
    cursor = response.cursor;
    await applyResponse(store, storage, response);
  }
  storage.setItem(CURSOR_KEY, String(cursor));
  storage.setItem(LAST_SYNC_KEY, String(Date.now()));
  return { pushed, pulled };
}

async function applyResponse(
  store: ArticleStore,
  storage: StorageLike,
  response: SyncResponse,
): Promise<void> {
  if (response.articles.length > 0) {
    const localById = new Map(
      (await store.listAll()).map((article) => [article.id, article]),
    );
    const toApply: Article[] = [];
    for (const row of response.articles) {
      let parsed: Article;
      try {
        parsed = JSON.parse(row.data) as Article;
      } catch {
        continue;
      }
      const local = localById.get(row.id);
      if (local?.dirty && local.updatedAt > row.updatedAt) continue;
      toApply.push({
        ...parsed,
        id: row.id,
        updatedAt: row.updatedAt,
        deleted: row.deleted,
        dirty: false,
      });
    }
    if (toApply.length > 0) {
      await store.applyRemote(toApply);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("quiosco:sync"));
      }
    }
  }
  if (response.settings) {
    const applied = applyRemoteSettings(response.settings, storage);
    if (applied) clearSettingsDirty(storage);
  }
}

function batchRows(rows: Article[]): Article[][] {
  const batches: Article[][] = [];
  let current: Article[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (current.length >= MAX_BATCH_ROWS || bytes + size > MAX_BATCH_BYTES) {
      if (current.length > 0) batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function toRow(article: Article): SyncArticleRow {
  return {
    id: article.id,
    updatedAt: article.updatedAt,
    deleted: article.deleted === true,
    data: JSON.stringify(article),
  };
}

function serializeSettings(settings: Settings): string {
  return JSON.stringify({
    targetLanguage: settings.targetLanguage,
    rules: settings.rules,
    model: settings.model,
    autoTranslate: settings.autoTranslate,
  });
}

// Trigger plumbing: App registers a runner; pages call scheduleSync().
let runner: (() => Promise<SyncSummary | null>) | null = null;
let timer: number | null = null;

export function registerSyncRunner(
  fn: () => Promise<SyncSummary | null>,
): void {
  runner = fn;
}

export function scheduleSync(delayMs = 3000): void {
  if (typeof window === "undefined") return;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void runSyncNow().catch(() => undefined);
  }, delayMs);
}

export function runSyncNow(): Promise<SyncSummary | null> {
  return runner ? runner() : Promise.resolve(null);
}
