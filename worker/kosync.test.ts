import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Like, D1Statement, Env } from "./env";
import { handleKosync, handleKosyncLookup, handleKosyncPush } from "./kosync";

type Row = {
  document: string;
  filename: string | null;
  title: string | null;
  authors: string | null;
  progress: string;
  percentage: number;
  device: string;
  device_id: string | null;
  updated_at: number;
};

const PASSWORD_KEY = "5ebe2294ecd0e0f08eab7690d2a6ee69"; // md5("secret")
const AUTH = {
  "x-auth-user": "quiosco",
  "x-auth-key": PASSWORD_KEY,
};

// Minimal in-memory D1 implementing exactly the statements this module uses.
function fakeDb() {
  const rows = new Map<string, Row>();
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
        if (text.includes("WHERE filename = ?")) {
          const filename = String(args[0]).toLowerCase();
          const row = [...rows.values()]
            .filter((entry) => entry.filename?.toLowerCase() === filename)
            .sort((a, b) => b.updated_at - a.updated_at)[0];
          return (row ?? null) as T | null;
        }
        if (text.includes("WHERE title = ?") && text.includes("authors = ?")) {
          const title = String(args[0]).toLowerCase();
          const authors = String(args[1]).toLowerCase();
          const row = [...rows.values()]
            .filter(
              (entry) =>
                entry.title?.toLowerCase() === title &&
                entry.authors?.toLowerCase() === authors,
            )
            .sort((a, b) => b.updated_at - a.updated_at)[0];
          return (row ?? null) as T | null;
        }
        if (text.includes("WHERE document = ?")) {
          return (rows.get(String(args[0])) ?? null) as T | null;
        }
        throw new Error(`unexpected first(): ${text}`);
      },
      async all<T>() {
        if (text.includes("WHERE title = ?")) {
          const title = String(args[0]).toLowerCase();
          const matches = [...rows.values()]
            .filter((entry) => entry.title?.toLowerCase() === title)
            .sort((a, b) => b.updated_at - a.updated_at)
            .slice(0, 2);
          return { results: matches as T[] };
        }
        throw new Error(`unexpected all(): ${text}`);
      },
      async run() {
        if (text.startsWith("INSERT INTO kosync_progress")) {
          const [
            document,
            filename,
            title,
            authors,
            progress,
            percentage,
            device,
            deviceId,
            updatedAt,
          ] = args as [
            string,
            string | null,
            string | null,
            string | null,
            string,
            number,
            string,
            string | null,
            number,
          ];
          const existing = rows.get(document);
          rows.set(document, {
            document,
            filename: filename ?? existing?.filename ?? null,
            title: title ?? existing?.title ?? null,
            authors: authors ?? existing?.authors ?? null,
            progress,
            percentage,
            device,
            device_id: deviceId ?? existing?.device_id ?? null,
            updated_at: updatedAt,
          });
          return {};
        }
        if (text.startsWith("UPDATE kosync_progress")) {
          const [
            progress,
            percentage,
            device,
            updatedAt,
            document,
            baseUpdatedAt,
          ] = args as [string, number, string, number, string, number];
          const existing = rows.get(document);
          if (!existing || existing.updated_at > baseUpdatedAt) {
            return { meta: { changes: 0 } };
          }
          rows.set(document, {
            ...existing,
            progress,
            percentage,
            device,
            device_id: null,
            updated_at: updatedAt,
          });
          return { meta: { changes: 1 } };
        }
        throw new Error(`unexpected run(): ${text}`);
      },
    };
    return stmt;
  }

  return { prepare: statement, rows } satisfies D1Like & {
    rows: Map<string, Row>;
  };
}

const makeEnv = (db: D1Like): Env => ({
  OPENCODE_API_KEY: "zen",
  APP_TOKEN: "app",
  KOSYNC_USER: "quiosco",
  KOSYNC_KEY: PASSWORD_KEY,
  BUDGET: { get: async () => null, put: async () => {} },
  ASSETS: { fetch: async () => new Response("shell") },
  ALLOWED_MODELS: "deepseek-v4.1-flash",
  DAILY_CHUNK_BUDGET: "200",
  DB: db,
});

