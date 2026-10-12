import { describe, expect, it } from "vitest";
import { newArticle } from "./article";
import { repairGarbageTitle } from "./repairGarbageTitle";

describe("repairGarbageTitle", () => {
  it("returns null when the title is already readable", () => {
    const article = newArticle({
      url: null,
      title: "Un titular bueno",
      text: "Cuerpo del artículo con suficiente texto para pasar el mínimo.",
      via: "manual",
    });
    expect(repairGarbageTitle(article)).toBeNull();
  });

  it("replaces a Chrome reader share title with the first body headline", () => {
    const article = newArticle({
      url: null,
      title:
        "Including link: chrome-distiller://1712e844-db8f-4213-8dcb-ffe7c19a89ee_abc/",
      text: `La estación de metro con más viajeros en Valencia: más de 500.000 pasajeros en un mes

Nacho Ortega

El resto del artículo.`,
      via: "manual",
    });
    expect(repairGarbageTitle(article)).toBe(
      "La estación de metro con más viajeros en Valencia: más de 500.000 pasajeros en un mes",
    );
  });

  it("prefers cleanText when present", () => {
    const article = {
      ...newArticle({
        url: null,
        title: "Including link: chrome-distiller://abc/",
        text: "Including link: chrome-distiller://abc/\n\nTexto crudo.",
        via: "manual",
      }),
      cleanText:
        "Titular limpio del cuerpo\n\nPárrafo siguiente del artículo limpio.",
    };
    expect(repairGarbageTitle(article)).toBe("Titular limpio del cuerpo");
  });
});
