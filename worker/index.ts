import { extractBearer, originAllowed, tokensMatch } from "./auth";
import type { Env } from "./env";
import { handleFetchRung } from "./fetchRung";
import { applySecurityHeaders, jsonResponse } from "./headers";
import { handleSync } from "./sync";
import { handleTranslate } from "./translate";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/share") {
    // The share POST normally lands in the service worker, which stores the
    // payload locally and redirects. This path only triggers before the
    // service worker is active (first run): never read or store the body.
    return applySecurityHeaders(
      Response.redirect(new URL("/share", url.origin).toString(), 303),
    );
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, env, url);
  }

  return applySecurityHeaders(await env.ASSETS.fetch(request));
}

async function handleApi(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const token = extractBearer(request);
  const authorized =
    token !== null && (await tokensMatch(token, env.APP_TOKEN));
  if (!authorized) {
    return applySecurityHeaders(jsonResponse({ error: "unauthorized" }, 401), {
      noStore: true,
    });
  }
  if (!originAllowed(request)) {
    return applySecurityHeaders(jsonResponse({ error: "forbidden" }, 403), {
      noStore: true,
    });
  }

  let response: Response;
  if (url.pathname === "/api/health" && request.method === "GET") {
    response = jsonResponse({ ok: true });
  } else if (url.pathname === "/api/fetch" && request.method === "GET") {
    response = await handleFetchRung(request, env);
  } else if (url.pathname === "/api/translate" && request.method === "POST") {
    response = await handleTranslate(request, env);
  } else if (url.pathname === "/api/sync" && request.method === "POST") {
    response = await handleSync(request, env);
  } else {
    response = jsonResponse({ error: "not found" }, 404);
  }
  return applySecurityHeaders(response, { noStore: true });
}
