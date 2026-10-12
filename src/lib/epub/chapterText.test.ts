// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractChapter } from "./chapterText";

/** A chapter document as the EPUB importer hands it over: XHTML with head. */
const chapterDoc = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Uno</title><style>p { margin: 0; }</style></head><body>${body}</body></html>`;

describe("extractChapter", () => {
  it("keeps drop-cap spans glued into one paragraph", () => {
    const { paragraphs } = extractChapter(
      chapterDoc(
        `<p><span class="capital">L</span><span class="versalita">OS</span> aldeanos del valle</p>`,
      ),
    );
    expect(paragraphs).toEqual(["LOS aldeanos del valle"]);
  });

  it("turns a br into a single newline inside one paragraph", () => {
    const { paragraphs } = extractChapter(
      chapterDoc("<p>La primera línea<br/>\n    la segunda línea</p>"),
    );
    expect(paragraphs).toEqual(["La primera línea\nla segunda línea"]);
  });

  it("does not emit empty paragraphs from nested divs", () => {
    const { paragraphs } = extractChapter(
      chapterDoc(
        "<div><div><div><p>Uno</p></div></div></div><div><div></div></div>",
      ),
    );
    expect(paragraphs).toEqual(["Uno"]);
  });

  it("makes each list item its own paragraph", () => {
    const { paragraphs } = extractChapter(
      chapterDoc("<ul><li>Primero</li><li>Segundo</li></ul>"),
    );
    expect(paragraphs).toEqual(["Primero", "Segundo"]);
  });

  it("ignores script, style, and svg content", () => {
    const { paragraphs } = extractChapter(
      chapterDoc(
        `<p>Antes</p><script>var x = "<p>no</p>";</script><style>p::before { content: "no"; }</style><svg><text>no</text></svg><p>Después</p>`,
      ),
    );
    expect(paragraphs).toEqual(["Antes", "Después"]);
  });

  it("takes the heading from the first h1", () => {
    const chapter = extractChapter(
      chapterDoc(
        `<h1 id="cap1" title="1. La Mansión de los Ryddle">\n  CAPÍTULO UNO\n</h1><p>Texto.</p>`,
      ),
    );
    expect(chapter.heading).toBe("CAPÍTULO UNO");
  });

  it("skips an empty heading element for the next non-empty one", () => {
    const chapter = extractChapter(
      chapterDoc("<h1> </h1><h2>Prólogo</h2><p>Texto.</p>"),
    );
    expect(chapter.heading).toBe("Prólogo");
  });

  it("turns a br inside the heading into a space instead of gluing words", () => {
    const chapter = extractChapter(
      chapterDoc("<h1>CAPÍTULO<br/>UNO</h1><p>Texto.</p>"),
    );
    expect(chapter.heading).toBe("CAPÍTULO UNO");
  });

  it("ignores skipped subtrees inside the heading", () => {
    const chapter = extractChapter(
      chapterDoc(
        `<h1>Hi<svg><text>X</text></svg><script>Y()</script></h1><p>Texto.</p>`,
      ),
    );
    expect(chapter.heading).toBe("Hi");
  });

  it("returns a null heading when the document has none", () => {
    const chapter = extractChapter(
      chapterDoc("<h4>Solo un subtítulo</h4><p>Solo texto.</p>"),
    );
    expect(chapter.heading).toBeNull();
  });

  it("collapses internal whitespace and drops whitespace-only paragraphs", () => {
    const { paragraphs } = extractChapter(
      chapterDoc("<p>Hola    mundo</p><p> \n\t </p><div>   </div><p>Dos</p>"),
    );
    expect(paragraphs).toEqual(["Hola mundo", "Dos"]);
  });
});
