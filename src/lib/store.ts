import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Article } from "./types";

interface QuioscoDB extends DBSchema {
  articles: {
    key: string;
    value: Article;
    indexes: { createdAt: number; url: string };
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
  close(): void;
}

export async function createStore(
  dbName = "quiosco",
  onChange?: () => void,
): Promise<ArticleStore> {
  const db = await openDB<QuioscoDB>(dbName, 1, {
    upgrade(database: IDBPDatabase<QuioscoDB>) {
      const store = database.createObjectStore("articles", { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
      store.createIndex("url", "url");
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
      onChange?.();
      return updated;
    },
    async remove(id) {
      const existing = await db.get("articles", id);
      if (!existing || existing.deleted) return;
      await db.put("articles", {
        ...existing,
        deleted: true,
        dirty: true,
        updatedAt: Date.now(),
      });
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
    close() {
      db.close();
    },
  };
}
