// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { charsetFromContentType, decodeHtml, extractArticle } from "./extract";
import { assessArticle } from "./quality";

// cwd-relative: Vite (vitest) rewrites import.meta.url under the jsdom
// environment, so new URL(..., import.meta.url) resolves to the wrong base.
const fixture = (name: string) =>
  new Uint8Array(gunzipSync(readFileSync(`tests/fixtures/${name}`)));

describe("charsetFromContentType", () => {
  it("extracts a charset", () => {
    expect(charsetFromContentType("text/html; charset=iso-8859-15")).toBe(
      "iso-8859-15",
    );
    expect(charsetFromContentType('text/html; charset="UTF-8"')).toBe("utf-8");
  });
  it("returns null without a charset", () => {
    expect(charsetFromContentType("text/html")).toBeNull();
    expect(charsetFromContentType(null)).toBeNull();
  });
});

describe("decodeHtml", () => {
  it("respects the content-type charset", () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0xf1]); // "café ñ" in latin-1
    expect(decodeHtml(bytes, "text/html; charset=iso-8859-15")).toBe("café ñ");
  });

  it("sniffs the meta charset when the header has none", () => {
    const html =
      '<html><head><meta charset="iso-8859-15"></head><body>\xf1</body></html>';
    const bytes = Uint8Array.from(
      html,
      (character) => character.charCodeAt(0) & 0xff,
    );
    expect(decodeHtml(bytes, null)).toContain("ñ");
  });

  it("defaults to utf-8", () => {
    const bytes = new TextEncoder().encode("ñandú");
    expect(decodeHtml(bytes, "text/html")).toBe("ñandú");
  });
});

describe("extractArticle", () => {
  it("extracts an article from a synthetic paywall-overlay page", () => {
    const body = Array.from(
      { length: 5 },
      (_, i) =>
        `<p>Párrafo número ${i} con el contenido real de la noticia, lo bastante largo.</p>`,
    ).join("");
    const html = `<html><head><title>Un titular</title></head><body><div class="paywall-overlay"></div><article>${body}</article></body></html>`;
    const result = extractArticle(html);
    expect(result?.title).toBe("Un titular");
    expect(result?.text).toContain("Párrafo número 0");
  });

  it("returns null for an empty document", () => {
    expect(extractArticle("<html><body></body></html>")).toBeNull();
  });

  it("prefers JSON-LD articleBody over a paywalled DOM teaser", () => {
    const articleBody = [
      "El Ayuntamiento de Valencia ha licitado el procedimiento para contratar las obras de limpieza de la fachada.",
      "La actuación supone una intervención de especial relevancia sobre un edificio patrimonial emblemático.",
      "La licitación contempla un presupuesto de 817.953 euros y un plazo de ejecución de cinco meses.",
      "Los trabajos se realizarán sobre un edificio construido entre 1914 y 1928, referente histórico de la ciudad.",
      "El proyecto contempla la limpieza de lamas, cristales, vidrieras y piedra con procedimientos adaptados a cada material.",
      "Durante la ejecución se adoptarán medidas de seguridad para reducir las molestias a comerciantes y visitantes.",
    ].join(" ");
    const payload = JSON.stringify({
      "@type": "NewsArticle",
      headline: "Licitan las obras del Mercado Central",
      articleBody,
    });
    const html = `<html><head><title>Shell</title>
<script type="application/ld+json">${payload}</script></head>
<body><p>Teaser corto.</p><div>Suscríbete para seguir leyendo</div></body></html>`;
    const article = extractArticle(html);
    expect(article?.title).toBe("Licitan las obras del Mercado Central");
    expect(article?.text).toContain("Ayuntamiento de Valencia");
    expect(article?.text).not.toContain("Suscríbete para seguir leyendo");
    expect(assessArticle(article?.text ?? "").ok).toBe(true);
  });

  it("prefers glued Vocento JSON-LD over a short paywalled teaser", () => {
    const articleBody = [
      "El Ayuntamiento de Valencia ha recibido un total de 53 solicitudes de personas interesadas en reabrir los quioscos cerrados en la ciudad.",
      "Al cierre del plazo el volumen de propuestas supera holgadamente el número de puestos ofertados por el consistorio.",
      "La convocatoria se enmarca en el convenio de colaboración suscrito con la asociación profesional de vendedores de prensa.",
      "El concurso público contempla el otorgamiento de títulos de ocupación privativa por un periodo inicial de veinte años.",
      "El pliego fija el carácter social de la convocatoria y un baremo automático de adjudicación para colectivos vulnerables.",
      "De hecho las bases permiten compatibilizar la venta de prensa con servicios complementarios autorizados por la ordenanza.",
    ].join("");
    const payload = JSON.stringify({
      "@type": "NewsArticle",
      headline: "Quioscos en Valencia",
      articleBody,
    });
    const html = `<html><head><title>Shell</title>
<script type="application/ld+json">${payload}</script></head>
<body><p>Teaser corto del Ayuntamiento.</p>
<div>Suscríbete para seguir leyendo</div></body></html>`;
    const article = extractArticle(html);
    expect(article?.title).toBe("Quioscos en Valencia");
    expect(article?.text).toContain("baremo automático");
    expect(article?.text).not.toContain("Suscríbete para seguir leyendo");
    expect(assessArticle(article?.text ?? "").ok).toBe(true);
  });

  it("decodes and extracts the El País fixture", () => {
    const html = decodeHtml(fixture("elpais.html.gz"), null);
    const article = extractArticle(html);
    expect(article).not.toBeNull();
    if (article) {
      expect(assessArticle(article.text).ok).toBe(true);
    }
  });

  it("decodes and extracts the El Mundo fixture (ISO-8859-15)", () => {
    const html = decodeHtml(
      fixture("elmundo.html.gz"),
      "text/html; charset=iso-8859-15",
    );
    // Proves the ISO-8859-15 decode: mojibake would not produce these characters.
    // (No "Ã"-absence check: El Mundo's own inline ad script carries a UTF-8
    // character that decodes to "Ã" under ISO-8859-15.)
    expect(html).toMatch(/[áéíóúñ]/);
    const article = extractArticle(html);
    expect(article).not.toBeNull();
    if (article) {
      expect(assessArticle(article.text).ok).toBe(true);
    }
  });
});