function request(
  method: string,
  path: string,
  options: { body?: unknown; auth?: boolean } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.auth !== false) Object.assign(headers, AUTH);
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`https://app.example/kosync${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

const progressBody = (overrides: Record<string, unknown> = {}) => ({
  document: "0123456789abcdef0123456789abcdef",
  progress: "/body/DocFragment[2]/body/p[1]/text().4",
  percentage: 0.42,
  device: "PocketBook",
  device_id: "device-1",
  metadata: {
    filename: "El principito.epub",
    title: "El principito",
    authors: "Antoine de Saint-Exupéry",
  },
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleKosync", () => {
  it("answers health checks without credentials", async () => {
    const response = await handleKosync(
      new Request("https://app.example/kosync/healthcheck"),
      makeEnv(fakeDb()),
      new URL("https://app.example/kosync/healthcheck"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "OK" });
  });

  it("registers the one configured account idempotently", async () => {
    const env = makeEnv(fakeDb());
    const create = () =>
      handleKosync(
        request("POST", "/users/create", {
          auth: false,
          body: { username: "quiosco", password: PASSWORD_KEY },
        }),
        env,
        new URL("https://app.example/kosync/users/create"),
      );

    const first = await create();
    expect(first.status).toBe(201);
    await expect(first.json()).resolves.toEqual({ username: "quiosco" });
    expect((await create()).status).toBe(201);
  });

  it("rejects unknown users and a wrong registration key", async () => {
    const env = makeEnv(fakeDb());
    const unknown = await handleKosync(
      request("POST", "/users/create", {
        auth: false,
        body: { username: "someone-else", password: PASSWORD_KEY },
      }),
      env,
      new URL("https://app.example/kosync/users/create"),
    );
    expect(unknown.status).toBe(402);
    await expect(unknown.json()).resolves.toMatchObject({ code: 2005 });

    const wrongKey = await handleKosync(
      request("POST", "/users/create", {
        auth: false,
        body: { username: "quiosco", password: "not-the-key" },
      }),
      env,
      new URL("https://app.example/kosync/users/create"),
    );
    expect(wrongKey.status).toBe(402);
    await expect(wrongKey.json()).resolves.toMatchObject({ code: 2002 });
  });

  it("disables registration when the account is not configured", async () => {
    const env = makeEnv(fakeDb());
    env.KOSYNC_KEY = undefined;
    const response = await handleKosync(
      request("POST", "/users/create", {
        auth: false,
        body: { username: "quiosco", password: PASSWORD_KEY },
      }),
      env,
      new URL("https://app.example/kosync/users/create"),
    );
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ code: 2005 });
  });

  it("authorizes only the configured key", async () => {
    const env = makeEnv(fakeDb());
    const ok = await handleKosync(
      request("GET", "/users/auth"),
      env,
      new URL("https://app.example/kosync/users/auth"),
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ authorized: "OK" });

    const bad = await handleKosync(
      new Request("https://app.example/kosync/users/auth", {
        headers: { "x-auth-user": "quiosco", "x-auth-key": "nope" },
      }),
      env,
      new URL("https://app.example/kosync/users/auth"),
    );
    expect(bad.status).toBe(401);
    await expect(bad.json()).resolves.toMatchObject({ code: 2001 });
  });

  it("requires auth on progress reads and writes", async () => {
    const env = makeEnv(fakeDb());
    const put = await handleKosync(
      request("PUT", "/syncs/progress", {
        auth: false,
        body: progressBody(),
      }),
      env,
      new URL("https://app.example/kosync/syncs/progress"),
    );
    expect(put.status).toBe(401);

    const get = await handleKosync(
      request("GET", "/syncs/progress/abc", { auth: false }),
      env,
      new URL("https://app.example/kosync/syncs/progress/abc"),
    );
    expect(get.status).toBe(401);
  });

  it("stores a push and returns it with a server timestamp in seconds", async () => {
    const db = fakeDb();
    const env = makeEnv(db);
    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);

    const put = await handleKosync(
      request("PUT", "/syncs/progress", { body: progressBody() }),
      env,
      new URL("https://app.example/kosync/syncs/progress"),
    );
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toEqual({
      document: "0123456789abcdef0123456789abcdef",
      timestamp: 1_760_000_000,
    });

    const get = await handleKosync(
      request("GET", "/syncs/progress/0123456789abcdef0123456789abcdef"),
      env,
      new URL(
        "https://app.example/kosync/syncs/progress/0123456789abcdef0123456789abcdef",
      ),
    );
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toEqual({
      document: "0123456789abcdef0123456789abcdef",
      percentage: 0.42,
      progress: "/body/DocFragment[2]/body/p[1]/text().4",
      device: "PocketBook",
      timestamp: 1_760_000_000,
      device_id: "device-1",
    });
  });

  it("returns an empty object for an unknown document", async () => {
    const response = await handleKosync(
      request("GET", "/syncs/progress/ffffffffffffffffffffffffffffffff"),
      makeEnv(fakeDb()),
      new URL(
        "https://app.example/kosync/syncs/progress/ffffffffffffffffffffffffffffffff",
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
  });

  it("preserves progress as the string KOReader sent", async () => {
    const db = fakeDb();
    const env = makeEnv(db);
    await handleKosync(
      request("PUT", "/syncs/progress", {
        body: progressBody({ progress: "56" }),
      }),
      env,
      new URL("https://app.example/kosync/syncs/progress"),
    );
    const row = db.rows.get("0123456789abcdef0123456789abcdef");
    expect(row?.progress).toBe("56");
  });

  it("clamps a percentage outside the protocol range instead of failing", async () => {
    const db = fakeDb();
    const env = makeEnv(db);
    const response = await handleKosync(
      request("PUT", "/syncs/progress", {
        body: progressBody({ percentage: 1.5 }),
      }),
      env,
      new URL("https://app.example/kosync/syncs/progress"),
    );
    expect(response.status).toBe(200);
    expect(db.rows.get("0123456789abcdef0123456789abcdef")?.percentage).toBe(1);
  });

  it("keeps metadata and device_id when a later push omits them", async () => {
    const db = fakeDb();
    const env = makeEnv(db);
    await handleKosync(
      request("PUT", "/syncs/progress", { body: progressBody() }),
      env,
      new URL("https://app.example/kosync/syncs/progress"),
    );
    await handleKosync(
      request("PUT", "/syncs/progress", {
        body: progressBody({
          percentage: 0.55,
          metadata: undefined,
          device_id: undefined,
        }),
      }),
      env,
      new URL("https://app.example/kosync/syncs/progress"),
    );

    const row = db.rows.get("0123456789abcdef0123456789abcdef");
    expect(row).toMatchObject({
      filename: "El principito.epub",
      title: "El principito",
      authors: "Antoine de Saint-Exupéry",
      percentage: 0.55,
      device_id: "device-1",
    });

    const lookup = await handleKosyncLookup(
      new Request(
        "https://app.example/api/kosync/progress?filename=El%20principito.epub",
      ),
      env,
    );
    await expect(lookup.json()).resolves.toMatchObject({
      progress: {
        document: "0123456789abcdef0123456789abcdef",
        percentage: 0.55,
      },
    });
  });

  it("rejects invalid progress bodies", async () => {
    const env = makeEnv(fakeDb());
    const cases: Array<[unknown, number, number]> = [
      [progressBody({ document: undefined }), 403, 2004],
      [progressBody({ document: "a:b" }), 403, 2004],
      [progressBody({ percentage: undefined }), 403, 2003],
      [progressBody({ progress: 56 }), 403, 2003],
      [progressBody({ device: "" }), 403, 2003],
    ];
    for (const [body, status, code] of cases) {
      const response = await handleKosync(
        request("PUT", "/syncs/progress", { body }),
        env,
        new URL("https://app.example/kosync/syncs/progress"),
      );
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ code });
    }
  });

  it("rejects malformed JSON with the protocol framework codes", async () => {
    const env = makeEnv(fakeDb());
    const malformed = await handleKosync(
      new Request("https://app.example/kosync/syncs/progress", {
        method: "PUT",
        headers: AUTH,
        body: "{",
      }),
      env,
      new URL("https://app.example/kosync/syncs/progress"),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ code: 103 });

    const array = await handleKosync(
      new Request("https://app.example/kosync/syncs/progress", {
        method: "PUT",
        headers: AUTH,
        body: "[]",
      }),
      env,
      new URL("https://app.example/kosync/syncs/progress"),
    );
    expect(array.status).toBe(400);
    await expect(array.json()).resolves.toMatchObject({ code: 104 });
  });

  it("normalizes /kosync base paths and duplicated slashes", async () => {
    const response = await handleKosync(
      request("GET", "/users/auth"),
      makeEnv(fakeDb()),
      new URL("https://app.example/kosync//users/auth"),
    );
    expect(response.status).toBe(200);
  });
});

describe("handleKosyncLookup", () => {
  async function envWithRow(db: ReturnType<typeof fakeDb>) {
    const env = makeEnv(db);
    await handleKosync(
      request("PUT", "/syncs/progress", { body: progressBody() }),
      env,
      new URL("https://app.example/kosync/syncs/progress"),
    );
    return env;
  }

  const lookup = (env: Env, query: string) =>
    handleKosyncLookup(
      new Request(`https://app.example/api/kosync/progress?${query}`),
      env,
    );

  it("matches a filename case-insensitively", async () => {
    const env = await envWithRow(fakeDb());
    const response = await lookup(env, "filename=el%20PRINCIPITO.epub");
    const body = (await response.json()) as {
      progress: { document: string; filename: string | null } | null;
    };
    expect(body.progress?.document).toBe("0123456789abcdef0123456789abcdef");
    expect(body.progress?.filename).toBe("El principito.epub");
  });

  it("falls back to title and author, then to a unique title", async () => {
    const env = await envWithRow(fakeDb());
    const withAuthor = await lookup(
      env,
      "title=El%20principito&author=Antoine%20de%20Saint-Exup%C3%A9ry",
    );
    expect(
      ((await withAuthor.json()) as { progress: unknown }).progress,
    ).not.toBeNull();

    const titleOnly = await lookup(env, "title=El%20principito");
    expect(
      ((await titleOnly.json()) as { progress: unknown }).progress,
    ).not.toBe(null);
  });

  it("refuses an ambiguous title", async () => {
    const db = fakeDb();
    const env = makeEnv(db);
    for (const document of ["a".repeat(32), "b".repeat(32)]) {
      await handleKosync(
        request("PUT", "/syncs/progress", {
          body: progressBody({ document, metadata: { title: "Same title" } }),
        }),
        env,
        new URL("https://app.example/kosync/syncs/progress"),
      );
    }
    const response = await lookup(env, "title=Same%20title");
    await expect(response.json()).resolves.toEqual({ progress: null });
  });

  it("returns null when nothing matches and rejects an empty identity", async () => {
    const env = makeEnv(fakeDb());
    await expect(
      (await lookup(env, "filename=unknown.epub")).json(),
    ).resolves.toEqual({ progress: null });
    expect((await lookup(env, "")).status).toBe(400);
  });

  it("returns null when the bridge is not configured", async () => {
    const env = await envWithRow(fakeDb());
    env.KOSYNC_USER = undefined;
    await expect(
      (await lookup(env, "filename=El%20principito.epub")).json(),
    ).resolves.toEqual({ progress: null });
  });
});

