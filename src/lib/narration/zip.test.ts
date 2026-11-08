import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { NarrationError } from "./manifest";
import { readNarrationPack } from "./pack";
import { readZipEntry, readZipIndex } from "./zip";

const manifest = {
  version: 1,
  title: "Libro",
  chapters: [
    {
      audio: "audio/001.ogg",
      duration: 10,
      starts: [0, 2],
      ends: [2, 10],
    },
  ],
};

const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

/** A pack shaped like the CLI writes one: deflated JSON, stored audio. */
function pack(overrides: Record<string, Uint8Array> = {}) {
  return zipSync({
    "narration.json": strToU8(JSON.stringify(manifest)),
    "audio/001.ogg": [payload, { level: 0 }],
    ...overrides,
  });
}

/** Copy into a plain ArrayBuffer so the Blob constructor accepts it. */
function asBlob(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy]);
}

describe("readZipIndex", () => {
  it("lists entries and where their bytes start", async () => {
    const blob = asBlob(pack());
    const entries = await readZipIndex(blob);

    expect([...entries.keys()]).toEqual(["narration.json", "audio/001.ogg"]);
    expect(entries.get("narration.json")?.method).toBe(8);
    expect(entries.get("audio/001.ogg")?.method).toBe(0);
  });

  it("slices a stored entry's exact bytes", async () => {
    const blob = asBlob(pack());
    const entry = (await readZipIndex(blob)).get("audio/001.ogg");
    expect(entry?.size).toBe(payload.length);
    if (!entry) throw new Error("missing audio entry");
    expect(await readZipEntry(blob, entry)).toEqual(payload);
  });

  it("inflates a deflated entry", async () => {
    const blob = asBlob(pack());
    const entry = (await readZipIndex(blob)).get("narration.json");
    if (!entry) throw new Error("missing manifest entry");
    const bytes = await readZipEntry(blob, entry);
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(manifest);
  });

  it("rejects a blob that is not an archive", async () => {
    await expect(readZipIndex(asBlob(new Uint8Array(64)))).rejects.toThrow(
      NarrationError,
    );
    await expect(readZipIndex(asBlob(new Uint8Array(0)))).rejects.toThrow(
      NarrationError,
    );
  });
});

describe("readNarrationPack", () => {
  it("resolves every chapter to its bytes", async () => {
    const stored = await readNarrationPack(asBlob(pack()));
    const chapter = stored.chapters[0];
    if (!chapter) throw new Error("missing chapter");

    expect(stored.title).toBe("Libro");
    expect(chapter.starts).toEqual([0, 2]);
    expect(chapter.size).toBe(payload.length);

    const bytes = new Uint8Array(
      await stored.archive
        .slice(chapter.offset, chapter.offset + chapter.size)
        .arrayBuffer(),
    );
    expect(bytes).toEqual(payload);
  });

  it("rejects a pack whose audio entry is missing", async () => {
    const broken = zipSync({
      "narration.json": strToU8(JSON.stringify(manifest)),
    });
    await expect(readNarrationPack(asBlob(broken))).rejects.toThrow(
      /missing audio\/001\.ogg/,
    );
  });

  it("keeps an uncovered chapter with no bytes", async () => {
    const withFrontMatter = {
      ...manifest,
      chapters: [
        { audio: "", duration: 0, starts: [], ends: [] },
        ...manifest.chapters,
      ],
    };
    const packBytes = zipSync({
      "narration.json": strToU8(JSON.stringify(withFrontMatter)),
      "audio/001.ogg": [payload, { level: 0 }],
    });
    const stored = await readNarrationPack(asBlob(packBytes));

    expect(stored.chapters).toHaveLength(2);
    expect(stored.chapters[0]).toMatchObject({ offset: 0, size: 0 });
    expect(stored.chapters[1]?.size).toBe(payload.length);
  });

  it("rejects a pack with no manifest", async () => {
    const broken = zipSync({ "audio/001.ogg": [payload, { level: 0 }] });
    await expect(readNarrationPack(asBlob(broken))).rejects.toThrow(
      /no narration\.json/,
    );
  });

  it("rejects a manifest that is not JSON", async () => {
    const broken = zipSync({ "narration.json": strToU8("{oops") });
    await expect(readNarrationPack(asBlob(broken))).rejects.toThrow(
      /not valid JSON/,
    );
  });
});
