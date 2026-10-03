export type ArticleStatus = "unread" | "read" | "archived";
export type TranslationStatus = "pending" | "running" | "done" | "error";
export type Rung = "direct" | "googlebot" | "jina" | "wayback" | "archive_ph";
export type Via = Rung | "manual";

export interface Article {
  id: string;
  url: string | null;
  title: string;
  site: string | null;
  text: string;
  via: Via;
  translation: string | null;
  /** Streamed tail of the chunk in flight; only set while translating. */
  partial?: string | null;
  translationStatus: TranslationStatus;
  translatedChunks: number;
  totalChunks: number;
  cleanText?: string | null;
  translationPhase?: "cleaning" | "translating" | null;
  model?: string | null;
  cleanup?: boolean;
  status: ArticleStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  /** Local changes not yet acknowledged by sync. */
  dirty?: boolean;
  /** Tombstone: deleted locally, kept so the deletion can sync. */
  deleted?: boolean;
}

export interface Settings {
  targetLanguage: string;
  rules: string;
  model: string;
  appToken: string;
  autoTranslate: boolean;
  /** LWW clock for settings sync. */
  updatedAt?: number;
}

export interface SharePayload {
  title: string;
  text: string;
  url: string;
  receivedAt: number;
}

export interface RungResponse {
  bytes: Uint8Array;
  contentType: string | null;
  kind: "html" | "markdown";
  via: Rung;
  finalUrl: string | null;
}

export interface TranslateRequest {
  model: string;
  system: string;
  text: string;
}
