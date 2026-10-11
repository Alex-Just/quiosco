import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { classifyShare } from "../lib/share";
import { readPendingShare } from "../lib/sharePayload";
import { useStore } from "../lib/useStore";

type Flow = { phase: "loading" } | { phase: "empty" };

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
      if (classification.mode === "url") {
        navigate("/add", {
          replace: true,
          state: {
            fromUrlShare: true,
            prefillUrl: classification.url,
            prefillTitle: classification.title,
          },
        });
        return;
      }
      navigate("/add", { replace: true, state: { fromShare: true } });
    })();
  }, [store, navigate]);

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
      <h1>Adding article…</h1>
      <p className="muted">Loading…</p>
    </section>
  );
}
