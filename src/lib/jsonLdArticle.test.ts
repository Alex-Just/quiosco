// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractJsonLdArticle, paragraphizePlainBody } from "./jsonLdArticle";
import { assessArticle } from "./quality";

const BODY = [
  "El Ayuntamiento de Valencia ha licitado el procedimiento para contratar las obras de limpieza, conservación y mantenimiento de la fachada.",
  "La actuación supone una intervención de especial relevancia sobre uno de los edificios patrimoniales más emblemáticos de la ciudad.",
  "La licitación contempla un presupuesto de 817.953,48 euros, IVA incluido, y establece un plazo de ejecución de cinco meses.",
  "La intervención se llevará a cabo sobre un edificio construido entre 1914 y 1928, considerado uno de los principales referentes históricos.",
  "El proyecto contempla la limpieza de lamas, cristales, vidrieras, elementos cerámicos, piedra y morteros mediante procedimientos específicos.",
  "Asimismo, durante la ejecución se adoptarán medidas de seguridad para reducir las molestias a comerciantes, clientes y visitantes del mercado.",
].join(" ");

function newsArticleHtml(articleBody: string, headline = "Un titular"): string {
  const payload = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline,
    articleBody,
  });
  return `<html><head><title>Shell</title>
<script type="application/ld+json">${payload}</script>
</head><body>
<p>Teaser corto.</p>
<div class="paywall">Suscríbete para seguir leyendo</div>
</body></html>`;
}

describe("paragraphizePlainBody", () => {
  it("splits a single blob into blank-line paragraphs", () => {
    const text = paragraphizePlainBody(BODY);
    expect(text).toContain("\n\n");
    expect(assessArticle(text).ok).toBe(true);
  });

  it("leaves already-paragraphed text alone", () => {
    const input =
      "Primero párrafo aquí con bastante texto.\n\nSegundo párrafo también largo.";
    expect(paragraphizePlainBody(input)).toBe(input);
  });

  it("keeps a dialogue tag inside its sentence when grouping", () => {
    expect(
      paragraphizePlainBody("—¡Vaya! —dijo el chico. —Lo sé. —Claro."),
    ).toBe("—¡Vaya! —dijo el chico. —Lo sé.\n\n—Claro.");
  });

  // Vocento JSON-LD often concatenates HTML paragraphs into articleBody
  // without a space after the period ("municipal.Al cierre").
  it("splits Vocento-style bodies that omit spaces after periods", () => {
    const glued = [
      "El Ayuntamiento de Valencia ha recibido un total de 53 solicitudes de personas interesadas en reabrir los quioscos cerrados en la ciudad.",
      "Al cierre del plazo el volumen de propuestas supera holgadamente el número de puestos ofertados por el consistorio.",
      "La convocatoria se enmarca en el convenio de colaboración suscrito con la asociación profesional de vendedores de prensa.",
      "El concurso público contempla el otorgamiento de títulos de ocupación privativa por un periodo inicial de veinte años.",
      "El pliego fija el carácter social de la convocatoria y un baremo automático de adjudicación para colectivos vulnerables.",
      "De hecho las bases permiten compatibilizar la venta de prensa con servicios complementarios autorizados por la ordenanza.",
    ].join("");
    const text = paragraphizePlainBody(glued);
    expect(text).toContain("\n\n");
    expect(text).toContain("quioscos cerrados");
    expect(text).toContain("Al cierre del plazo");
    expect(assessArticle(text).ok).toBe(true);
  });
});

describe("extractJsonLdArticle", () => {
  it("reads NewsArticle articleBody and headline", () => {
    const article = extractJsonLdArticle(
      newsArticleHtml(BODY, "Licitan las obras"),
    );
    expect(article?.title).toBe("Licitan las obras");
    expect(article?.text).toContain("Ayuntamiento de Valencia");
    expect(article?.text).toContain("\n\n");
    expect(assessArticle(article?.text ?? "").ok).toBe(true);
  });

  it("walks @graph for a nested NewsArticle", () => {
    const payload = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Las Provincias" },
        {
          "@type": ["NewsArticle", "Article"],
          headline: "Titular en grafo",
          articleBody: BODY,
        },
      ],
    });
    const html = `<html><body><script type="application/ld+json">${payload}</script></body></html>`;
    const article = extractJsonLdArticle(html);
    expect(article?.title).toBe("Titular en grafo");
    expect(assessArticle(article?.text ?? "").ok).toBe(true);
  });

  it("returns null when articleBody is missing or tiny", () => {
    expect(extractJsonLdArticle(newsArticleHtml("Corto."))).toBeNull();
    expect(
      extractJsonLdArticle(
        '<html><body><script type="application/ld+json">{"@type":"WebPage"}</script></body></html>',
      ),
    ).toBeNull();
  });
});
