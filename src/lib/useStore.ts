import { useEffect, useState } from "react";
import { type ArticleStore, createStore } from "./store";
import { scheduleSync } from "./sync";

let storePromise: Promise<ArticleStore> | null = null;

export function getStore(): Promise<ArticleStore> {
  storePromise ??= createStore("quiosco", () => scheduleSync());
  return storePromise;
}

export function useStore(): ArticleStore | null {
  const [store, setStore] = useState<ArticleStore | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getStore().then((value) => {
      if (!cancelled) setStore(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return store;
}
