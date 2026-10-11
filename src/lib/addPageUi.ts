import { normalizeUrl } from "./url";

export function addPageSaveLabel(options: {
  busy: boolean;
  fetchDetail: string | null;
  preprocessing: boolean;
  editId: string | null;
}): string {
  if (options.busy) {
    return options.fetchDetail ? "Fetching…" : "Saving…";
  }
  if (options.preprocessing) return "Preparing…";
  return options.editId ? "Save" : "Save & translate";
}

export function showAddPageTryAgain(options: {
  error: string | null;
  preprocessing: boolean;
  editId: string | null;
  url: string;
}): boolean {
  if (!options.error || options.preprocessing || options.editId) return false;
  return Boolean(normalizeUrl(options.url));
}
