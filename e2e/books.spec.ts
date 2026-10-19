import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// fflate only encodes DOS timestamps; pin a fixed date so the fixture bytes
// are deterministic.
const MTIME = Date.UTC(2000, 0, 1);

// Filler so the first chapter is taller than the viewport: the chapter jump
// only scrolls (and content-visibility only skips) when the page overflows.
const FILLER = Array.from(
  { length: 24 },
  (_, index) =>
    `Párrafo de relleno ${index + 1} con el texto suficiente para alargar el primer capítulo y que la página del lector se pueda desplazar hasta el segundo capítulo.`,
);

// Middle-chapter filler: when rendered, this chapter is much taller than the
// 800 px content-visibility estimates for skipped sections, so a jump to the
// chapter after it lands on a target whose position keeps moving while the
// skipped sections between render.
const MIDDLE_FILLER = Array.from(
  { length: 48 },
  (_, index) =>
    `Párrafo intermedio de relleno ${index + 1} con el texto suficiente para que el capítulo del medio sea mucho más alto que la estimación del navegador y desplace al capítulo siguiente.`,
);

// Short warm-up chapters: keep the tall middle chapter (and the target after
// it) outside the content-visibility activation margin of the top of the page,
// so they are still skipped when the chapter jump starts.
const SHORT_FILLER = Array.from(
  { length: 6 },
  (_, index) =>
    `Párrafo corto de relleno ${index + 1} para separar el inicio del capítulo intermedio.`,
);

// Filler past the prefetch scan budget in the last chapter: the trailing
// paragraph after these is never cached by the time the test reaches it.
const TAIL_FILLER = Array.from(
  { length: 120 },
  (_, index) =>
    `Párrafo final de relleno ${index + 1} que queda fuera del alcance de la precarga inicial para poder probar el fallo del servicio de traducción.`,
);

const chapterXml = (heading: string | null, ...paragraphs: string[]) =>
  `<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>capítulo</title></head>
  <body>
    ${heading === null ? "" : `<h1>${heading}</h1>`}
    ${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("\n")}
  </body>
</html>`;

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

/** Minimal Epub3 book: mimetype, container, package, nav, five chapters. */
function buildEpub(): Uint8Array {
  const opfXml = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Libro de prueba</dc:title>
    <dc:creator>Autora Prueba</dc:creator>
    <dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="Text/cap001.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="Text/cap002.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="Text/cap003.xhtml" media-type="application/xhtml+xml"/>
    <item id="cmid" href="Text/capmid.xhtml" media-type="application/xhtml+xml"/>
    <item id="c5" href="Text/cap005.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
    <itemref idref="cmid"/>
    <itemref idref="c5"/>
  </spine>
</package>`;
  const navXml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="Text/cap001.xhtml">Capítulo uno</a></li>
        <li><a href="Text/cap002.xhtml">Capítulo segundo</a></li>
        <li><a href="Text/cap003.xhtml">Capítulo tercero</a></li>
        <li><a href="Text/capmid.xhtml">Capítulo intermedio</a></li>
        <li><a href="Text/cap005.xhtml">Capítulo final</a></li>
      </ol>
    </nav>
  </body>
</html>`;
  return zipSync(
    {
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(CONTAINER_XML),
      "OEBPS/content.opf": strToU8(opfXml),
      "OEBPS/nav.xhtml": strToU8(navXml),
      "OEBPS/Text/cap001.xhtml": strToU8(
        chapterXml(
          null,
          "Primer capítulo con texto suficiente para la prueba de importación. Segunda frase del mismo párrafo para probar el avance por frase. —¡Vaya! —dijo el chico—. Otra frase después.",
          ...FILLER,
        ),
      ),
      "OEBPS/Text/cap002.xhtml": strToU8(
        chapterXml(
          null,
          "Segundo capítulo que también aporta texto reconocible al importar.",
          ...SHORT_FILLER,
        ),
      ),
      "OEBPS/Text/cap003.xhtml": strToU8(
        chapterXml(null, "Tercer capítulo de tránsito.", ...SHORT_FILLER),
      ),
      "OEBPS/Text/capmid.xhtml": strToU8(chapterXml(null, ...MIDDLE_FILLER)),
      "OEBPS/Text/cap005.xhtml": strToU8(
        chapterXml(
          null,
          "Último capítulo que también aporta texto reconocible al importar.",
          ...TAIL_FILLER,
          "Párrafo final fuera del alcance de la precarga inicial de la prueba.",
        ),
      ),
    },
    { mtime: MTIME },
  );
}

