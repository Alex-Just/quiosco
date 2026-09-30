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
  get(id: string): Promise<Article | undefined>;
  put(article: Article): Promise<void>;
  update(id: string, patch: Partial<Article>): Promise<Article>;
  remove(id: string): Promise<void>;
  findByUrl(url: string): Promise<Article | undefined>;
  close(): void;
}

export async function createStore(dbName = "quiosco"): Promise<ArticleStore> {
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
      return all.reverse();
    },
    get(id) {
      return db.get("articles", id);
    },
    async put(article) {
      await db.put("articles", article);
    },
    async update(id, patch) {
      const existing = await db.get("articles", id);
      if (!existing) throw new Error(`article not found: ${id}`);
      const updated: Article = { ...existing, ...patch, updatedAt: Date.now() };
      await db.put("articles", updated);
      return updated;
    },
    remove(id) {
      return db.delete("articles", id);
    },
    async findByUrl(url) {
      const matches = await db.getAllFromIndex("articles", "url", url);
      return matches[0];
    },
    close() {
      db.close();
    },
  };
}
