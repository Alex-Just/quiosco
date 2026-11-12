import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

const MTIME = Date.UTC(2000, 0, 1);
const DOCUMENT = "a".repeat(32);
const AUTH_KEY = "5ebe2294ecd0e0f08eab7690d2a6ee69"; // md5("secret")

function chapter(title: string, sentences: readonly string[]): string {
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${sentences.map((sentence) => `<p>${sentence}</p>`).join("")}</body></html>`;
}

function buildEpub(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>QA KOReader</dc:title>
    <dc:creator>QA</dc:creator>
    <dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="Text/c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="Text/c2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="Text/c1.xhtml">Uno</a></li><li><a href="Text/c2.xhtml">Dos</a></li></ol></nav></body></html>`;
  const one = [
    "Primera frase del capítulo uno para la prueba de KOReader.",
    "Segunda frase del capítulo uno para la prueba de KOReader.",
    "Tercera frase del capítulo uno para la prueba de KOReader.",
  ];
  const two = [
    "Primera frase del capítulo dos para la prueba de KOReader.",
    "Segunda frase del capítulo dos para la prueba de KOReader.",
    "Tercera frase del capítulo dos para la prueba de KOReader.",
    "Cuarta frase del capítulo dos para la prueba de KOReader.",
  ];
  return zipSync(
    {
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      ),
      "OEBPS/content.opf": strToU8(opf),
      "OEBPS/nav.xhtml": strToU8(nav),
      "OEBPS/Text/c1.xhtml": strToU8(chapter("Uno", one)),
      "OEBPS/Text/c2.xhtml": strToU8(chapter("Dos", two)),
    },
    { mtime: MTIME },
  );
}

function pushProgress(
  request: APIRequestContext,
  args: {
    filename: string;
    progress: string;
    percentage: number;
    document?: string;
  },
): Promise<import("@playwright/test").APIResponse> {
  return request.put("/kosync/syncs/progress", {
    headers: {
      "x-auth-user": "quiosco",
      "x-auth-key": AUTH_KEY,
    },
    data: {
      document: args.document ?? DOCUMENT,
      progress: args.progress,
      percentage: args.percentage,
      device: "PocketBook",
      metadata: {
        filename: args.filename,
        title: "QA KOReader",
        authors: "QA",
      },
    },
  });
}