/** Minimal Epub3 with `count` one-paragraph chapters, for sheet-length tests. */
function buildManyChaptersEpub(count: number): Uint8Array {
  const chapterFile = (index: number) =>
    `Text/cap${String(index + 1).padStart(3, "0")}.xhtml`;
  const opfXml = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Muchos capítulos</dc:title>
    <dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${Array.from({ length: count }, (_, index) => `<item id="c${index + 1}" href="${chapterFile(index)}" media-type="application/xhtml+xml"/>`).join("\n    ")}
  </manifest>
  <spine>
    ${Array.from({ length: count }, (_, index) => `<itemref idref="c${index + 1}"/>`).join("\n    ")}
  </spine>
</package>`;
  const navXml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        ${Array.from({ length: count }, (_, index) => `<li><a href="${chapterFile(index)}">Capítulo ${index + 1}</a></li>`).join("\n        ")}
      </ol>
    </nav>
  </body>
</html>`;
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(CONTAINER_XML),
    "OEBPS/content.opf": strToU8(opfXml),
    "OEBPS/nav.xhtml": strToU8(navXml),
  };
  for (let index = 0; index < count; index++) {
    files[`OEBPS/${chapterFile(index)}`] = strToU8(
      chapterXml(null, `Texto del capítulo número ${index + 1}.`),
    );
  }
  return zipSync(files, { mtime: MTIME });
}

let epubPath = "";

test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "quiosco-epub-"));
  epubPath = join(dir, "libro-de-prueba.epub");
  await writeFile(epubPath, buildEpub());
});

test.afterAll(async () => {
  // Remove the whole fixture directory, not just the epub inside it.
  if (epubPath) await rm(dirname(epubPath), { recursive: true, force: true });
});

/** Configure the app token the importer and the translation session need. */
async function setAppToken(page: Page) {
  await page.goto("/settings");
  await page.getByLabel("App token").fill("e2e-token");
  await page.getByLabel("Translate automatically after saving").uncheck();
  await page.getByRole("button", { name: "Save" }).click();
}

/** Import the shared fixture book and land on its reader page. */
async function importBook(page: Page) {
  await page.goto("/add");
  await page.getByRole("tab", { name: "Book" }).click();
  await expect(page.getByRole("heading", { name: "Add book" })).toBeVisible();
  await page.getByLabel("EPUB file").setInputFiles(epubPath);
  await expect(page.getByText("5 chapters ·")).toBeVisible();
  // The progress line is cleared once the parse settles.
  await expect(page.getByText(/Reading book/)).toHaveCount(0);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL("**/article/**");
}

/** The sentences of one translate request, in listed order. */
function requestedSentences(body: unknown): string[] {
  const parsed = body as { text?: unknown };
  const text = typeof parsed?.text === "string" ? parsed.text : "";
  const block = /<translate>\n?([\s\S]*?)\n?<\/translate>/.exec(text);
  if (!block?.[1]) return [];
  return block[1].split("\n").flatMap((line) => {
    const match = /^(\d+)\.\s+(.+)$/.exec(line);
    return match?.[2] ? [match[2]] : [];
  });
}

/** The bilingual block reply the mocked translate route returns per window. */
function translateReply(sentences: string[]): string {
  return sentences
    .map(
      (sentence, index) =>
        `${index + 1}\n🇪🇸 ${sentence}\n🇬🇧 ES-trad: ${sentence}`,
    )
    .join("\n\n");
}

/** Mock /api/translate; returns the list of requested sentences. */
async function mockTranslateRoute(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route("**/api/translate**", async (route) => {
    const sentences = requestedSentences(route.request().postDataJSON());
    requests.push(...sentences);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: translateReply(sentences) }),
    });
  });
  return requests;
}

/** Gated /api/translate mock: the first request waits until release(). */
async function mockGatedTranslateRoute(page: Page): Promise<{
  requests: string[];
  count: () => number;
  release: () => void;
}> {
  const requests: string[] = [];
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**/api/translate**", async (route) => {
    calls += 1;
    const sentences = requestedSentences(route.request().postDataJSON());
    requests.push(...sentences);
    if (!held) {
      held = true;
      await gate;
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: translateReply(sentences) }),
      });
    } catch {
      // Cancelling the run aborts the in-flight request: the reply has
      // nowhere to go, and Playwright may refuse the late fulfill.
    }
  });
  return { requests, count: () => calls, release };
}

