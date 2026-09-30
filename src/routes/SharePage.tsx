import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createApi } from "../lib/api";
import { newArticle } from "../lib/article";
import { climbLadder, LadderError } from "../lib/ladder";
import { loadSettings } from "../lib/settings";
import { classifyShare, deriveTitle } from "../lib/share";
import { clearPendingShare, readPendingShare } from "../lib/sharePayload";
import { translateArticle } from "../lib/translateArticle";
import { normalizeUrl } from "../lib/url";
import { useStore } from "../lib/useStore";

type Flow =
  | { phase: "loading" }
  | { phase: "empty" }
  | { phase: "fetching"; detail: string }
  | {
      phase: "error";
      message: string;
      partialText: string | null;
      url: string;
      title: string;
    };

export default function SharePage() {
  const store = useStore();
  const navigate = useNavigate();
  const started = useRef(false);
  const [flow, setFlow] = useState<Flow>({ phase: "loading" });

  useEffect(() => {
    if (!store || started.current) return;
    started.current = true;
    void (async () => {
      const payload = await readPendingShare();
      if (!payload) {
        setFlow({ phase: "empty" });
        return;
      }
      const classification = classifyShare(payload);
      if (classification.mode !== "url") {
        navigate("/add", { state: { fromShare: true } });
        return;
      }
      const settings = loadSettings();
      setFlow({ phase: "fetching", detail: "Fetching article…" });
      try {
        const api = createApi({ token: settings.appToken });
        const result = await climbLadder(
          classification.url,
          async (rung, url) => {
            setFlow({ phase: "fetching", detail: `Trying ${rung}…` });
            return api.fetchRung(rung, url);
          },
        );
        const canonical = normalizeUrl(classification.url);
        const existing = canonical
          ? await store.findByUrl(canonical)
          : undefined;
        if (existing) {
          await clearPendingShare();
          navigate(`/article/${existing.id}`);
          return;
        }
        const article = newArticle({
          url: canonical,
          title: deriveTitle({
            extractedTitle: result.article.title,
            sharedTitle: classification.title,
            text: result.article.text,
            url: classification.url,
          }),
          text: result.article.text,
          via: result.via,
        });
        await store.put(article);
        await clearPendingShare();
        navigate(`/article/${article.id}`);
        if (settings.autoTranslate && settings.appToken) {
          void translateArticle(store, article, settings);
        }
      } catch (error) {
        setFlow({
          phase: "error",
          message:
            error instanceof LadderError
              ? "Could not extract the article text."
              : "Fetch failed. Check your token and try again.",
          partialText: error instanceof LadderError ? error.partialText : null,
          url: classification.url,
          title: classification.title,
        });
      }
    })();
  }, [store, navigate]);

  if (flow.phase === "loading" || flow.phase === "fetching") {
    return (
      <section className="flow">
        <h1>Adding article…</h1>
        <p className="muted">
          {flow.phase === "fetching" ? flow.detail : "Loading…"}
        </p>
      </section>
    );
  }

  if (flow.phase === "empty") {
    return (
      <section className="flow">
        <h1>Nothing received</h1>
        <p className="muted">
          Share an article to Quiosco again, or paste the text manually.
        </p>
        <div className="row">
          <Link className="button primary" to="/add">
            Paste text
          </Link>
          <Link className="button" to="/">
            Back to list
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="flow">
      <h1>Extraction failed</h1>
      <p className="error">{flow.message}</p>
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
        <Link
          className="button"
          to="/add"
          state={{
            prefillText: flow.partialText ?? "",
            prefillUrl: flow.url,
            prefillTitle: flow.title,
          }}
        >
          Paste or edit text
        </Link>
        <a className="button" href={flow.url} target="_blank" rel="noreferrer">
          Open original
        </a>
      </div>
    </section>
  );
}
