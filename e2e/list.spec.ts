import { expect, type Page, test } from "@playwright/test";

/** Seed the same local IndexedDB the app opens, so the list renders at once. */
async function seedArticle(
  page: Page,
  id: string,
  title: string,
  status = "unread",
) {
  await page.goto("/");
  await page.evaluate(
    async ({ id, title, status }) => {
      const article = {
        id,
        url: null,
        title,
        site: null,
        text: "Texto de prueba de la lista con longitud suficiente.",
        via: "manual",
        translation: null,
        translationStatus: "done",
        translatedChunks: 1,
        totalChunks: 1,
        status,
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("quiosco", 3);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("articles")) {
            const store = db.createObjectStore("articles", { keyPath: "id" });
            store.createIndex("createdAt", "createdAt");
            store.createIndex("url", "url");
          }
          if (!db.objectStoreNames.contains("positions")) {
            db.createObjectStore("positions", { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains("sentences")) {
            db.createObjectStore("sentences", { keyPath: "key" });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("articles", "readwrite");
          tx.objectStore("articles").put(article);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { id, title, status },
  );
}

test("left swipe on an article reveals a Delete quick action", async ({
  page,
}) => {
  await seedArticle(page, "list-swipe", "Prueba Swipe");
  await page.reload();

  const row = page.getByRole("link", { name: /Prueba Swipe/ });
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  if (!box) throw new Error("missing row box");

  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 16, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 130, y, { steps: 8 });
  await page.mouse.up();

  const del = page.getByRole("button", { name: "Delete Prueba Swipe" });
  await expect(del).toBeVisible();
  // The swipe itself must never follow the row link.
  await expect(page).toHaveURL(/\/$/);

  page.on("dialog", (dialog) => dialog.accept());
  await del.click();
  await expect(page.getByRole("link", { name: /Prueba Swipe/ })).toHaveCount(0);
});

test("tapping an open row closes it without following the link", async ({
  page,
}) => {
  await seedArticle(page, "list-close", "Prueba Cerrar");
  await page.reload();

  const row = page.getByRole("link", { name: /Prueba Cerrar/ });
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  if (!box) throw new Error("missing row box");

  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 16, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 130, y, { steps: 8 });
  await page.mouse.up();

  const actions = page.locator(".article-swipe-actions");
  await expect(actions).not.toHaveAttribute("inert");

  await row.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(actions).toHaveAttribute("inert");
});

test("a plain tap on an article row still opens it", async ({ page }) => {
  await seedArticle(page, "list-tap", "Prueba Tap");
  await page.reload();

  await page.getByRole("link", { name: /Prueba Tap/ }).click();
  await page.waitForURL("**/article/list-tap");
});