/** Move the Zen pane to the last screen via the chapter sheet. */
async function jumpToLastParagraph(page: Page) {
  await page.getByRole("button", { name: "More book actions" }).click();
  await page.getByRole("button", { name: "Chapters" }).click();
  await page
    .getByRole("dialog", { name: "Chapters" })
    .getByRole("button", { name: "Capítulo final" })
    .click();
  // The pane's counter gives the total; ArrowDown walks there one screen at a
  // time, which is cheap enough at this size.
  const totalText = await page.locator(".zen-progress-label").textContent();
  const total = Number(/\/\s*(\d+)/.exec(totalText ?? "")?.[1] ?? 1);
  const current = Number(/^\s*(\d+)/.exec(totalText ?? "")?.[1] ?? 1);
  for (let index = current; index < total; index += 1) {
    await page.keyboard.press("ArrowDown");
  }
}

test("imports an EPUB book from the Add page and lists it", async ({
  page,
}) => {
  await setAppToken(page);
  await importBook(page);

  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /Libro de prueba/ }),
  ).toBeVisible();
  await expect(page.getByText(/Autora Prueba ·/)).toBeVisible();
});

/** The service worker must control the page so POST /share reaches its route. */
async function waitForServiceWorker(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return true;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test("a shared EPUB file opens the Add page in Book mode and imports", async ({
  page,
}) => {
  await waitForServiceWorker(page);
  const bytes = [...(await readFile(epubPath))];
  await page.evaluate(async (data) => {
    const formData = new FormData();
    formData.set(
      "epub",
      new File([new Uint8Array(data)], "libro-compartido.epub", {
        type: "application/epub+zip",
      }),
    );
    await fetch("/share", { method: "POST", body: formData });
  }, bytes);

  await page.goto("/share");
  await page.waitForURL("**/add");
  await expect(page.getByRole("heading", { name: "Add book" })).toBeVisible();
  await expect(page.getByText("5 chapters ·")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL("**/article/**");
  await expect(page.locator(".zen-pane .para")).toContainText("Capítulo uno");
});

test("an empty shared file shows Nothing received", async ({ page }) => {
  await waitForServiceWorker(page);
  await page.evaluate(async () => {
    const formData = new FormData();
    formData.set(
      "epub",
      new File([], "vacio.epub", { type: "application/epub+zip" }),
    );
    await fetch("/share", { method: "POST", body: formData });
  });
  await page.goto("/share");
  await expect(
    page.getByRole("heading", { name: "Nothing received" }),
  ).toBeVisible();
});

/** Zen index of the first saved local position (undefined when none). */
async function savedZenIndex(page: Page): Promise<number | undefined> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("quiosco");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ zenIndex?: number } | undefined>(
      (resolve, reject) => {
        const request = db
          .transaction("positions")
          .objectStore("positions")
          .getAll();
        request.onsuccess = () => resolve(request.result[0]);
        request.onerror = () => reject(request.error);
      },
    );
    db.close();
    return record?.zenIndex;
  });
}

