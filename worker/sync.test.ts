import { describe, expect, it } from "vitest";
import type { D1Like, D1Statement, Env } from "./env";
import { handleSync } from "./sync";

interface Row {
  id: string;
  updated_at: number;
  server_seq: number;
  deleted: number;
  data: string;
}

// Minimal in-memory D1: implements exactly the statements handleSync uses.
function fakeDb() {
  const articles = new Map<string, Row>();
  const settings = new Map<string, Row>();
  const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();

  function statement(sql: string): D1Statement {
    let args: unknown[] = [];
    const text = normalize(sql);
    const stmt: D1Statement = {
      bind(...values: unknown[]) {
        args = values;
        return stmt;
      },
      async first<T>() {
        if (text.startsWith("SELECT updated_at FROM articles")) {
          const row = articles.get(String(args[0]));
          return (row ? { updated_at: row.updated_at } : null) as T | null;
        }
        if (text.startsWith("SELECT updated_at FROM settings")) {
          const row = settings.get("settings");
          return (row ? { updated_at: row.updated_at } : null) as T | null;
        }
        if (text.startsWith("SELECT updated_at, data FROM settings")) {
          const row = settings.get("settings");
          return (
            row ? { updated_at: row.updated_at, data: row.data } : null
          ) as T | null;
        }
        throw new Error(`unexpected first(): ${text}`);
      },
      async all<T>() {
        if (
          text.startsWith(
            "SELECT id, updated_at, server_seq, deleted, data FROM articles",
          )
        ) {
          const since = Number(args[0]);
          const rows = [...articles.values()]
            .filter((row) => row.server_seq >= since)
            .sort((a, b) => a.server_seq - b.server_seq)
            .slice(0, 500);
          return { results: rows as T[] };
        }
        throw new Error(`unexpected all(): ${text}`);
      },
      async run() {
        if (text.startsWith("INSERT INTO articles")) {
          const [id, updatedAt, serverSeq, deleted, data] = args as [
            string,
            number,
            number,
            number,
            string,
          ];
          articles.set(id, {
            id,
            updated_at: updatedAt,
            server_seq: serverSeq,
            deleted,
            data,
          });
          return {};
        }
        if (text.startsWith("INSERT INTO settings")) {
          const [updatedAt, serverSeq, data] = args as [number, number, string];
          settings.set("settings", {
            id: "settings",
            updated_at: updatedAt,
            server_seq: serverSeq,
            deleted: 0,
            data,
          });
          return {};
        }
        throw new Error(`unexpected run(): ${text}`);
      },
    };
    return stmt;
  }

  return { prepare: statement, articles, settings } satisfies D1Like & {
    articles: Map<string, Row>;
    settings: Map<string, Row>;
  };
}

const makeEnv = (db: D1Like): Env => ({
  OPENCODE_API_KEY: "zen",
  APP_TOKEN: "app",
  BUDGET: { get: async () => null, put: async () => {} },
  ASSETS: { fetch: async () => new Response("shell") },
  ALLOWED_MODELS: "deepseek-v4.1-flash",
  DAILY_CHUNK_BUDGET: "200",
  DB: db,
});

const post = (body: unknown) =>
  new Request("https://app.example/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const row = (
  id: string,
  updatedAt: number,
  data = `{"id":"${id}"}`,
  deleted = false,
) => ({
  id,
  updatedAt,
  deleted,
  data,
});

describe("handleSync", () => {
  it("pushes a row and returns it on the next pull", async () => {
    const db = fakeDb();
    const first = await handleSync(
      post({ cursor: 0, articles: [row("a", 100)], settings: null }),
      makeEnv(db),
    );
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      cursor: number;
      articles: unknown[];
    };
    expect(body.articles).toHaveLength(1);
    expect(body.cursor).toBeGreaterThan(0);

    const second = await handleSync(
      post({ cursor: 0, articles: [], settings: null }),
      makeEnv(db),
    );
    const secondBody = (await second.json()) as {
      articles: Array<{ id: string }>;
    };
    expect(secondBody.articles.map((a) => a.id)).toEqual(["a"]);
  });

  it("keeps the server version when an older edit is pushed (LWW)", async () => {
    const db = fakeDb();
    await handleSync(
      post({ cursor: 0, articles: [row("a", 200, '{"v":2}')], settings: null }),
      makeEnv(db),
    );
    const response = await handleSync(
      post({ cursor: 0, articles: [row("a", 100, '{"v":1}')], settings: null }),
      makeEnv(db),
    );
    const body = (await response.json()) as {
      articles: Array<{ updatedAt: number; data: string }>;
    };
    expect(body.articles[0]?.updatedAt).toBe(200);
    expect(body.articles[0]?.data).toBe('{"v":2}');
  });

  it("round-trips a tombstone", async () => {
    const db = fakeDb();
    await handleSync(
      post({ cursor: 0, articles: [row("a", 100)], settings: null }),
      makeEnv(db),
    );
    await handleSync(
      post({ cursor: 0, articles: [row("a", 300, "", true)], settings: null }),
      makeEnv(db),
    );
    const response = await handleSync(
      post({ cursor: 0, articles: [], settings: null }),
      makeEnv(db),
    );
    const body = (await response.json()) as {
      articles: Array<{ id: string; deleted: boolean }>;
    };
    expect(body.articles[0]).toMatchObject({ id: "a", deleted: true });
  });

  it("syncs settings with LWW", async () => {
    const db = fakeDb();
    await handleSync(
      post({
        cursor: 0,
        articles: [],
        settings: { updatedAt: 5, data: '{"model":"x"}' },
      }),
      makeEnv(db),
    );
    const older = await handleSync(
      post({
        cursor: 0,
        articles: [],
        settings: { updatedAt: 4, data: '{"model":"y"}' },
      }),
      makeEnv(db),
    );
    const body = (await older.json()) as {
      settings: { updatedAt: number; data: string };
    };
    expect(body.settings).toEqual({ updatedAt: 5, data: '{"model":"x"}' });
  });

  it("rejects malformed bodies and oversized batches", async () => {
    const db = fakeDb();
    const env = makeEnv(db);
    expect((await handleSync(post({ nope: true }), env)).status).toBe(400);
    expect(
      (
        await handleSync(
          post({
            cursor: 0,
            articles: Array.from({ length: 11 }, (_, i) => row(`a${i}`, 1)),
            settings: null,
          }),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleSync(
          post({
            cursor: 0,
            articles: [row("big", 1, "x".repeat(1_000_001))],
            settings: null,
          }),
          env,
        )
      ).status,
    ).toBe(400);
  });
});
