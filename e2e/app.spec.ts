import { expect, type Page, test } from "@playwright/test";

async function waitForServiceWorker(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return true;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test("html document carries CSP and nosniff", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain(
    "default-src 'self'",
  );
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
});

test("api requires the bearer token", async ({ request }) => {
  expect((await request.get("/api/health")).status()).toBe(401);
  const authed = await request.get("/api/health", {
    headers: { Authorization: "Bearer e2e-token" },
  });
  expect(authed.status()).toBe(200);
});

test("share target POST handoff lands on the review screen with the shared text", async ({
  page,
}) => {
  await waitForServiceWorker(page);
  const longText = Array.from(
    { length: 20 },
    (_, index) =>
      `Párrafo ${index} del artículo compartido manualmente con suficiente longitud para el modo texto.`,
  ).join("\n\n");
  // The production flow is an OS-initiated POST to /share, which the service
  // worker intercepts. The app's CSP has `form-action 'none'` (global
  // constraint), so an in-page <form> submit would be blocked; a same-origin
  // fetch with a FormData body hits the identical service-worker route.
  await page.evaluate(async (text) => {
    const formData = new FormData();
    formData.set("title", "Un titular");
    formData.set("text", text);
    formData.set("url", "");
    await fetch("/share", { method: "POST", body: formData });
  }, longText);
  await page.goto("/share");
  await page.waitForURL("**/add");
  await expect(page.locator("textarea")).toHaveValue(/Párrafo 19/);
});

test("Chrome reader share replaces the garbage title from the body", async ({
  page,
}) => {
  // Force the LLM title guess to fail so save falls back to the body headline.
  await page.route("**/api/translate**", async (route) => {
    await route.fulfill({ status: 500, body: "unavailable" });
  });
  await waitForServiceWorker(page);
  await page.goto("/settings");
  await page.getByLabel("App token").fill("e2e-token");
  await page.getByLabel("Translate automatically after saving").uncheck();
  await page.getByRole("button", { name: "Save" }).click();

  const headline =
    "La estación de metro con más viajeros en Valencia: más de 500.000 pasajeros en un mes";
  const body = [
    headline,
    ...Array.from(
      { length: 8 },
      (_, index) =>
        `Párrafo ${index + 1} del artículo compartido manualmente con suficiente longitud para el modo texto.`,
    ),
  ].join("\n\n");

  await page.evaluate(async (text) => {
    const formData = new FormData();
    formData.set(
      "title",
      "Including link: chrome-distiller://1712e844-db8f-4213-8dcb-ffe7c19a89ee_abc/",
    );
    formData.set("text", text);
    formData.set("url", "");
    await fetch("/share", { method: "POST", body: formData });
  }, body);

  await page.goto("/share");
  await page.waitForURL("**/add");
  // Prefill must not keep the chrome-distiller artifact in the title field.
  await expect(page.getByLabel("Title")).toHaveValue("");
  await page.getByRole("button", { name: "Save & translate" }).click();
  await page.waitForURL("**/article/**");
  await expect(page.getByRole("heading", { name: headline })).toBeVisible();
});

test("URL-only share fetches the article instead of saving the shared URL", async ({
  page,
}) => {
  const paragraph =
    "El Ayuntamiento de Valencia notificó una población de 858.178 residentes a 1 de enero de 2026, según los datos del padrón municipal continuo.";
  await page.route("**/api/fetch**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: {
        "x-quiosco-via": "direct",
        "x-quiosco-final-url": "https://example.com/noticia",
      },
      body: `<!doctype html><html><head><title>Prueba URL</title></head><body><article><h1>Prueba URL</h1><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`,
    });
  });
  await page.route("**/api/decide**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ answers: {} }),
    });
  });

  await waitForServiceWorker(page);
  await page.goto("/settings");
  await page.getByLabel("App token").fill("e2e-token");
  await page.getByLabel("Translate automatically after saving").uncheck();
  await page.getByRole("button", { name: "Save" }).click();

  const url =
    "https://example.com/noticia-con-un-titulo-largo-para-superar-el-minimo";
  // Chrome repeats the shared URL in the text field for a URL-only share.
  await page.evaluate(async (sharedUrl) => {
    const formData = new FormData();
    formData.set("title", "");
    formData.set("text", sharedUrl);
    formData.set("url", sharedUrl);
    await fetch("/share", { method: "POST", body: formData });
  }, url);

  await page.goto("/share");
  await page.waitForURL("**/add");
  // The shared URL must never be treated as article text.
  await expect(page.getByLabel("Article text")).not.toHaveValue(url);
  await expect(page.getByLabel("Article text")).toHaveValue(/858\.178/);
});