test("reads a book in Zen, one sentence per screen, and resumes", async ({
  page,
}) => {
  await setAppToken(page);
  await importBook(page);

  // Reopening from the list starts the book in Zen at its first sentence.
  await page.goto("/");
  await page.getByRole("link", { name: /Libro de prueba/ }).click();
  await expect(page.locator(".zen-pane .para")).toContainText("Capítulo uno");
  await expect(page.locator(".zen-progress-label")).toHaveText(/^1\//);

  // A sentence tap opens the speech sheet in Zen: the pane must not capture
  // the pointer until the gesture is a swipe, or the click is retargeted.
  await page.locator(".zen-pane .sentence").first().click();
  const sentenceSheet = page.getByRole("dialog", { name: "Sentence actions" });
  await expect(sentenceSheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sentenceSheet).toHaveCount(0);

  // A short, in-place drag is still a tap: below the swipe threshold nothing
  // is captured, so the button keeps its click.
  const sentenceBox = await page
    .locator(".zen-pane .sentence")
    .first()
    .boundingBox();
  if (!sentenceBox) throw new Error("zen sentence has no box");
  const tapX = sentenceBox.x + sentenceBox.width / 2;
  const tapY = sentenceBox.y + sentenceBox.height / 2;
  await page.mouse.move(tapX, tapY);
  await page.mouse.down();
  await page.mouse.move(tapX, tapY - 12);
  await page.mouse.up();
  await expect(sentenceSheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sentenceSheet).toHaveCount(0);

  // The pane's key handler advances one sentence.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".zen-pane .para")).toContainText(
    "Primer capítulo",
  );
  // Sentence granularity: the second sentence of that paragraph is the next
  // screen, not part of this one.
  await expect(page.locator(".zen-pane .para")).not.toContainText(
    "Segunda frase",
  );
  await expect(page.locator(".zen-progress-label")).toHaveText(/^2\//);

  // Leaving Zen from the ⋯ sheet renders the chapter headings.
  await page.getByRole("button", { name: "More book actions" }).click();
  await page.getByRole("button", { name: "Exit Zen mode" }).click();
  await expect(page.locator("#book-chapter-0 h2")).toBeVisible();
  await expect(page.locator("#book-chapter-0 h2")).toHaveText("Capítulo uno");
  await expect(page.locator("#book-chapter-3 h2")).toHaveText(
    "Capítulo intermedio",
  );
  await expect(page.locator("#book-chapter-4 h2")).toHaveText("Capítulo final");

  // Tapping a sentence opens the speech sheet in regular mode.
  await page.locator("#book-chapter-0 .sentence").first().click();
  await expect(sentenceSheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sentenceSheet).toHaveCount(0);

  // The chapter sheet jumps to the last chapter. The tall middle chapter
  // renders after the jump, moving the target: the reader must re-scroll
  // until the heading actually lands in the viewport. The browser's scroll
  // anchoring would normally paper over the drift, so disable it here to
  // assert the reader's own re-scroll.
  await page.addStyleTag({ content: "html { overflow-anchor: none; }" });
  await page.getByRole("button", { name: "More book actions" }).click();
  await page.getByRole("button", { name: "Chapters" }).click();
  await expect(page.locator("#book-chapter-4 h2")).not.toBeInViewport();
  await page
    .getByRole("dialog", { name: "Chapters" })
    .getByRole("button", { name: "Capítulo final" })
    .click();
  // The middle chapter is still skipped (800 px from `contain-intrinsic-size`)
  // when the jump lands; wait for it to render so the layout between it and
  // the target has settled before the heading is checked.
  await expect
    .poll(
      async () =>
        (await page.locator("#book-chapter-3").boundingBox())?.height ?? 0,
    )
    .toBeGreaterThan(800);
  await expect(page.locator("#book-chapter-4 h2")).toBeInViewport();

  // After the 200 ms debounce the Zen screen is stored; a reload resumes it.
  await expect.poll(() => savedZenIndex(page), { timeout: 10_000 }).toBe(1);
  await page.reload();
  await expect(page.locator(".zen-pane .para")).toContainText(
    "Primer capítulo",
  );
  await expect(page.locator(".zen-progress-label")).toHaveText(/^2\//);

  // A mouse drag up on the pane still swipes once capture engages; the step
  // suppresses the trailing click.
  const pane = await page.locator(".zen-pane").boundingBox();
  if (!pane) throw new Error("zen pane has no box");
  const dragX = pane.x + pane.width / 2;
  const dragY = pane.y + pane.height * 0.6;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX, dragY - 120, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".zen-pane .para")).toContainText(
    "Segunda frase del mismo párrafo",
  );
  await expect(page.locator(".zen-progress-label")).toHaveText(/^3\//);
  await expect(sentenceSheet).toHaveCount(0);

  // A drag that starts on a sentence button is still a swipe (down: previous).
  const sentence = await page
    .locator(".zen-pane .sentence")
    .first()
    .boundingBox();
  if (!sentence) throw new Error("zen sentence has no box");
  const sentenceX = sentence.x + sentence.width / 2;
  const sentenceY = sentence.y + sentence.height / 2;
  await page.mouse.move(sentenceX, sentenceY);
  await page.mouse.down();
  await page.mouse.move(sentenceX, sentenceY + 90, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".zen-pane .para")).toContainText(
    "Primer capítulo",
  );
  await expect(page.locator(".zen-progress-label")).toHaveText(/^2\//);
  await expect(sentenceSheet).toHaveCount(0);

  // A dialogue sentence with its tag stays one screen: the tag after the
  // exclamation must not become a unit of its own.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".zen-pane .para")).toContainText(
    "—¡Vaya! —dijo el chico—.",
  );
  await expect(page.locator(".zen-pane .para")).not.toContainText("Otra frase");
  await expect(page.locator(".zen-progress-label")).toHaveText(/^4\//);
});

test("book Zen has the article Listen control with Auto", async ({ page }) => {
  await importBook(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Libro de prueba/ }).click();

  const copy = page.getByRole("button", { name: "Copy original page" });
  const listen = page.getByRole("button", { name: "Listen to original" });
  const autoListen = page.getByRole("checkbox", {
    name: "Auto-listen on each page",
  });
  await expect(copy).toBeVisible();
  await expect(listen).toBeVisible();
  await expect(autoListen).toBeVisible();
  await expect(autoListen).not.toBeChecked();
  const copyBox = await copy.boundingBox();
  const autoBox = await autoListen.boundingBox();
  if (!copyBox || !autoBox) throw new Error("missing boxes");
  expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(autoBox.x);

  // The system voice is stubbed; speaking starts and stays until stopped.
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
  await listen.click();
  await expect(
    page.getByRole("button", { name: "Stop listening" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop listening" }).click();
  await expect(listen).toBeVisible();

  // With Auto on, the current page keeps waiting; turning the page starts
  // the next sentence automatically.
  await autoListen.check();
  await expect(listen).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "Stop listening" }),
  ).toBeVisible();
});

