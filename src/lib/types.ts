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
  translationStatus: TranslationStatus;
  translatedChunks: number;
  totalChunks: number;
  status: ArticleStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  targetLanguage: string;
  rules: string;
  model: string;
  appToken: string;
  autoTranslate: boolean;
}

export interface SharePayload {
  title: string;
  text: string;
  url: string;
  receivedAt: number;
}