test("back from a just-saved shared article returns to the list", async ({
  page,
}) => {
  const paragraph =
    "El Ayuntamiento de Valencia notificó una población de 858.178 residentes a 1 de enero de 2026, según los datos del padrón municipal continuo.";
  await page.route("**/api/fetch**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: {
        "x-quiosco-via": "direct",
        "x-quiosco-final-url": "https://example.com/noticia",
      },
      body: `<!doctype html><html><head><title>Prueba URL</title></head><body><article><h1>Prueba URL</h1><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`,
    });
  });
  await page.route("**/api/decide**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ answers: {} }),
    });
  });

  await waitForServiceWorker(page);
  await page.goto("/settings");
  await page.getByLabel("App token").fill("e2e-token");
  await page.getByLabel("Translate automatically after saving").uncheck();
  await page.getByRole("button", { name: "Save" }).click();

  // The list is the screen the user expects Back to land on.
  await page.goto("/");
  const url = "https://example.com/otra-noticia-larga-para-superar-el-minimo";
  await page.evaluate(async (sharedUrl) => {
    const formData = new FormData();
    formData.set("title", "");
    formData.set("text", sharedUrl);
    formData.set("url", sharedUrl);
    await fetch("/share", { method: "POST", body: formData });
  }, url);

  await page.goto("/share");
  await page.waitForURL("**/add");
  await expect(page.getByLabel("Article text")).toHaveValue(/858\.178/);
  await page.getByRole("button", { name: "Save & translate" }).click();
  await page.waitForURL("**/article/**");

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "+ Add" })).toBeVisible();
});

test("manual add, read/archive lifecycle, delete", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("App token").fill("e2e-token");
  await page.getByLabel("Translate automatically after saving").uncheck();
  await page.getByRole("button", { name: "Save" }).click();

  await page.goto("/add");
  await page.getByLabel("Title").fill("Prueba E2E");
  const paragraphs = Array.from(
    { length: 3 },
    (_, index) =>
      `Párrafo ${index} con contenido de prueba suficientemente largo para pasar cualquier validación.`,
  ).join("\n\n");
  await page.getByLabel("Article text").fill(paragraphs);
  await page.getByRole("button", { name: "Save & translate" }).click();

  await page.waitForURL("**/article/**");
  await expect(page.getByRole("heading", { name: "Prueba E2E" })).toBeVisible();
  await expect(page.getByText("No translation yet.")).toBeVisible();

  // Opening no longer marks the article read; the end-of-article CTA does.
  await page.getByRole("button", { name: "Mark as read" }).click();
  await expect(page.getByRole("button", { name: "Mark unread" })).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("button", { name: "Unarchive" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: /^archived \(1\)$/ }).click();
  await page.getByRole("link", { name: /Prueba E2E/ }).click();
  await page.waitForURL("**/article/**");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await page.waitForURL((url) => url.pathname === "/");
});

test("settings connection check reflects the worker auth", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("App token").fill("wrong-token");
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByText("Not connected")).toBeVisible();
  await page.getByLabel("App token").fill("e2e-token");
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByText("Connected")).toBeVisible();
});