test("translates the Zen sentence from the cache and pauses on failure", async ({
  page,
}) => {
  await importBook(page);

  // Without an app token the toggle is visible but disabled, with its hint.
  await page.goto("/");
  await page.getByRole("link", { name: /Libro de prueba/ }).click();
  await expect(page.locator(".zen-pane .para")).toContainText("Capítulo uno");
  // A book with no translations saved opens in the original text.
  await expect(page.locator("article")).not.toHaveAttribute(
    "data-translation-status",
    /.+/,
  );
  await page.getByRole("button", { name: "More book actions" }).click();
  const sheet = page.getByRole("dialog", { name: "Book actions" });
  const toggle = sheet.getByRole("button", { name: "Translation mode" });
  await expect(toggle).toBeDisabled();
  await expect(
    sheet.getByRole("button", { name: "Export EPUB" }),
  ).toBeEnabled();
  await expect(
    sheet.getByRole("button", { name: "Fully translate, then export" }),
  ).toBeDisabled();
  await expect(
    sheet.getByText("Set the app token in Settings to translate."),
  ).toBeVisible();
  await page.locator(".sheet-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(sheet).toHaveCount(0);
  const articleUrl = page.url();

  await setAppToken(page);
  await page.goto(articleUrl);
  await expect(page.locator(".zen-pane .para")).toContainText("Capítulo uno");

  // The mocked translation route fails for requests that touch the trailing
  // paragraph. That unit sits outside every prefetch scan budget, so only an
  // explicit jump to it asks for it — and gets the rejection.
  const requests: string[] = [];
  const TAIL_PARAGRAPH =
    "Párrafo final fuera del alcance de la precarga inicial de la prueba.";
  await page.route("**/api/translate**", async (route) => {
    const body = route.request().postDataJSON() as { text?: string };
    const sentences = requestedSentences(body);
    requests.push(...sentences);
    if (sentences.includes(TAIL_PARAGRAPH)) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "upstream error" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: sentences
          .map(
            (sentence, index) =>
              `${index + 1}\n🇪🇸 ${sentence}\n🇷🇺 ES-trad: ${sentence}`,
          )
          .join("\n\n"),
      }),
    });
  });

  // Translation mode is off on open and waits in the ⋯ sheet of Zen.
  await page.getByRole("button", { name: "More book actions" }).click();
  await sheet.getByRole("button", { name: "Translation mode" }).click();
  await expect(sheet).toHaveCount(0);

  // The screen shows the cached bilingual translation.
  await expect(page.locator(".zen-pane .para")).toContainText("ES-trad:");
  await expect(page.locator(".zen-pane .para")).toContainText(
    "🇪🇸 Capítulo uno",
  );
  expect(requests.length).toBeGreaterThan(0);

  // The prefetch settles for now: the status returns to idle and no request is
  // pending or planned. Further reads below must not push the count past this.
  await expect(page.locator("article")).toHaveAttribute(
    "data-translation-status",
    "idle",
  );
  const settled = requests.length;
  await expect.poll(() => requests.length).toBe(settled);

  // Swiping forward within the translated runway asks for nothing new.
  const pane = await page.locator(".zen-pane").boundingBox();
  if (!pane) throw new Error("zen pane has no box");
  const swipeX = pane.x + pane.width / 2;
  const swipeY = pane.y + pane.height * 0.6;
  await page.mouse.move(swipeX, swipeY);
  await page.mouse.down();
  await page.mouse.move(swipeX, swipeY - 120, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".zen-pane .para")).toContainText(
    "Primer capítulo",
  );
  await expect(page.locator(".zen-pane .para")).toContainText("ES-trad:");
  await expect(page.locator(".zen-pane .para")).toContainText(
    "🇪🇸 Primer capítulo",
  );
  await expect.poll(() => requests.length).toBe(settled);

  // A reload resumes translated Zen by itself: the book has translations
  // saved now, so the mode starts on and the verified cache answers.
  await expect.poll(() => savedZenIndex(page), { timeout: 10_000 }).toBe(1);
  await page.reload();
  await expect(page.locator("article")).toHaveAttribute(
    "data-translation-status",
    /.+/,
  );
  await expect(page.locator(".zen-pane .para")).toContainText("ES-trad:");
  await expect(page.locator(".zen-pane .para")).toContainText(
    "🇪🇸 Primer capítulo",
  );
  await expect.poll(() => requests.length).toBe(settled);

  // Switching the mode off restores the original text; on again is cached.
  await page.getByRole("button", { name: "More book actions" }).click();
  await page.getByRole("button", { name: "Translation mode" }).click();
  await expect(page.locator(".zen-pane .para")).not.toContainText("ES-trad:");
  await expect(page.locator(".zen-pane .para")).toContainText(
    "Primer capítulo",
  );
  await page.getByRole("button", { name: "More book actions" }).click();
  await page.getByRole("button", { name: "Translation mode" }).click();
  await expect(page.locator(".zen-pane .para")).toContainText("ES-trad:");
  await expect.poll(() => requests.length).toBe(settled);

  // The upstream fails; jumping beyond the prefetch's reach keeps the source
  // text readable and surfaces the paused status. The trailing paragraph was
  // the only unit the mocked upstream ever rejected.
  await jumpToLastParagraph(page);
  await expect(page.locator(".zen-pane .para")).toContainText("Párrafo final");
  await expect(page.locator(".zen-pane .para")).not.toContainText("ES-trad:");
  await expect(page.getByText("Translation paused")).toBeVisible();
  expect(requests.length).toBeGreaterThan(settled);

  // Leaving Zen ends translation mode: the status attribute goes with it, so
  // no session keeps spending budget behind the regular reading view.
  await page.getByRole("button", { name: "More book actions" }).click();
  await page.getByRole("button", { name: "Exit Zen mode" }).click();
  await expect(page.locator("article")).not.toHaveAttribute(
    "data-translation-status",
    /.+/,
  );

  // Every later open of a translated book starts in translated Zen without
  // touching the toggle.
  await page.goto("/");
  await page.getByRole("link", { name: /Libro de prueba/ }).click();
  await expect(page.locator("article")).toHaveAttribute(
    "data-translation-status",
    /.+/,
  );

  // Without an app token the same book opens in the original text again.
  await page.goto("/settings");
  await page.getByLabel("App token").fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await page.goto("/");
  await page.getByRole("link", { name: /Libro de prueba/ }).click();
  await expect(page.locator("article")).not.toHaveAttribute(
    "data-translation-status",
    /.+/,
  );
});

