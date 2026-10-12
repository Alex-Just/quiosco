import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { bookSaveErrorMessage, epubErrorMessage } from "../lib/addPageErrors";
import { newBook } from "../lib/article";
import {
  EpubError,
  MAX_BOOK_FILE_BYTES,
  type ParsedBook,
  parseEpub,
} from "../lib/epub/parseEpub";
import type { ArticleStore } from "../lib/store";

type AddBookFormProps = {
  store: ArticleStore;
  /** EPUB received through the Android share sheet; parsed like a picked file. */
  sharedFile?: File | null;
  /** Called once the shared file has been handed to the parse path. */
  onSharedConsumed?: () => void;
  onSaved: (id: string) => void;
};

/** Title to prefill when the EPUB has none: the file name without ".epub". */
function fileNameTitle(fileName: string): string {
  return fileName.replace(/\.epub$/i, "").trim();
}

const countChars = (chapters: ParsedBook["chapters"]) =>
  chapters.reduce((total, chapter) => total + chapter.text.length, 0);

export function AddBookForm({
  store,
  sharedFile,
  onSharedConsumed,
  onSaved,
}: AddBookFormProps) {
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [preview, setPreview] = useState<ParsedBook | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Bumped on every pick so a slow parse cannot overwrite a newer one.
  const pickRef = useRef(0);
  // The shared file is parsed once, exactly like a picked one.
  const consumedSharedRef = useRef<File | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: onFile/onSharedConsumed are fresh closures; the shared file identity is the trigger
  useEffect(() => {
    if (!sharedFile || consumedSharedRef.current === sharedFile) return;
    consumedSharedRef.current = sharedFile;
    onSharedConsumed?.();
    void onFile(sharedFile);
  }, [sharedFile]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    pickRef.current += 1;
    const pick = pickRef.current;
    setFileName(file.name);
    setProgress(null);
    setPreview(null);
    setError(null);
    if (file.size > MAX_BOOK_FILE_BYTES) {
      setError(epubErrorMessage(new EpubError("too-large")));
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const book = await parseEpub(bytes, (done, total) => {
        if (pickRef.current === pick) setProgress({ done, total });
      });
      if (pickRef.current !== pick) return;
      setPreview(book);
      setTitle(book.title.trim() || fileNameTitle(file.name));
      setAuthor(book.author ?? "");
    } catch (parseError) {
      if (pickRef.current !== pick) return;
      setError(epubErrorMessage(parseError));
      // Let the same file be picked again after a failed read.
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      if (pickRef.current === pick) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  async function onSave() {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const book = newBook({
        title: title.trim() || fileNameTitle(fileName),
        author: author.trim() || null,
        language: preview.language,
        chapters: preview.chapters,
      });
      await store.put(book);
      onSaved(book.id);
    } catch (saveError) {
      setError(bookSaveErrorMessage(saveError));
      setBusy(false);
    }
  }

  return (
    <div className="book-form">
      <label>
        EPUB file
        <input
          ref={inputRef}
          type="file"
          accept=".epub,application/epub+zip"
          disabled={busy}
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
      </label>
      {progress && (
        <p className="muted" aria-live="polite">
          Reading book… chapter {progress.done}/{progress.total}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {preview && (
        <>
          <div className="book-preview">
            <p>
              {preview.chapters.length}{" "}
              {preview.chapters.length === 1 ? "chapter" : "chapters"} ·{" "}
              {countChars(preview.chapters).toLocaleString()} characters
            </p>
          </div>
          <label>
            Book title
            <input
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Author (optional)
            <input
              value={author}
              disabled={busy}
              onChange={(event) => setAuthor(event.target.value)}
            />
          </label>
        </>
      )}
      {!preview && !busy && !error && (
        <p className="muted">
          Pick an EPUB file to import it. Books stay on this device.
        </p>
      )}
      <div className="row form-actions">
        {preview && (
          <button
            type="button"
            className="primary"
            onClick={() => void onSave()}
            disabled={busy}
          >
            Save
          </button>
        )}
        <Link className="button" to="/">
          Cancel
        </Link>
      </div>
    </div>
  );
}
