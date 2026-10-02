import { describe, expect, it } from "vitest";
import { cleanArticleText } from "./clean";

const TITLE =
  "Colombianos, ucranianos e italianos lideran el crisol inmigrante en Valencia";

const noisyPaste = `Configura tu navegación

El contenido de Las Provincias es fruto del trabajo de los más de 1.000 periodistas que forman parte del Grupo Vocento y se encuentra financiado por publicidad y suscripciones premium.

Para acceder al contenido le ofrecemos una modalidad de navegación que le permite acceder y leer la totalidad de contenidos no cerrados a suscripción premium sin instalación de cookies y tecnologías similares. Por tanto, usted podrá navegar sin que llevemos a cabo ningún tratamiento de datos basado en su consentimiento.

Puedes encontrar información sobre el tratamiento de datos en nuestra [Política de Cookies](javascript:Didomi.preferences.show()) y sobre la propiedad de este sitio en el [Aviso Legal](https://www.lasprovincias.es/aviso-legal.html).

Con su consentimiento, nosotros y [nuestros 688 socios](javascript:Didomi.preferences.show('vendors')) usamos cookies o tecnologías similares para almacenar, acceder y procesar datos personales.

We and our partners process data for the following purposes:
*   Actively scan device characteristics for identification
*   Create profiles for personalised advertising

Aceptar y continuar

[Saltar al contenido](https://www.lasprovincias.es/a.html#main)

*   [Newsletters](https://www.lasprovincias.es/newsletters)
*   [Vivienda](https://www.lasprovincias.es/vivienda)
*   [Televisión](https://www.lasprovincias.es/tv)

Servicios

*   [Loterías y sorteos](https://www.lasprovincias.es/sorteos/)
*   [Hemeroteca digital](https://www.lasprovincias.es/hemeroteca/)

Síguenos

última hora[Un jugador de La Bonoloto se lleva más de 815.232 euros](https://www.lasprovincias.es/bonoloto.html)

# Colombianos, ucranianos e italianos lideran el crisol inmigrante en Valencia

## La población extranjera alcanza el 21,1% de la población

Share Article

![Image 6: Colombianos, ucranianos e italianos](https://s3.ppllstatics.com/foto.jpg)

El Ayuntamiento de Valencia notificó el pasado mes de mayo al Instituto Nacional de Estadística una población de 858.178 residentes a 1 de enero de 2026.

El fenómeno de las migraciones ha sido decisivo los últimos lustros para aumentar la población y, sobre todo, rejuvenecerla.

### Newsletter

En cifras totales, el mayor porcentaje de residentes extranjeros se sitúa en el distrito Marítimo.

Comenta

Reportar un error

Lo más leído

1.   [Valencia se blinda ante la nueva alerta naranja](https://www.lasprovincias.es/a.html)
2.   [Emergencias advierte que la alerta roja](https://www.lasprovincias.es/b.html)

Temas

*   [Valencia (Ciudad)](https://www.lasprovincias.es/temas/valencia.html)
*   [Australia](https://www.lasprovincias.es/temas/australia.html)`;

describe("cleanArticleText", () => {
  it("strips cookie, nav, ticker and footer noise from a full-page paste", () => {
    const cleaned = cleanArticleText(noisyPaste, TITLE);
    expect(cleaned.startsWith("Colombianos")).toBe(true);
    expect(cleaned).toContain("El Ayuntamiento de Valencia notificó");
    expect(cleaned).toContain("En cifras totales");
    expect(cleaned).toContain("La población extranjera alcanza");
    for (const noise of [
      "Configura tu navegación",
      "688 socios",
      "Aviso Legal",
      "Aceptar y continuar",
      "We and our partners",
      "Newsletters",
      "Servicios",
      "Síguenos",
      "Share Article",
      "Lo más leído",
      "Hemeroteca",
      "Reportar un error",
      "### Newsletter",
      "última hora",
      "Image 6",
    ]) {
      expect(cleaned).not.toContain(noise);
    }
    expect(cleaned.length).toBeLessThan(noisyPaste.length);
  });

  it("cuts everything before the article title when the title matches", () => {
    const paste = `Menú de navegación\n\n[Portada](https://example.com/)\n\n${TITLE}\n\nCuerpo del artículo con suficiente longitud para conservarse íntegro.`;
    const cleaned = cleanArticleText(paste, TITLE);
    expect(cleaned.startsWith(TITLE)).toBe(true);
    expect(cleaned).toContain("Cuerpo del artículo");
  });

  it("keeps plain prose untouched", () => {
    const prose =
      "El Ayuntamiento de Valencia notificó una población de 858.178 residentes.\n\nEl fenómeno de las migraciones ha sido decisivo los últimos lustros para aumentar la población.";
    expect(cleanArticleText(prose)).toBe(prose);
  });

  it("keeps prose that merely mentions cookies once", () => {
    const prose =
      "La nueva normativa obliga a los sitios a revisar su política de cookies antes de diciembre.\n\nLos editores piden más tiempo para adaptarse.";
    expect(cleanArticleText(prose)).toBe(prose);
  });

  it("removes link-only lines and bulleted link lists", () => {
    const paste =
      "Enlaces\n\n*   [Vivienda](https://example.com/vivienda)\n*   [Televisión](https://example.com/tv)\n\n[Contacto](https://example.com/contacto)\n\nTexto final que se conserva.";
    const cleaned = cleanArticleText(paste);
    expect(cleaned).not.toContain("Vivienda");
    expect(cleaned).not.toContain("Contacto");
    expect(cleaned).toContain("Texto final que se conserva.");
  });

  it("removes the Chrome reader-mode share artifact", () => {
    const paste =
      "Including link: chrome-distiller://4d67abef-fceb-4fe6-ba24-e052647073d4_6e7021b4f7948796fbd6c3443a0a9457241b0f45a77a2417652c9d223ba26076/\n\nEl Gobierno aprobó este viernes nuevas medidas económicas para contener la inflación.\n\nSegundo párrafo del artículo con el resto de la información.";
    const cleaned = cleanArticleText(paste);
    expect(cleaned.startsWith("El Gobierno aprobó")).toBe(true);
    expect(cleaned).not.toContain("chrome-distiller");
  });

  it("removes bare distiller link lines", () => {
    const paste =
      "chrome-distiller://abc123/\n\nTexto del artículo que se conserva íntegro.";
    expect(cleanArticleText(paste)).toBe(
      "Texto del artículo que se conserva íntegro.",
    );
  });

  it("keeps short blocks that are not nav labels", () => {
    const paste = "—No lo sé.\n\nAyer.\n\nEl resto del texto de la noticia.";
    expect(cleanArticleText(paste)).toBe(paste);
  });

  it("converts surviving inline markdown links to their text", () => {
    const paste =
      "Puedes leer más en [nuestro reportaje](https://example.com/reportaje) sobre el tema.\n\nSegundo párrafo del artículo.";
    const cleaned = cleanArticleText(paste);
    expect(cleaned).toContain("nuestro reportaje");
    expect(cleaned).not.toContain("](");
  });

  it("is idempotent", () => {
    const once = cleanArticleText(noisyPaste, TITLE);
    expect(cleanArticleText(once, TITLE)).toBe(once);
  });
});