test("exports an EPUB of the cached translations", async ({ page }) => {
  await importBook(page);
  await setAppToken(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Libro de prueba/ }).click();
  await expect(page.locator(".zen-pane .para")).toContainText("Capítulo uno");
  const requests = await mockTranslateRoute(page);

  // Warm the cache by reading in translated Zen until the prefetch settles.
  await page.getByRole("button", { name: "More book actions" }).click();
  await page
    .getByRole("dialog", { name: "Book actions" })
    .getByRole("button", { name: "Translation mode" })
    .click();
  await expect(page.locator(".zen-pane .para")).toContainText("ES-trad:");
  await expect(page.locator("article")).toHaveAttribute(
    "data-translation-status",
    "idle",
  );
  expect(requests.length).toBeGreaterThan(0);

  // Export straight from the menu: the file lands as a download.
  await page.getByRole("button", { name: "More book actions" }).click();
  const sheet = page.getByRole("dialog", { name: "Book actions" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    sheet.getByRole("button", { name: "Export EPUB" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Libro de prueba-bilingual.epub");
  await expect(page.getByText("EPUB ready — check Downloads.")).toBeVisible();

  const path = await download.path();
  if (!path) throw new Error("download has no path");
  const zip = unzipSync(await readFile(path));
  expect(strFromU8(zip.mimetype ?? new Uint8Array())).toBe(
    "application/epub+zip",
  );
  const opf = strFromU8(zip["OEBPS/content.opf"] ?? new Uint8Array());
  expect(opf).toContain("<dc:title>Libro de prueba</dc:title>");
  const chapter1 = strFromU8(zip["OEBPS/chapter-1.xhtml"] ?? new Uint8Array());
  const css = strFromU8(zip["OEBPS/style.css"] ?? new Uint8Array());
  const nav = strFromU8(zip["OEBPS/nav.xhtml"] ?? new Uint8Array());
  // One sentence pair per page; chapter labels live in the TOC only.
  expect(css).toContain("page-break-before: always");
  expect(chapter1).not.toContain("<h1>");
  expect(nav).toContain("Capítulo uno");
  // No flag emoji: the device's fonts render them as tofu boxes.
  expect(chapter1).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
  expect(chapter1).toContain("Primer capítulo");
  expect(chapter1).toContain("ES-trad: Primer capítulo");
  // The tail sits beyond anything the prefetch cached: its text stays source.
  const chapter5 = strFromU8(zip["OEBPS/chapter-5.xhtml"] ?? new Uint8Array());
  expect(chapter5).toContain("Párrafo final fuera del alcance");
  expect(chapter5).not.toContain("ES-trad:");
});

test("fully translates the book, then downloads it, and a finished book makes no further requests", async ({
  page,
}) => {
  await importBook(page);
  await setAppToken(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Libro de prueba/ }).click();
  const { count, release } = await mockGatedTranslateRoute(page);

  // Start the finish run; its first request is held, so it stays working.
  await page.getByRole("button", { name: "More book actions" }).click();
  const sheet = page.getByRole("dialog", { name: "Book actions" });
  await sheet
    .getByRole("button", { name: "Fully translate, then export" })
    .click();
  await expect(page.locator("article")).toHaveAttribute(
    "data-finish-status",
    "working",
  );
  await expect(page.getByText(/Translating whole book/)).toBeVisible();

  // While it runs the slot offers cancel instead of the finish action.
  await page.getByRole("button", { name: "More book actions" }).click();
  await expect(
    sheet.getByRole("button", { name: "Cancel whole-book translation" }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Fully translate, then export" }),
  ).toHaveCount(0);
  await page.locator(".sheet-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(sheet).toHaveCount(0);

  // Releasing the first window lets the run cover the book; the export follows.
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  release();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Libro de prueba-bilingual.epub");
  const path = await download.path();
  if (!path) throw new Error("download has no path");
  const zip = unzipSync(await readFile(path));
  const chapter5 = strFromU8(zip["OEBPS/chapter-5.xhtml"] ?? new Uint8Array());
  expect(chapter5).toContain("ES-trad:");

  // The finished book re-exports straight from the cache: no new requests.
  const settled = count();
  const secondDownloadPromise = page.waitForEvent("download", {
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "More book actions" }).click();
  await sheet
    .getByRole("button", { name: "Fully translate, then export" })
    .click();
  const secondDownload = await secondDownloadPromise;
  expect(secondDownload.suggestedFilename()).toBe(
    "Libro de prueba-bilingual.epub",
  );
  await expect.poll(() => count()).toBe(settled);
});

test("cancels a whole-book translation", async ({ page }) => {
  await importBook(page);
  await setAppToken(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Libro de prueba/ }).click();
  const { count, release } = await mockGatedTranslateRoute(page);
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });

  await page.getByRole("button", { name: "More book actions" }).click();
  const sheet = page.getByRole("dialog", { name: "Book actions" });
  await sheet
    .getByRole("button", { name: "Fully translate, then export" })
    .click();
  await expect(page.locator("article")).toHaveAttribute(
    "data-finish-status",
    "working",
  );
  await expect.poll(() => count()).toBe(1);

  // Cancel from the same slot: the run stops and the status clears.
  await page.getByRole("button", { name: "More book actions" }).click();
  await sheet
    .getByRole("button", { name: "Cancel whole-book translation" })
    .click();
  await expect(page.locator("article")).not.toHaveAttribute(
    "data-finish-status",
    /.+/,
  );
  await expect(page.getByText(/Translating whole book/)).toHaveCount(0);

  // The aborted request never leads anywhere: no further request, no file.
  release();
  await page.waitForTimeout(1500);
  expect(count()).toBe(1);
  expect(downloads).toBe(0);
});

test("shows the whole-book run in the regular reading view", async ({
  page,
}) => {
  await importBook(page);
  await setAppToken(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Libro de prueba/ }).click();
  const { count, release } = await mockGatedTranslateRoute(page);

  // Leave Zen: the regular view must still surface the long paid run.
  await page.getByRole("button", { name: "More book actions" }).click();
  const sheet = page.getByRole("dialog", { name: "Book actions" });
  await sheet.getByRole("button", { name: "Exit Zen mode" }).click();
  await expect(page.locator("#book-chapter-0 h2")).toBeVisible();

  await page.getByRole("button", { name: "More book actions" }).click();
  await sheet
    .getByRole("button", { name: "Fully translate, then export" })
    .click();
  await expect(page.locator("article")).toHaveAttribute(
    "data-finish-status",
    "working",
  );
  await expect(page.getByText(/Translating whole book/)).toBeVisible();
  await expect.poll(() => count()).toBe(1);

  // The same view can cancel it and sees the status clear.
  await page.getByRole("button", { name: "More book actions" }).click();
  await sheet
    .getByRole("button", { name: "Cancel whole-book translation" })
    .click();
  await expect(page.locator("article")).not.toHaveAttribute(
    "data-finish-status",
    /.+/,
  );
  await expect(page.getByText(/Translating whole book/)).toHaveCount(0);
  release();
});

