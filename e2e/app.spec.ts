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

  await page.getByRole("button", { name: "Mark unread" }).click();
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
