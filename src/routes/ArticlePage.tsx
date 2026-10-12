import { useNavigate, useParams } from "react-router-dom";
import { useArticleDocument } from "../lib/useArticleDocument";
import { useStore } from "../lib/useStore";
import ArticleReader from "./ArticleReader";
import BookReader from "./BookReader";

export default function ArticlePage() {
  const store = useStore();
  const navigate = useNavigate();
  const { id } = useParams();

  const { article, setArticle, now, running } = useArticleDocument(
    store,
    id,
    navigate,
  );

  if (!store || !article) return <p className="muted">Loading…</p>;

  if (article.kind === "book") {
    return (
      <BookReader
        store={store}
        article={article}
        setArticle={setArticle}
        navigate={navigate}
      />
    );
  }

  return (
    <ArticleReader
      store={store}
      article={article}
      setArticle={setArticle}
      now={now}
      running={running}
      navigate={navigate}
    />
  );
}
