import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { notifyStoreChange } from "./storeEvents";
import type {
  Article,
  ArticleView,
  ScrollPosition,
  SentenceCacheEntry,
} from "./types";

interface QuioscoDB extends DBSchema {
  articles: {
    key: string;
    value: Article;
    indexes: { createdAt: number; url: string };
  };
  positions: {
    key: string;
    value: ScrollPosition;
  };
  sentences: {
    key: string;
    value: SentenceCacheEntry;
  };
}

export interface ArticleStore {
  list(): Promise<Article[]>;
  listAll(): Promise<Article[]>;
  get(id: string): Promise<Article | undefined>;
  put(article: Article): Promise<void>;
  update(id: string, patch: Partial<Article>): Promise<Article>;
  remove(id: string): Promise<void>;
  findByUrl(url: string): Promise<Article | undefined>;
  applyRemote(articles: Article[]): Promise<void>;
  getScrollPosition(articleId: string): Promise<ScrollPosition | null>;
  setScrollPosition(
    articleId: string,
    y: number,
    view: ArticleView,
    zenIndex?: number,
  ): Promise<void>;
  getSentences(keys: readonly string[]): Promise<SentenceCacheEntry[]>;
  putSentences(entries: readonly SentenceCacheEntry[]): Promise<void>;
  close(): void;
}

export async function createStore(
  dbName = "quiosco",
  onChange?: () => void,
): Promise<ArticleStore> {
  const db = await openDB<QuioscoDB>(dbName, 3, {
    upgrade(database: IDBPDatabase<QuioscoDB>, oldVersion: number) {
      if (oldVersion < 1) {
        const store = database.createObjectStore("articles", {
          keyPath: "id",
        });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("url", "url");
      }
      if (oldVersion < 2) {
        database.createObjectStore("positions", { keyPath: "id" });
      }
      if (oldVersion < 3) {
        database.createObjectStore("sentences", { keyPath: "key" });
      }
    },
  });

  return {
    async list() {
      const all = await db.getAllFromIndex("articles", "createdAt");
      return all.filter((article) => !article.deleted).reverse();
    },
    async listAll() {
      return db.getAll("articles");
    },
    async get(id) {
      const article = await db.get("articles", id);
      return article && !article.deleted ? article : undefined;
    },
    async put(article) {
      await db.put("articles", { ...article, dirty: true });
      notifyStoreChange(article.id);
      onChange?.();
    },
    async update(id, patch) {
      const existing = await db.get("articles", id);
      if (!existing) throw new Error(`article not found: ${id}`);
      const updated: Article = {
        ...existing,
        ...patch,
        dirty: true,
        updatedAt: Date.now(),
      };
      await db.put("articles", updated);
      notifyStoreChange(id);
      onChange?.();
      return updated;
    },
    async remove(id) {
      const existing = await db.get("articles", id);
      if (!existing || existing.deleted) return;
      if (existing.kind === "book") {
        // Books never sync, so a tombstone would keep their chapters around
        // forever; delete the row outright. The sentence cache is untouched.
        await db.delete("articles", id);
      } else {
        await db.put("articles", {
          ...existing,
          deleted: true,
          dirty: true,
          updatedAt: Date.now(),
        });
      }
      await db.delete("positions", id);
      notifyStoreChange(id);
      onChange?.();
    },
    async findByUrl(url) {
      const matches = await db.getAllFromIndex("articles", "url", url);
      return matches.find((article) => !article.deleted);
    },
    async applyRemote(articles) {
      const tx = db.transaction("articles", "readwrite");
      for (const article of articles) {
        await tx.store.put({ ...article, dirty: false });
      }
      await tx.done;
    },
    async getScrollPosition(articleId) {
      return (await db.get("positions", articleId)) ?? null;
    },
    async setScrollPosition(articleId, y, view, zenIndex) {
      const existing = (await db.get("positions", articleId)) ?? null;
      await db.put("positions", {
        id: articleId,
        y,
        view,
        zenIndex: zenIndex !== undefined ? zenIndex : existing?.zenIndex,
        updatedAt: Date.now(),
      });
    },
    async getSentences(keys) {
      const found = await Promise.all(
        keys.map((key) => db.get("sentences", key)),
      );
      return found.filter(
        (entry): entry is SentenceCacheEntry => entry !== undefined,
      );
    },
    async putSentences(entries) {
      const tx = db.transaction("sentences", "readwrite");
      for (const entry of entries) await tx.store.put(entry);
      await tx.done;
    },
    close() {
      db.close();
    },
  };
}
