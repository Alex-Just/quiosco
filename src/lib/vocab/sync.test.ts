import { describe, expect, it } from "vitest";
import type { VocabCard } from "./card";
import { upsertAnki } from "./sync";

const CARD: VocabCard = {
  id: "book\u001f1\u001f40\u001fperseverante",
  word: "perseverante",
  headword: "perseverante",
  context: "la perseverante copa\n\nнастойчивый бокал",
  definition: "Adjetivo",
  book: "Harry Potter",
  author: "J.K. Rowling",
  chapter: "3",
  page: 165,
  spine: 1,
  startOffset: 40,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("upsertAnki", () => {
  it("updates an existing note and adds a new one into the deck", async () => {
    const actions: { action: string; params: Record<string, unknown> }[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      actions.push(body);
      if (body.action === "findNotes") {
        const query = String(body.params.query);
        return jsonResponse({
          result: query.includes("casa") ? [] : [10],
          error: null,
        });
      }
      if (body.action === "notesInfo") {
        return jsonResponse({
          result: [
            {
              noteId: 10,
              cards: [99],
              fields: { Word: { value: "perseverante" } },
            },
          ],
          error: null,
        });
      }
      if (body.action === "addNote") {
        return jsonResponse({ result: 11, error: null });
      }
      return jsonResponse({ result: null, error: null });
    };
    const counts = await upsertAnki({
      fetch: fetchImpl,
      ankiUrl: "http://127.0.0.1:8765",
      deck: "Smart Book",
      model: "Word+Context",
      cards: [CARD, { ...CARD, id: "other", word: "casa" }],
    });
    expect(counts).toEqual({ created: 1, updated: 1 });
    expect(actions.some((call) => call.action === "updateNoteFields")).toBe(
      true,
    );
    expect(actions.some((call) => call.action === "changeDeck")).toBe(true);
    const moved = actions.find((call) => call.action === "changeDeck");
    expect(moved?.params).toMatchObject({ cards: [99], deck: "Smart Book" });
  });
});
