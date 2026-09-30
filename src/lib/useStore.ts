import { useEffect, useState } from "react";
import { type ArticleStore, createStore } from "./store";

let storePromise: Promise<ArticleStore> | null = null;

export function getStore(): Promise<ArticleStore> {
  storePromise ??= createStore();
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
