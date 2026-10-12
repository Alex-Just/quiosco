import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../lib/format";
import { repairGarbageTitle } from "../lib/repairGarbageTitle";
import type { Article } from "../lib/types";
import { useStore } from "../lib/useStore";

type Tab = "unread" | "read" | "archived";
const TABS: Tab[] = ["unread", "read", "archived"];

export default function ListPage() {
  const store = useStore();
  const [articles, setArticles] = useState<Article[]>([]);
  const [tab, setTab] = useState<Tab>("unread");

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    const reload = () => {
      void store.list().then(async (all) => {
        const repaired = await Promise.all(
          all.map(async (article) => {
            const nextTitle = repairGarbageTitle(article);
            if (!nextTitle) return article;
            return store.update(article.id, { title: nextTitle });
          }),
        );
        if (!cancelled) setArticles(repaired);
      });
    };
    reload();
    window.addEventListener("quiosco:sync", reload);
    return () => {
      cancelled = true;
      window.removeEventListener("quiosco:sync", reload);
    };
  }, [store]);

  if (!store) return <p className="muted">Loading…</p>;

  const counts = {
    unread: articles.filter((article) => article.status === "unread").length,
    read: articles.filter((article) => article.status === "read").length,
    archived: articles.filter((article) => article.status === "archived")
      .length,
  };
  const visible = articles.filter((article) => article.status === tab);

  return (
    <section>
      <nav className="tabs" aria-label="Filters">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            className={name === tab ? "tab active" : "tab"}
            onClick={() => setTab(name)}
          >
            {name} ({counts[name]})
          </button>
        ))}
      </nav>
      {visible.length === 0 ? (
        <p className="muted">
          Nothing here yet. Share an article to Quiosco to get started.
        </p>
      ) : (
        <ul className="article-list">
          {visible.map((article) => (
            <li key={article.id}>
              <Link className="article-row" to={`/article/${article.id}`}>
                <span className="article-title">{article.title}</span>
                <span className="article-meta">
                  {article.site ?? "manual"} · {formatDate(article.createdAt)}
                  {article.translationStatus === "error"
                    ? " · translation failed"
                    : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link className="fab" to="/add">
        + Add
      </Link>
    </section>
  );
}
