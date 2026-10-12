import { expect, type Page, test } from "@playwright/test";

const PARAGRAPHS = [
  "Párrafo uno del artículo de prueba para el modo Zen, con longitud suficiente.",
  "Párrafo dos del artículo de prueba para el modo Zen, con longitud suficiente.",
  "Párrafo tres del artículo de prueba para el modo Zen, con longitud suficiente.",
];

/**
 * Seeding a finished article directly is the only hermetic way to reach Zen:
 * the translation phase needs the Zen API, which e2e stubs out. The app opens
 * the same IndexedDB ("quiosco", v2), so the stores already exist and this
 * upgrade handler is a no-op.
 */
async function seedDoneArticle(page: Page, id: string, status = "unread") {
  await page.goto("/");
  await page.evaluate(
    async ({ id, paragraphs, status }) => {
      const article = {
        id,
        url: null,
        title: "Prueba Zen",
        site: null,
        text: paragraphs.join("\n\n"),
        via: "manual",
        translation: paragraphs.join("\n\n"),
        translationStatus: "done",
        translatedChunks: 1,
        totalChunks: 1,
        status,
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("quiosco", 2);
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
    { id, paragraphs: PARAGRAPHS, status },
  );
}

test("zen swipe works outside the paragraph text", async ({ page }) => {
  await seedDoneArticle(page, "zen-swipe-screen");
  await page.goto("/article/zen-swipe-screen");

  const bar = page.getByRole("progressbar", { name: "Article progress" });
  await expect(bar).toHaveAttribute("aria-valuenow", "1");

  // Drag in the left margin — outside the paragraph — to go to page 2.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("missing viewport");
  const x = 12;
  const y = Math.floor(viewport.height / 2);
  const swipeDistancePx = 80;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - swipeDistancePx, { steps: 5 });
  await page.mouse.up();

  await expect(bar).toHaveAttribute("aria-valuenow", "2");
  await expect(bar.getByText("2/3", { exact: true })).toBeVisible();
});

test("zen progress line tracks the current paragraph", async ({ page }) => {
  await seedDoneArticle(page, "zen-progress");
  await page.goto("/article/zen-progress");

  const bar = page.getByRole("progressbar", { name: "Article progress" });
  const fill = page.locator(".zen-progress-fill");
  const more = page.getByRole("button", { name: "More article actions" });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("aria-valuenow", "1");
  await expect(bar).toHaveAttribute("aria-valuemax", "3");
  await expect(bar.getByText("1/3", { exact: true })).toBeVisible();
  await expect(fill).toHaveAttribute("style", /width:\s*33\.3/);

  // ⋯ sits on the progress row, to the right of the meter.
  await expect(more).toBeVisible();
  const meterBox = await page.locator(".zen-progress-meter").boundingBox();
  const moreBox = await more.boundingBox();
  if (!meterBox || !moreBox) throw new Error("missing bounding boxes");
  expect(moreBox.x).toBeGreaterThanOrEqual(meterBox.x + meterBox.width);
  expect(Math.abs(moreBox.y - meterBox.y)).toBeLessThan(24);

  // Count lives in the top chrome, not inside the paragraph.
  await expect(page.locator(".zen-pane .para-index")).toHaveCount(0);

  await page.keyboard.press("ArrowDown");
  await expect(bar.getByText("2/3", { exact: true })).toBeVisible();
  await expect(bar).toHaveAttribute("aria-valuenow", "2");
  await expect(fill).toHaveAttribute("style", /width:\s*66\.6/);

  await page.keyboard.press("ArrowDown");
  await expect(bar.getByText("3/3", { exact: true })).toBeVisible();
  await expect(bar).toHaveAttribute("aria-valuenow", "3");
  await expect(fill).toHaveAttribute("style", /width:\s*100%/);
});

test("zen end block archives below the article text and returns to the list", async ({
  page,
}) => {
  await seedDoneArticle(page, "zen-archive");
  await page.goto("/article/zen-archive");

  const archive = page.getByRole("button", { name: "Archive", exact: true });
  await expect(archive).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toBeVisible();

  // The block sits below the article text.
  const paraBox = await page.locator(".zen-pane .para").boundingBox();
  const blockBox = await page.locator(".zen-end").boundingBox();
  if (!paraBox || !blockBox) throw new Error("missing bounding boxes");
  expect(blockBox.y).toBeGreaterThanOrEqual(paraBox.y + paraBox.height);

  await archive.click();
  await page.waitForURL((url) => url.pathname === "/");
});

test("zen end block hides between the first and last page", async ({
  page,
}) => {
  await seedDoneArticle(page, "zen-pages");
  await page.goto("/article/zen-pages");

  const archive = page.getByRole("button", { name: "Archive", exact: true });

  // First page.
  await expect(page.getByText("1/3")).toBeVisible();
  await expect(archive).toBeVisible();

  // Middle page: no actions.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("2/3")).toBeVisible();
  await expect(archive).toHaveCount(0);

  // Last page.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("3/3")).toBeVisible();
  await expect(archive).toBeVisible();
});

test("zen end block hides Archive once the article is archived", async ({
  page,
}) => {
  await seedDoneArticle(page, "zen-archived", "archived");
  await page.goto("/article/zen-archived");

  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Archive", exact: true }),
  ).toHaveCount(0);
});

test("zen end block deletes back to the list", async ({ page }) => {
  await seedDoneArticle(page, "zen-delete");
  await page.goto("/article/zen-delete");

  await expect(
    page.getByRole("button", { name: "Archive", exact: true }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
});
