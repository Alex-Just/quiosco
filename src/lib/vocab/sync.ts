import { ankiFields, type VocabCard } from "./card";

export const ANKI_CONNECT_VERSION = 6;
export const ANKI_TAG = "quiosco";

interface AnkiInput {
  fetch: typeof fetch;
  ankiUrl: string;
  deck: string;
  model: string;
  cards: readonly VocabCard[];
}

interface AnkiNoteInfo {
  noteId: number;
  cards: number[];
  fields: { Word?: { value?: string } };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`vocab sync failed: HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

async function ankiInvoke(
  fetchImpl: typeof fetch,
  ankiUrl: string,
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetchImpl(ankiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: ANKI_CONNECT_VERSION, params }),
  });
  const body = (await readJson(response)) as {
    result?: unknown;
    error?: string | null;
  };
  if (body.error) throw new Error(body.error);
  return body.result;
}

export async function upsertAnki(
  input: AnkiInput,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const card of input.cards) {
    const query = `tag:${ANKI_TAG} Word:"${card.word.replaceAll('"', "")}"`;
    const found = (await ankiInvoke(input.fetch, input.ankiUrl, "findNotes", {
      query,
    })) as number[];
    const notes = found.length
      ? ((await ankiInvoke(input.fetch, input.ankiUrl, "notesInfo", {
          notes: found,
        })) as AnkiNoteInfo[])
      : [];
    const existing = notes.find(
      (note) => note.fields.Word?.value === card.word,
    );
    const fields = ankiFields(card);
    if (existing) {
      await ankiInvoke(input.fetch, input.ankiUrl, "updateNoteFields", {
        note: { id: existing.noteId, fields },
      });
      updated += 1;
      continue;
    }
    const noteId = (await ankiInvoke(input.fetch, input.ankiUrl, "addNote", {
      note: {
        deckName: input.deck,
        modelName: input.model,
        fields,
        tags: [ANKI_TAG],
        options: { allowDuplicate: false, duplicateScope: "deck" },
      },
    })) as number;
    const [added] = (await ankiInvoke(input.fetch, input.ankiUrl, "notesInfo", {
      notes: [noteId],
    })) as AnkiNoteInfo[];
    await ankiInvoke(input.fetch, input.ankiUrl, "changeDeck", {
      cards: added?.cards ?? [],
      deck: input.deck,
    });
    created += 1;
  }
  return { created, updated };
}
