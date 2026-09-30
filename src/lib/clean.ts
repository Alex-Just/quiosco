// Best-effort cleanup for raw pasted article text (and extraction fallbacks):
// drops page furniture that survives when there is no HTML structure to lean
// on — cookie-consent blocks, nav/link lists, tickers, footer labels — while
// leaving ordinary prose untouched. Deliberately conservative: it only removes
// patterns that are unambiguous page chrome.

const NAV_LABELS = new Set([
  "aceptar y continuar",
  "aviso legal",
  "borrar",
  "buscar",
  "cancelar",
  "cerrar",
  "comenta",
  "comentarios",
  "comparte",
  "contacto",
  "descárgate la app",
  "edición impresa",
  "es noticia",
  "hemeroteca",
  "iniciar sesión",
  "kiosco",
  "lo más leído",
  "menú",
  "newsletter",
  "newsletters",
  "política de cookies",
  "publicidad",
  "quiénes somos",
  "regala esta noticia",
  "regístrate",
  "reportar un error",
  "rss",
  "saltar al contenido",
  "servicios",
  "share article",
  "síguenos",
  "sorteos",
  "suscríbete",
  "temas",
  "términos y condiciones",
]);

const COOKIE_KEYWORDS = [
  "consentimiento",
  "cookie",
  "navegación",
  "personalizad",
  "publicidad",
  "socios",
  "tratamiento de datos",
];

const CONSENT_FLAVOR =
  /consentimiento|tratamiento de datos|navegación|socios|aceptar|rechazar|configurar/;

const ENGLISH_CONSENT =
  /we and our partners|process data for the following purposes/;

const TICKER_PREFIX =
  /^(última hora|lo más leído|las más leídas|te puede interesar|lee también|más noticias|noticias relacionadas)\b/;

export function cleanArticleText(raw: string, title?: string): string {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const kept: string[] = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !isNoiseLine(line));
    const text = lines.join("\n").trim();
    if (!text || isNoiseBlock(text)) continue;
    kept.push(stripMarkdown(text));
  }
  if (title) {
    const needle = normalizeForMatch(title);
    if (needle.length >= 10) {
      const index = kept.findIndex((block) =>
        normalizeForMatch(stripDecorations(block)).startsWith(needle),
      );
      if (index > 0) kept.splice(0, index);
    }
  }
  return kept
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNoiseLine(line: string): boolean {
  if (/^!\[[^\]]*\]\([^)]*\)$/.test(line)) return true;
  if (/^([*+-]|\d+\.)\s*!\[[^\]]*\]\([^)]*\)$/.test(line)) return true;
  if (/^\[[^\]]*\]\([^)]*\)$/.test(line)) return true;
  if (/^([*+-]|\d+\.)\s*\[[^\]]*\]\([^)]*\)$/.test(line)) return true;
  if (/^([*+-]|\d+\.)?\s*https?:\/\/\S+$/.test(line)) return true;
  if (/^\*+$/.test(line)) return true;
  // Nested markdown nav items (image inside a link) such as
  // "*   [![Image 1: ...](...svg) Historias visuales](...)".
  if ((line.match(/\]\(/g)?.length ?? 0) >= 2 && line.length <= 250)
    return true;
  return false;
}

function isNoiseBlock(text: string): boolean {
  const flat = stripDecorations(text);
  const lower = flat.toLowerCase();
  if (ENGLISH_CONSENT.test(lower)) return true;
  if (TICKER_PREFIX.test(lower)) return true;
  if (flat.length <= 80) {
    if (NAV_LABELS.has(lower)) return true;
    const tokens = lower.split(/[\s\n]+/).filter((token) => token.length > 0);
    if (tokens.length > 1 && tokens.every((token) => NAV_LABELS.has(token))) {
      return true;
    }
  }
  const hits = COOKIE_KEYWORDS.filter((keyword) =>
    lower.includes(keyword),
  ).length;
  return hits >= 3 && CONSENT_FLAVOR.test(lower);
}

function stripDecorations(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^([*+-]|\d+\.)\s+/gm, "")
    .trim();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
