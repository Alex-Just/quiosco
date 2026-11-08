import { describe, expect, it } from "vitest";
import { alignChapter, foldToken, type TimedWord, tokenize } from "./align";

/** Transcript words for `text`, evenly paced, starting at `offset`. */
function spoken(text: string, secondsPerWord = 0.5, offset = 0): TimedWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({
      text: word,
      start: offset + index * secondsPerWord,
      end: offset + index * secondsPerWord + secondsPerWord * 0.9,
    }));
}

const WPM = 0.5;

describe("foldToken", () => {
  it("ignores case and accents", () => {
    expect(foldToken("CÁLIZ")).toBe("caliz");
    expect(foldToken("Ryddle")).toBe("ryddle");
  });
});

describe("tokenize", () => {
  it("keeps letters and digits and drops punctuation", () => {
    expect(tokenize("—¿Qué tal, Sr. García? ¡Bien!")).toEqual([
      "que",
      "tal",
      "sr",
      "garcia",
      "bien",
    ]);
  });
});

describe("alignChapter", () => {
  it("maps an exact transcript word for word", () => {
    const units = ["Hola mundo.", "Segunda frase.", "Tercera."];
    const words = spoken("Hola mundo. Segunda frase. Tercera.", WPM);
    const { starts, ends, coverage } = alignChapter(units, words, 2.5);

    expect(coverage).toBe(1);
    expect(starts).toEqual([0, 1, 2]);
    expect(ends).toEqual([1, 2, 2.5]);
  });

  it("splits a sentence's time where the next one begins", () => {
    const units = ["Uno dos tres.", "Cuatro cinco."];
    const words = spoken("Uno dos tres. Cuatro cinco.", 1);
    const { starts, ends } = alignChapter(units, words, 10);

    expect(starts).toEqual([0, 3]);
    // The pause before "Cuatro" belongs to the sentence that just closed.
    expect(ends).toEqual([3, 10]);
  });

  it("interpolates a sentence the narrator skipped", () => {
    const units = ["Uno.", "Dos.", "Tres."];
    const words = spoken("Uno. Tres.", 1);
    const { starts, ends, coverage } = alignChapter(units, words, 3);

    expect(starts).toEqual([0, 0.5, 1]);
    expect(ends).toEqual([0.5, 1, 3]);
    expect(coverage).toBeCloseTo(2 / 3, 5);
  });

  it("survives an OCR slip inside a sentence", () => {
    const units = ["La Mansión de los Ryddle.", "La cicatriz."];
    const words = spoken("La Mansión de los Riddle. La cicatriz.", 1);
    const { starts, coverage } = alignChapter(units, words, 10);

    expect(starts).toEqual([0, 5]);
    expect(coverage).toBeCloseTo(6 / 7, 5);
  });

  it("starts after an audio-only introduction", () => {
    const units = ["Uno.", "Dos."];
    const intro = spoken("Editorial presenta este audiolibro", 0.5);
    const body = spoken("Uno. Dos.", 1, 3);
    const { starts } = alignChapter(units, [...intro, ...body], 10);

    expect(starts).toEqual([3, 4]);
  });

  it("spreads the whole chapter when the transcript is empty", () => {
    const units = ["Aaaa.", "Bbbb.", "Cccc."];
    const { starts, ends, coverage } = alignChapter(units, [], 6);

    expect(coverage).toBe(0);
    expect(starts).toEqual([1, 3, 5]);
    expect(ends).toEqual([3, 5, 6]);
  });

  it("keeps times usable when the narrator repeats a word", () => {
    const units = ["Uno.", "Dos.", "Tres."];
    const words = spoken("Uno. Uno. Dos. Tres.", 1);
    const { starts, ends, coverage } = alignChapter(units, words, 10);

    expect(coverage).toBe(1);
    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index] ?? Number.NaN;
      const end = ends[index] ?? Number.NaN;
      if (index > 0) {
        expect(start).toBeGreaterThanOrEqual(starts[index - 1] ?? Number.NaN);
      }
      expect(end).toBeGreaterThanOrEqual(start);
      expect(end).toBeLessThanOrEqual(10);
    }
  });

  it("accepts an empty chapter", () => {
    expect(alignChapter([], [], 0)).toEqual({
      starts: [],
      ends: [],
      coverage: 0,
    });
  });
});
