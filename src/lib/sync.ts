import type { ApiClient } from "./api";
import {
  applyRemoteSettings,
  clearSettingsDirty,
  isSettingsDirty,
} from "./settings";
import type { ArticleStore } from "./store";
import type { Article, Settings, SyncArticleRow, SyncResponse } from "./types";

const CURSOR_KEY = "quiosco.sync.cursor";
export const LAST_SYNC_KEY = "quiosco.sync.at";
const MAX_BATCH_ROWS = 10;
const MAX_BATCH_BYTES = 2_000_000;
const PAGE_SIZE = 500;
const MAX_PULL_PAGES = 20;

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
  // Rows written before the dirty flag existed have no flag at all: treat
  // them as dirty so an already-deployed library backfills on first sync.
  // The accepted echo writes `dirty: false`, so this converges. Books are
  // device-local, so they and their tombstones never leave the device.
  const dirty = all.filter(
    (article) => article.dirty !== false && article.kind !== "book",
  );
  const batches = batchRows(dirty);
  const pushedIds = new Set<string>();
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
    for (const article of batch) pushedIds.add(article.id);
    pushed += batch.length;
    // Push echoes are not "down": count only rows this device did not send.
    pulled += response.articles.filter((row) => !pushedIds.has(row.id)).length;
    lastCount = response.articles.length;
    cursor = response.cursor;
    await applyResponse(store, storage, response);
  }
  let pages = 0;
  while (lastCount === PAGE_SIZE && pages < MAX_PULL_PAGES) {
    pages += 1;
    const response = await api.sync({ cursor, articles: [], settings: null });
    pulled += response.articles.filter((row) => !pushedIds.has(row.id)).length;
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
  const articlesChanged = await applyRemoteArticles(store, response.articles);
  const settingsChanged = applyRemoteSettingsIfPresent(response, storage);
  if (articlesChanged || settingsChanged) {
    dispatchSyncEvent();
  }
}

async function applyRemoteArticles(
  store: ArticleStore,
  rows: SyncResponse["articles"],
): Promise<boolean> {
  if (rows.length === 0) return false;
  const localById = new Map(
    (await store.listAll()).map((article) => [article.id, article]),
  );
  const toApply = rows
    .map((row) => articleFromSyncRow(row, localById.get(row.id)))
    .filter((article): article is Article => article !== null);
  if (toApply.length === 0) return false;
  await store.applyRemote(toApply);
  return true;
}

function articleFromSyncRow(
  row: SyncResponse["articles"][number],
  local: Article | undefined,
): Article | null {
  const parsed = parseArticleData(row.data);
  if (!parsed) return null;
  if (local?.dirty && local.updatedAt > row.updatedAt) return null;
  return {
    ...parsed,
    id: row.id,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
    dirty: false,
  };
}

function parseArticleData(data: string): Article | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  // `data` is opaque JSON: only a plain object is an article body.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Article;
}

function applyRemoteSettingsIfPresent(
  response: SyncResponse,
  storage: StorageLike,
): boolean {
  if (!response.settings) return false;
  const applied = applyRemoteSettings(response.settings, storage);
  if (!applied) return false;
  clearSettingsDirty(storage);
  return true;
}

function dispatchSyncEvent(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("quiosco:sync"));
  }
}

function batchRows(rows: Article[]): Article[][] {
  const batches: Article[][] = [];
  let current: Article[] = [];
  let bytes = 0;
  for (const row of rows) {
    // Measure the encoded row body (what the server actually receives and
    // caps), not the raw article JSON.
    const size = JSON.stringify(toRow(row)).length;
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
    ttsProvider: settings.ttsProvider,
    edgeVoice: settings.edgeVoice,
    elevenLabsVoiceId: settings.elevenLabsVoiceId,
    ttsRate: settings.ttsRate,
  });
}

// Trigger plumbing: App registers a runner; pages call scheduleSync().
let runner: (() => Promise<SyncSummary | null>) | null = null;
let timer: number | null = null;
let inFlight: Promise<SyncSummary | null> | null = null;

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
  if (inFlight) return inFlight;
  if (!runner) return Promise.resolve(null);
  inFlight = runner().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