describe("handleKosyncPush", () => {
  const filename = "Libro-bilingual.epub";
  const document = "0123456789abcdef0123456789abcdef";
  const pointer = "/body/DocFragment[2]/body/p[1]/br[1].0";
  const at = 1_760_000_000;
  const body = (overrides: Record<string, unknown> = {}) => ({
    document,
    filename,
    progress: pointer,
    percentage: 0.42,
    baseUpdatedAt: at,
    ...overrides,
  });
  const push = (env: Env, payload: Record<string, unknown> = body()) =>
    handleKosyncPush(
      new Request("https://app.example/api/kosync/push", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      env,
    );

  async function envWithRow() {
    const db = fakeDb();
    const env = makeEnv(db);
    vi.spyOn(Date, "now").mockReturnValue(at * 1000);
    await handleKosync(
      request("PUT", "/syncs/progress", {
        body: progressBody({
          metadata: {
            filename,
            title: "Libro",
            authors: "Autora",
          },
        }),
      }),
      env,
      new URL("https://app.example/kosync/syncs/progress"),
    );
    return { db, env };
  }

  it("stays disabled without both kosync secrets", async () => {
    const env = makeEnv(fakeDb());
    env.KOSYNC_KEY = undefined;
    const response = await push(env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pushed: false,
      reason: "disabled",
    });
  });

  it("refuses files that are not exact bilingual exports", async () => {
    const { env } = await envWithRow();
    await expect(
      (await push(env, body({ filename: "Libro.epub" }))).json(),
    ).resolves.toEqual({ pushed: false, reason: "not-exact" });
    await expect(
      (await push(env, body({ document: "f".repeat(32) }))).json(),
    ).resolves.toEqual({ pushed: false, reason: "unlinked" });
  });

  it("accepts a versioned local export and writes its linked document", async () => {
    const { db, env } = await envWithRow();
    vi.spyOn(Date, "now").mockReturnValue((at + 10) * 1000);

    const response = await push(
      env,
      body({ filename: "Libro-bilingual-v5.epub" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      pushed: true,
      document,
    });
    expect(db.rows.get(document)).toMatchObject({
      filename,
      progress: pointer,
      device: "Quiosco",
    });
  });

  it("rejects malformed positions, percentages, and bases", async () => {
    const { env } = await envWithRow();
    const cases = [
      body({ filename: undefined }),
      body({ document: undefined }),
      body({ document: "a:b" }),
      body({ progress: "56" }),
      body({ progress: "/body/DocFragment[2]/body/p[1]/text().0" }),
      body({ percentage: 1.5 }),
      body({ percentage: Number.NaN }),
      body({ baseUpdatedAt: -1 }),
      body({ baseUpdatedAt: 1.5 }),
      body({ baseUpdatedAt: undefined }),
    ];
    for (const payload of cases) {
      const response = await push(env, payload);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "bad request" });
    }
  });

  it("updates the row, preserves metadata, and marks the app as device", async () => {
    const { db, env } = await envWithRow();
    vi.spyOn(Date, "now").mockReturnValue((at + 10) * 1000);

    const response = await push(env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pushed: true,
      document,
      updatedAt: at + 10,
    });

    expect(db.rows.get(document)).toEqual({
      document,
      filename,
      title: "Libro",
      authors: "Autora",
      progress: pointer,
      percentage: 0.42,
      device: "Quiosco",
      device_id: null,
      updated_at: at + 10,
    });

    const lookup = await handleKosyncLookup(
      new Request(
        `https://app.example/api/kosync/progress?filename=${encodeURIComponent(filename)}`,
      ),
      env,
    );
    await expect(lookup.json()).resolves.toMatchObject({
      progress: {
        document,
        filename,
        progress: pointer,
        device: "Quiosco",
        updatedAt: at + 10,
      },
    });
  });

  it("never overwrites a position KOReader pushed after the app's read", async () => {
    const { db, env } = await envWithRow();
    vi.spyOn(Date, "now").mockReturnValue((at + 10) * 1000);

    const response = await push(env, body({ baseUpdatedAt: at - 1 }));
    await expect(response.json()).resolves.toEqual({
      pushed: false,
      reason: "stale",
    });
    expect(db.rows.get(document)).toMatchObject({
      progress: "/body/DocFragment[2]/body/p[1]/text().4",
      device: "PocketBook",
      updated_at: at,
    });
  });

  it("recovers a retry whose timed-out write already committed", async () => {
    const { env } = await envWithRow();
    vi.spyOn(Date, "now").mockReturnValue((at + 10) * 1000);
    await push(env);

    // The client timed out before receiving updatedAt, so it retries with the
    // old base. The row already holds this exact pointer: adopt its timestamp.
    const retry = await push(env, body({ baseUpdatedAt: at }));
    await expect(retry.json()).resolves.toEqual({
      pushed: true,
      document,
      updatedAt: at + 10,
    });

    // A different position with the same old base is still a real stale case.
    const moved = await push(
      env,
      body({
        progress: "/body/DocFragment[1]/body/p[2]/br[1].0",
        baseUpdatedAt: at,
      }),
    );
    await expect(moved.json()).resolves.toEqual({
      pushed: false,
      reason: "stale",
    });

    // The same pointer with a different percentage is not the same write.
    const wrongPercentage = await push(
      env,
      body({ percentage: 0.5, baseUpdatedAt: at }),
    );
    await expect(wrongPercentage.json()).resolves.toEqual({
      pushed: false,
      reason: "stale",
    });
  });

  it("allows consecutive pushes once the base follows the last response", async () => {
    const { env } = await envWithRow();
    vi.spyOn(Date, "now").mockReturnValue((at + 10) * 1000);
    const first = await push(env);
    await expect(first.json()).resolves.toMatchObject({ pushed: true });

    vi.spyOn(Date, "now").mockReturnValue((at + 20) * 1000);
    const second = await push(
      env,
      body({
        progress: "/body/DocFragment[2]/body/p[2]/br[1].0",
        baseUpdatedAt: at + 10,
      }),
    );
    await expect(second.json()).resolves.toEqual({
      pushed: true,
      document,
      updatedAt: at + 20,
    });
  });
});