test("KOReader position offers, applies, and dismisses", async ({
  page,
  request,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "quiosco-kosync-qa-"));
  const file = join(dir, "qa-kosync.epub");
  await writeFile(file, buildEpub());
  try {
    await page.goto("/settings");
    await page.getByLabel("App token").fill("e2e-token");
    await page.getByLabel("Translate automatically after saving").uncheck();
    await page.getByRole("button", { name: "Save" }).click();

    await page.goto("/add");
    await page.getByRole("tab", { name: "Book" }).click();
    await page.getByLabel("EPUB file").setInputFiles(file);
    await expect(page.getByText("2 chapters ·")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL("**/article/**");
    const articleUrl = page.url();

    expect(
      (
        await pushProgress(request, {
          filename: "qa-kosync.epub",
          progress: "/body/DocFragment[2]/body/p[1]/text().0",
          percentage: 0.75,
        })
      ).ok(),
    ).toBe(true);
    await page.goto(articleUrl);
    const banner = page.locator(".kosync-prompt");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("PocketBook is at 75% in this book.");

    const before = await page.locator(".zen-progress-label").textContent();
    const beforeIndex = Number(/^(\d+)/.exec(before ?? "")?.[1] ?? 0);
    await page.getByRole("button", { name: "Jump there" }).click();
    await expect(banner).toHaveCount(0);
    const after = await page.locator(".zen-progress-label").textContent();
    const afterIndex = Number(/^(\d+)/.exec(after ?? "")?.[1] ?? 0);
    expect(afterIndex).toBeGreaterThan(beforeIndex);

    // The jump is remembered: a reload does not offer the same push again.
    await page.waitForTimeout(300);
    await page.reload();
    await expect(banner).toHaveCount(0);

    // A newer push is offered again, and "Not now" silences it.
    await page.waitForTimeout(1100);
    expect(
      (
        await pushProgress(request, {
          filename: "qa-kosync.epub",
          progress: "/body/DocFragment[2]/body/p[1]/text().0",
          percentage: 0.95,
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("PocketBook is at 95% in this book.");
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(banner).toHaveCount(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a quiosco bilingual export maps its XPointer exactly", async ({
  page,
  request,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "quiosco-kosync-qa-"));
  const file = join(dir, "qa-kosync-bilingual.epub");
  await writeFile(file, buildEpub());
  try {
    await page.goto("/settings");
    await page.getByLabel("App token").fill("e2e-token");
    await page.getByLabel("Translate automatically after saving").uncheck();
    await page.getByRole("button", { name: "Save" }).click();

    await page.goto("/add");
    await page.getByRole("tab", { name: "Book" }).click();
    await page.getByLabel("EPUB file").setInputFiles(file);
    await expect(page.getByText("2 chapters ·")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL("**/article/**");
    const articleUrl = page.url();

    // Percentage 95% would land on the last screen; the export XPointer's
    // DocFragment[2]/p[1] must win and land on chapter two's first sentence.
    expect(
      (
        await pushProgress(request, {
          document: "b".repeat(32),
          filename: "qa-kosync-bilingual.epub",
          progress: "/body/DocFragment[2]/body/p[1]/br[1].0",
          percentage: 0.95,
        })
      ).ok(),
    ).toBe(true);

    await page.goto(articleUrl);
    await expect(page.locator(".kosync-prompt")).toBeVisible();
    await page.getByRole("button", { name: "Jump there" }).click();
    await expect(page.locator(".zen-pane .para")).toContainText(
      "Primera frase del capítulo dos",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the app pushes its exact position back for a bilingual export", async ({
  page,
  request,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "quiosco-kosync-push-"));
  const filename = "qa-push-bilingual.epub";
  const document = "c".repeat(32);
  const file = join(dir, filename);
  await writeFile(file, buildEpub());
  try {
    await page.goto("/settings");
    await page.getByLabel("App token").fill("e2e-token");
    await page.getByLabel("Translate automatically after saving").uncheck();
    await page.getByRole("button", { name: "Save" }).click();

    await page.goto("/add");
    await page.getByRole("tab", { name: "Book" }).click();
    await page.getByLabel("EPUB file").setInputFiles(file);
    await expect(page.getByText("2 chapters ·")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL("**/article/**");
    const articleUrl = page.url();

    // A non-exact pointer at 0% links the row by filename without offering a
    // jump, so the app starts from a clean base with no banner in the way.
    expect(
      (
        await pushProgress(request, {
          document,
          filename,
          progress: "/body/DocFragment[1]/body/p[1]/text().0",
          percentage: 0,
        })
      ).ok(),
    ).toBe(true);

    await page.goto(articleUrl);
    await expect(page.locator(".kosync-prompt")).toHaveCount(0);
    const label = page.locator(".zen-progress-label");
    await expect(label).toHaveText(/^1\//);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const current = await label.textContent();
    const index = Number(/^(\d+)\//.exec(current ?? "")?.[1] ?? 0) - 1;
    expect(index).toBeGreaterThanOrEqual(1);
    const expected = `/body/DocFragment[1]/body/p[${index}]/br[1].0`;

    await expect
      .poll(
        async () => {
          const response = await request.get(
            `/kosync/syncs/progress/${document}`,
            {
              headers: {
                "x-auth-user": "quiosco",
                "x-auth-key": AUTH_KEY,
              },
            },
          );
          const body = (await response.json()) as {
            progress?: string;
            device?: string;
          };
          return { progress: body.progress, device: body.device };
        },
        { timeout: 10_000 },
      )
      .toEqual({ progress: expected, device: "Quiosco" });

    // The app's own lookup sees the pushed position, so another install would
    // be offered the same sentence.
    const lookup = await request.get(
      `/api/kosync/progress?filename=${encodeURIComponent(filename)}`,
      { headers: { Authorization: "Bearer e2e-token" } },
    );
    await expect(lookup.ok()).toBe(true);
    const looked = (await lookup.json()) as {
      progress: { progress: string; device: string } | null;
    };
    expect(looked.progress?.progress).toBe(expected);
    expect(looked.progress?.device).toBe("Quiosco");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
