// Zen translation mode: one prefetch session per open book while the mode is
// on, plus the verified cache reads that turn its writes into visible
// paragraph text. Translation is opt-in: no mode or no token, no requests.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createApi } from "./api";
import type { BookSentenceUnit } from "./bookText";
import {
  type BookTranslationSession,
  type BookTranslationStatus,
  readCachedTranslations,
  startBookTranslation,
} from "./bookTranslation";
import { buildBookSystemPrompt } from "./prompt";
import { createSentenceKeyMemo } from "./sentenceKey";
import type { ArticleStore } from "./store";
import type { Article } from "./types";

const EMPTY_TRANSLATIONS: ReadonlyMap<number, string> = new Map();

/** Session plus the key memo its cache reads share with the session's writes. */
interface TranslationSession {
  session: BookTranslationSession;
  keyFor: (unitIndex: number) => Promise<string>;
  rulesHash: Promise<string>;
}

export interface BookTranslationHook {
  translations: ReadonlyMap<number, string>;
  status: BookTranslationStatus;
  retry: () => void;
}

/**
 * Translation mode for one open book: a prefetch session anchored at the Zen
 * sentence being read, and the verified translation cached for that sentence
 * (a sentence without a cache entry falls back to its source text upstream,
 * so reading never waits for a request). The session lives only while the mode
 * is on and an app token is configured.
 */
export function useBookTranslation(args: {
  store: ArticleStore;
  article: Article;
  settings: {
    appToken: string;
    targetLanguage: string;
    rules: string;
    model: string;
  };
  /** Zen screen = sentence unit index; null until the position is restored. */
  anchorUnit: number | null;
  enabled: boolean;
  /** Flat-paragraph sentence units, computed once by the caller. */
  units: readonly BookSentenceUnit[];
  /** Unit indices per flat paragraph, from the same computation. */
  paragraphUnits: ReadonlyMap<number, readonly number[]>;
}): BookTranslationHook {
  const {
    store,
    article,
    settings,
    anchorUnit,
    enabled,
    units,
    paragraphUnits,
  } = args;
  const { appToken, targetLanguage, rules, model } = settings;
  const [translations, setTranslations] =
    useState<ReadonlyMap<number, string>>(EMPTY_TRANSLATIONS);
  const [status, setStatus] = useState<BookTranslationStatus>("idle");
  /** Bumped by every session update so the cache reads below re-run. */
  const [sessionVersion, setSessionVersion] = useState(0);

  // Book metadata comes from the article; the settings that shape cache keys
  // and the prompt are listed as deps so a session is rebuilt exactly when one
  // of them changes.
  const system = useMemo(
    () =>
      buildBookSystemPrompt({
        title: article.title,
        author: article.author,
        sourceLanguage: article.bookLanguage,
        targetLanguage,
        rules,
      }),
    [
      article.title,
      article.author,
      article.bookLanguage,
      targetLanguage,
      rules,
    ],
  );

  const current = useRef<TranslationSession | null>(null);
  /** Generation of the cache read: a newer read makes older ones stale. */
  const readGeneration = useRef(0);

  useEffect(() => {
    if (!enabled || !appToken) {
      current.current = null;
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let started: BookTranslationSession | null = null;
    let unsubscribe: (() => void) | null = null;
    const keyMemo = createSentenceKeyMemo({ targetLanguage, rules });
    const api = createApi({ token: appToken });
    void keyMemo.rulesHash().then((rulesHashValue) => {
      if (cancelled) return;
      const session = startBookTranslation({
        deps: { store, translate: api.translate },
        units,
        paragraphUnits,
        keyFor: (unitIndex) => keyMemo.keyFor(units[unitIndex]?.text ?? ""),
        model,
        system,
        targetLanguage,
        rulesHashValue,
      });
      started = session;
      current.current = {
        session,
        keyFor: (unitIndex) => keyMemo.keyFor(units[unitIndex]?.text ?? ""),
        rulesHash: keyMemo.rulesHash(),
      };
      setStatus(session.status());
      unsubscribe = session.onUpdate(() => {
        setStatus(session.status());
        setSessionVersion((version) => version + 1);
      });
      // The session exists now: the version bump anchors it at the paragraph
      // on screen and re-reads the cache under the computed rules hash.
      setSessionVersion((version) => version + 1);
    });
    return () => {
      cancelled = true;
      if (started !== null && current.current?.session === started) {
        current.current = null;
      }
      unsubscribe?.();
      started?.dispose();
      setStatus("idle");
    };
  }, [
    enabled,
    appToken,
    store,
    units,
    paragraphUnits,
    model,
    system,
    targetLanguage,
    rules,
  ]);

  // Re-anchor on a screen change (and once more when a session has just been
  // created, driven by the version bump). The session scans forward from the
  // screen's paragraph, so a screen inside a partially translated paragraph
  // still resumes coverage correctly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionVersion is the manual invalidation trigger for session creation
  useEffect(() => {
    if (anchorUnit == null) return;
    const paragraph = units[anchorUnit]?.paragraphIndex;
    if (paragraph == null) return;
    current.current?.session.setAnchor(paragraph);
  }, [anchorUnit, sessionVersion, units]);

  // Verified cache read for the sentence on screen. A newer read (or session)
  // invalidates an in-flight one, so a translation can never land for a
  // sentence that is no longer displayed, and a slower older read cannot
  // overwrite a newer one's map.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionVersion is the manual invalidation trigger for session updates
  useEffect(() => {
    const session = current.current;
    if (!enabled || session === null) return;
    readGeneration.current += 1;
    const generation = readGeneration.current;
    void session.rulesHash
      .then(async (rulesHashValue) => {
        if (
          current.current !== session ||
          readGeneration.current !== generation
        ) {
          return;
        }
        const found = await readCachedTranslations({
          store,
          units,
          unitIndices: anchorUnit == null ? [] : [anchorUnit],
          keyFor: session.keyFor,
          targetLanguage,
          rulesHashValue,
        });
        if (
          current.current !== session ||
          readGeneration.current !== generation
        ) {
          return;
        }
        setTranslations(found);
      })
      .catch(() => {
        // A failed cache read (e.g. IndexedDB) leaves the sentence on its
        // source text; there is nothing newer to publish.
      });
  }, [
    enabled,
    store,
    units,
    paragraphUnits,
    anchorUnit,
    targetLanguage,
    sessionVersion,
  ]);

  // A paused session (upstream hiccup) resumes as soon as the device is back
  // online; auth and quota are sticky and need a token or a new day.
  useEffect(() => {
    if (status !== "paused") return;
    const onOnline = () => current.current?.session.retry();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [status]);

  const retry = useCallback(() => {
    current.current?.session.retry();
  }, []);

  return { translations, status, retry };
}