test("Zen text can be selected word by word", async ({ page }) => {
  await importBook(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Libro de prueba/ }).click();

  const sentence = await page
    .locator(".zen-pane .sentence")
    .first()
    .boundingBox();
  if (!sentence) throw new Error("zen sentence has no box");
  const y = sentence.y + sentence.height / 2;
  // A selection gesture over the sentence text (mouse drag stands in for the
  // long-press-and-extend gesture on a phone).
  await page.mouse.move(sentence.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(sentence.x + sentence.width - 1, y, { steps: 8 });
  await page.mouse.up();

  const selected = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selected.trim().length).toBeGreaterThan(0);
});

test.describe("touch selection guard", () => {
  test.use({ hasTouch: true });

  /** Select the current Zen sentence so a live selection exists. */
  async function selectZenSentence(page: Page) {
    await page.evaluate(() => {
      const node = document.querySelector(".zen-pane .sentence");
      if (!node) throw new Error("no zen sentence");
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }

  /** A held touch drag of 130 px up over the Zen pane, via real touch events. */
  async function touchDragUp(
    page: Page,
    holdMs: number,
    beforeEnd?: () => Promise<void>,
  ) {
    const client = await page.context().newCDPSession(page);
    const pane = await page.locator(".zen-pane").boundingBox();
    if (!pane) throw new Error("zen pane has no box");
    const x = Math.round(pane.x + pane.width / 2);
    const y = Math.round(pane.y + pane.height * 0.6);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    if (holdMs > 0) await page.waitForTimeout(holdMs);
    if (beforeEnd) await beforeEnd();
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 130 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }

  test("a swipe under a stale selection still turns the page", async ({
    page,
  }) => {
    await importBook(page);
    await page.goto("/");
    await page.getByRole("link", { name: /Libro de prueba/ }).click();
    await expect(page.locator(".zen-progress-label")).toHaveText(/^1\//);
    await selectZenSentence(page);

    // A slow swipe (held like a selection gesture) over a selection that does
    // not change must still turn the page.
    await touchDragUp(page, 600);

    await expect(page.locator(".zen-progress-label")).toHaveText(/^2\//);
  });

  test("a gesture that changes the selection does not turn the page", async ({
    page,
  }) => {
    await importBook(page);
    await page.goto("/");
    await page.getByRole("link", { name: /Libro de prueba/ }).click();
    await expect(page.locator(".zen-progress-label")).toHaveText(/^1\//);

    // The browser starts (or extends) a selection while the finger is down.
    await touchDragUp(page, 400, () => selectZenSentence(page));

    await expect(page.locator(".zen-progress-label")).toHaveText(/^1\//);
  });
});

test("chapter sheet scrolls so early chapters stay reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 560 });
  const dir = await mkdtemp(join(tmpdir(), "quiosco-epub-many-"));
  const path = join(dir, "muchos-capitulos.epub");
  await writeFile(path, buildManyChaptersEpub(30));
  try {
    await page.goto("/add");
    await page.getByRole("tab", { name: "Book" }).click();
    await page.getByLabel("EPUB file").setInputFiles(path);
    await expect(page.getByText("30 chapters ·")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL("**/article/**");

    // Leave the first chapter so jumping back to it is observable. The bottom
    // of the list is on screen even when the sheet overflows the viewport.
    await page.getByRole("button", { name: "More book actions" }).click();
    await page.getByRole("button", { name: "Chapters" }).click();
    await page
      .getByRole("dialog", { name: "Chapters" })
      .getByRole("button", { name: "Capítulo 30", exact: true })
      .click();
    await expect(page.locator(".zen-pane .para")).toContainText("Capítulo 30");

    // The first entry sits above the fold when the sheet is taller than the
    // viewport: the sheet must scroll for this tap to reach chapter 1.
    await page.getByRole("button", { name: "More book actions" }).click();
    await page.getByRole("button", { name: "Chapters" }).click();
    await page
      .getByRole("dialog", { name: "Chapters" })
      .getByRole("button", { name: "Capítulo 1", exact: true })
      .click();
    await expect(page.locator(".zen-progress-label")).toHaveText(/^1\//);
    await expect(page.locator(".zen-pane .para")).toContainText("Capítulo 1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