test("adds an article by URL from the web form", async ({ page }) => {
  const paragraph =
    "El Ayuntamiento de Valencia notificó una población de 858.178 residentes a 1 de enero de 2026, según los datos del padrón municipal continuo.";
  await page.route("**/api/fetch**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: {
        "x-quiosco-via": "direct",
        "x-quiosco-final-url": "https://example.com/noticia",
      },
      body: `<!doctype html><html><head><title>Prueba URL</title></head><body><article><h1>Prueba URL</h1><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`,
    });
  });

  await page.goto("/settings");
  await page.getByLabel("App token").fill("e2e-token");
  await page.getByLabel("Translate automatically after saving").uncheck();
  await page.getByRole("button", { name: "Save" }).click();

  await page.goto("/add");
  await page.getByLabel("Source URL").fill("https://example.com/noticia");
  await page.getByRole("button", { name: "Save & translate" }).click();

  await page.waitForURL("**/article/**");
  await expect(page.getByRole("heading", { name: "Prueba URL" })).toBeVisible();
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await expect(page.getByText(/858\.178 residentes/).first()).toBeVisible();
});

test("restores the article scroll position after a reload", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("App token").fill("e2e-token");
  await page.getByLabel("Translate automatically after saving").uncheck();
  await page.getByRole("button", { name: "Save" }).click();

  await page.goto("/add");
  await page.getByLabel("Title").fill("Scroll prueba");
  const paragraphs = Array.from(
    { length: 40 },
    (_, index) =>
      `Párrafo ${index} con contenido de prueba suficientemente largo para que la página sea desplazable y se pueda recordar la posición de lectura.`,
  ).join("\n\n");
  await page.getByLabel("Article text").fill(paragraphs);
  await page.getByRole("button", { name: "Save & translate" }).click();
  await page.waitForURL("**/article/**");

  await page.getByRole("button", { name: "Original", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(800); // let the throttled save land
  await page.reload();

  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
    .toBeGreaterThan(900);
  await expect(
    page.getByRole("button", { name: "Original", exact: true }),
  ).toHaveClass(/active/);

  // The SPA flow (list, open, back, reopen) must keep the position too.
  await page.goto("/");
  await page.getByRole("link", { name: /Scroll prueba/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
    .toBeGreaterThan(900);
  await page.goBack();
  await page.getByRole("link", { name: /Scroll prueba/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
    .toBeGreaterThan(900);
});

test("syncs an article between two devices", async ({ browser }) => {
  const title = `Prueba sync ${Date.now()}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  for (const page of [pageA, pageB]) {
    await page.goto("/settings");
    await page.getByLabel("App token").fill("e2e-token");
    await page.getByLabel("Translate automatically after saving").uncheck();
    await page.getByRole("button", { name: "Save" }).click();
  }

  await pageA.goto("/add");
  await pageA.getByLabel("Title").fill(title);
  await pageA
    .getByLabel("Article text")
    .fill(
      "Primer párrafo de prueba con la longitud mínima necesaria para guardar el artículo.\n\nSegundo párrafo del artículo de prueba.",
    );
  await pageA.getByRole("button", { name: "Save & translate" }).click();
  await pageA.waitForURL("**/article/**");

  await pageA.goto("/settings");
  await pageA.getByRole("button", { name: "Sync now" }).click();
  await expect(pageA.getByText(/Synced —/)).toBeVisible();

  await pageB.goto("/settings");
  await pageB.getByRole("button", { name: "Sync now" }).click();
  await expect(pageB.getByText(/Synced —/)).toBeVisible();
  await pageB.goto("/");
  await expect(
    pageB.getByRole("link", { name: new RegExp(title) }),
  ).toBeVisible();

  // Delete on B and verify the tombstone propagates back to A.
  await pageB.getByRole("link", { name: new RegExp(title) }).click();
  await pageB.waitForURL("**/article/**");
  pageB.on("dialog", (dialog) => dialog.accept());
  await pageB.getByRole("button", { name: "Delete" }).click();
  await pageB.waitForURL((url) => url.pathname === "/");

  await pageB.goto("/settings");
  await pageB.getByRole("button", { name: "Sync now" }).click();
  await expect(pageB.getByText(/Synced —/)).toBeVisible();

  await pageA.goto("/settings");
  await pageA.getByRole("button", { name: "Sync now" }).click();
  await expect(pageA.getByText(/Synced —/)).toBeVisible();
  await pageA.goto("/");
  await expect(
    pageA.getByRole("link", { name: new RegExp(title) }),
  ).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});
