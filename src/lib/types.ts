export type ArticleView = "translation" | "original";

/** Per-article reading position; local only (never synced with the article). */
export interface ScrollPosition {
  id: string;
  y: number;
  view: ArticleView;
  /** Zen-mode paragraph index (0-based); local only. */
  zenIndex?: number;
  updatedAt: number;
}

export type ArticleStatus = "unread" | "read" | "archived";
export type TranslationStatus = "pending" | "running" | "done" | "error";
export type Rung = "direct" | "googlebot" | "jina" | "wayback" | "archive_ph";
export type Via = Rung | "manual" | "twitter";

/** Absent on legacy rows, which are regular articles. */
export type ArticleKind = "article" | "book";

export interface BookChapter {
  title: string;
  text: string;
}

/** Cached sentence translation; keyed by a hash of source and translation context. */
export interface SentenceCacheEntry {
  key: string;
  source: string;
  translation: string;
  targetLanguage: string;
  rulesHash: string;
  model: string;
  createdAt: number;
}

export interface Article {
  id: string;
  url: string | null;
  title: string;
  site: string | null;
  text: string;
  via: Via;
  /** Absent means a regular article. */
  kind?: ArticleKind;
  author?: string | null;
  bookLanguage?: string | null;
  chapters?: BookChapter[];
  translation: string | null;
  /** Streamed tail of the chunk in flight; only set while translating. */
  partial?: string | null;
  translationStatus: TranslationStatus;
  translatedChunks: number;
  totalChunks: number;
  cleanText?: string | null;
  translationPhase?: "cleaning" | "translating" | null;
  /** Wall-clock start of the current clean/translate phase (live timer). */
  phaseStartedAt?: number | null;
  /** How long cleanup took, once that phase finished. */
  cleanDurationMs?: number | null;
  /** How long translation took (summed across resumes), once finished. */
  translateDurationMs?: number | null;
  /**
   * Books only, local-only: set the first time a verified translation for
   * this book is on screen, so every later open starts in translated Zen
   * without touching the toggle (and only with an app token configured).
   */
  bookTranslationOn?: boolean;
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

/** Which TTS backend Listen uses for original Spanish. */
export type TtsProvider = "system" | "edge" | "elevenlabs";

/** Castilian Edge neural voice choice when provider is Edge. */
export type EdgeVoiceSetting = "elvira" | "alvaro";

/** @deprecated Prefer ttsProvider + edgeVoice; kept for migration typing. */
export type VoiceSetting = "system" | "elvira" | "alvaro";

export interface Settings {
  targetLanguage: string;
  rules: string;
  model: string;
  appToken: string;
  autoTranslate: boolean;
  /** System, free Edge neural, or premium ElevenLabs. */
  ttsProvider: TtsProvider;
  /** Used when ttsProvider === "edge". */
  edgeVoice: EdgeVoiceSetting;
  /** Opaque ElevenLabs voice id when ttsProvider === "elevenlabs". */
  elevenLabsVoiceId: string;
  /** Speech rate multiplier shared by every provider; 1 is normal. */
  ttsRate: number;
  /** When true, each Listen picks a random provider and voice. */
  ttsRandom: boolean;
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

export interface ThreadResponse {
  title: string;
  author: string;
  text: string;
  tweetCount: number;
  partial: boolean;
  source: "fxtwitter" | "syndication";
}

export interface TranslateRequest {
  model: string;
  system: string;
  text: string;
}

export interface DecideRequest {
  model: string;
  state: string;
  questions: Record<string, unknown>;
}

export interface DecideResponse {
  answers: Record<string, unknown>;
}

export interface SyncArticleRow {
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: string;
}

export interface SyncSettingsRow {
  updatedAt: number;
  data: string;
}

export interface SyncRequest {
  cursor: number;
  articles: SyncArticleRow[];
  settings: SyncSettingsRow | null;
}

export interface SyncResponse {
  cursor: number;
  articles: SyncArticleRow[];
  settings: SyncSettingsRow | null;
}
