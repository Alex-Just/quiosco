import { expect, type Page, test } from "@playwright/test";

const PARAGRAPHS = [
  "Párrafo uno del artículo de prueba para el modo Zen, con longitud suficiente.",
  "Párrafo dos del artículo de prueba para el modo Zen, con longitud suficiente.",
  "Párrafo tres del artículo de prueba para el modo Zen, con longitud suficiente.",
];

/**
 * Seeding a finished article directly is the only hermetic way to reach Zen:
 * the translation phase needs the Zen API, which e2e stubs out. The app opens
 * the same IndexedDB ("quiosco", v3), so the stores already exist and this
 * upgrade handler is a no-op.
 */
async function seedArticle(
  page: Page,
  id: string,
  options: {
    status?: string;
    translationStatus?: string;
    translationParagraphs?: string[];
    partial?: string | null;
    translatedChunks?: number;
    totalChunks?: number;
  } = {},
) {
  const {
    status = "unread",
    translationStatus = "done",
    translationParagraphs = PARAGRAPHS,
    partial = null,
    translatedChunks = 1,
    totalChunks = 1,
  } = options;
  await page.goto("/");
  await page.evaluate(
    async ({
      id,
      paragraphs,
      status,
      translationStatus,
      translationParagraphs,
      partial,
      translatedChunks,
      totalChunks,
    }) => {
      const article = {
        id,
        url: null,
        title: "Prueba Zen",
        site: null,
        text: paragraphs.join("\n\n"),
        via: "manual",
        translation: translationParagraphs.join("\n\n"),
        partial,
        translationStatus,
        translatedChunks,
        totalChunks,
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
    {
      id,
      paragraphs: PARAGRAPHS,
      status,
      translationStatus,
      translationParagraphs,
      partial,
      translatedChunks,
      totalChunks,
    },
  );
}

async function seedDoneArticle(page: Page, id: string, status = "unread") {
  await seedArticle(page, id, { status });
}

test("zen opens from streamed partial text before the chunk commits", async ({
  page,
}) => {
  const firstPage = PARAGRAPHS[0] ?? "";
  await seedArticle(page, "zen-early", {
    translationStatus: "running",
    translationParagraphs: [],
    partial: firstPage,
    translatedChunks: 0,
    totalChunks: 1,
  });
  await page.goto("/article/zen-early");

  await expect(
    page.getByRole("progressbar", { name: "Article progress" }),
  ).toBeVisible();
  await expect(page.getByText("1/1")).toBeVisible();
  await expect(page.getByText(firstPage)).toBeVisible();
});

test("zen copy button writes the current page original to the clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await seedDoneArticle(page, "zen-copy");
  await page.goto("/article/zen-copy");

  const copy = page.getByRole("button", { name: "Copy original page" });
  const auto = page.getByRole("checkbox", {
    name: "Auto-listen on each page",
  });
  await expect(copy).toBeVisible();
  const copyBox = await copy.boundingBox();
  const autoBox = await auto.boundingBox();
  if (!copyBox || !autoBox) throw new Error("missing boxes");
  expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(autoBox.x);

  await copy.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    PARAGRAPHS[0],
  );
});

test("zen listen button speaks original text from the current page", async ({
  page,
}) => {
  await seedDoneArticle(page, "zen-listen");
  await page.goto("/article/zen-listen");

  const listen = page.getByRole("button", { name: "Listen to original" });
  const auto = page.getByRole("checkbox", {
    name: "Auto-listen on each page",
  });
  await expect(listen).toBeVisible();
  await expect(auto).not.toBeChecked();

  const box = await listen.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("missing boxes");
  expect(box.x + box.width).toBeGreaterThan(viewport.width * 0.5);
  expect(box.y).toBeGreaterThan(viewport.height * 0.5);

  await page.evaluate(() => {
    const speak = () => undefined;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speaking: false,
        pending: false,
        paused: false,
        cancel: () => undefined,
        speak,
        getVoices: () => [],
      },
    });
  });

  await listen.click();
  await expect(
    page.getByRole("button", { name: "Stop listening" }),
  ).toBeVisible();
});

test("zen auto-listen starts TTS when moving to the next page", async ({
  page,
}) => {
  await seedDoneArticle(page, "zen-auto-listen");
  await page.goto("/article/zen-auto-listen");

  await page.evaluate(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speaking: false,
        pending: false,
        paused: false,
        cancel: () => undefined,
        speak: () => undefined,
        getVoices: () => [],
      },
    });
  });

  const auto = page.getByRole("checkbox", {
    name: "Auto-listen on each page",
  });
  await expect(auto).not.toBeChecked();
  await auto.check();
  await expect(auto).toBeChecked();

  // Still on page 1 — Auto only fires on a page change.
  await expect(
    page.getByRole("button", { name: "Listen to original" }),
  ).toBeVisible();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("2/3")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop listening" }),
  ).toBeVisible();
});

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
  const progressBox = await page.locator(".zen-progress").boundingBox();
  const meterBox = await page.locator(".zen-progress-meter").boundingBox();
  const moreBox = await more.boundingBox();
  const paraBox = await page.locator(".zen-pane .para").boundingBox();
  if (!progressBox || !meterBox || !moreBox || !paraBox) {
    throw new Error("missing bounding boxes");
  }
  expect(moreBox.x).toBeGreaterThanOrEqual(meterBox.x + meterBox.width);
  expect(Math.abs(moreBox.y - meterBox.y)).toBeLessThan(24);
  // Fixed chrome must not cover the article text.
  expect(paraBox.y).toBeGreaterThanOrEqual(progressBox.y + progressBox.height);

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
