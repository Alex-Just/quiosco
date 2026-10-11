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

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(sql: string): D1Statement;
}

export interface Env {
  OPENCODE_API_KEY: string;
  APP_TOKEN: string;
  JINA_API_KEY?: string;
  BUDGET: KVNamespaceLike;
  DB: D1Like;
  ASSETS: AssetsLike;
  ALLOWED_MODELS: string;
  RESPONSES_MODELS?: string;
  /** Models allowed on /api/decide (System One / Jev). */
  DECISION_MODELS?: string;
  DAILY_CHUNK_BUDGET: string;
}
