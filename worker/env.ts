export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export interface AssetsLike {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  OPENCODE_API_KEY: string;
  APP_TOKEN: string;
  JINA_API_KEY?: string;
  BUDGET: KVNamespaceLike;
  ASSETS: AssetsLike;
  ALLOWED_MODELS: string;
  DAILY_CHUNK_BUDGET: string;
}
