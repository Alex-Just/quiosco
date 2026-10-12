export interface SpineRef {
  idref: string;
  linear: boolean;
}

export interface PackageItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

export interface PackageDoc {
  title: string;
  author: string | null;
  language: string | null;
  items: PackageItem[];
  spine: SpineRef[];
  ncxId: string | null;
  navId: string | null;
}

const NCX_MEDIA_TYPE = "application/x-dtbncx+xml";

/**
 * Zip path for an `href` found in the document stored in directory `baseDir`:
 * `#fragment` is dropped, percent escapes are decoded, and `.`/`..` are
 * resolved. Each leading `..` walks up from the document's own folder (the
 * base directory); the remaining base prefix is kept, so the result is a
 * zip-root path and never starts with `/`.
 */
export function resolveZipPath(baseDir: string, href: string): string {
  const withoutFragment = href.split("#")[0] ?? "";
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  const clean = (path: string) =>
    path.split("/").filter((part) => part !== "" && part !== ".");
  const base = clean(baseDir);
  let target = clean(withoutFragment);
  // Design a path that sits where the href points: `..` walks up from the
  // document folder; once a target segment is reached, the path descends.
  while (target[0] === "..") {
    target = target.slice(1);
    if (base.length > 0) base.pop();
  }
  const parts = [...base, ...target].reduce<string[]>((acc, part) => {
    const segment = decode(part);
    if (segment === "..") {
      acc.pop();
      return acc;
    }
    acc.push(segment);
    return acc;
  }, []);
  return parts.join("/");
}

/** Root of the `container.xml` XML parse, or null when it is malformed. */
function parseXml(xml: string): Document | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  // jsdom roots a failed parse at `parsererror` itself rather than nesting it
  // in a document element, which the qualified lookup above can miss.
  if (doc.documentElement?.localName === "parsererror") return null;
  return doc;
}

/**
 * Elements matching `localName`, tolerating both namespaced (`dc:title`) and
 * plain (`title`) names. Qualified-name lookups come first because they keep
 * working for namespace-prefixed documents; the namespace-aware lookup is the
 * fallback.
 */
function findElements(root: Document | Element, localName: string): Element[] {
  const qualified = root.getElementsByTagName(localName);
  if (qualified.length > 0) return Array.from(qualified);
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

function attribute(element: Element, name: string): string {
  return element.getAttribute(name) ?? element.getAttributeNS(null, name) ?? "";
}

function textOf(root: Document | Element, localName: string): string | null {
  const [first] = findElements(root, localName);
  const text = first?.textContent?.trim();
  return text ? text : null;
}

/** Package document path (`full-path`) declared in `META-INF/container.xml`. */
export function containerRootPath(containerXml: string): string | null {
  const doc = parseXml(containerXml);
  if (!doc) return null;
  const [rootfile] = findElements(doc, "rootfile");
  const path = rootfile ? attribute(rootfile, "full-path").trim() : "";
  return path || null;
}

/**
 * Title, creator, language, manifest, spine, and TOC ids of one OPF package.
 * Returns null when the XML cannot be parsed.
 */
export function parsePackage(opfXml: string): PackageDoc | null {
  const doc = parseXml(opfXml);
  if (!doc) return null;

  const items: PackageItem[] = findElements(doc, "item").map((item) => ({
    id: attribute(item, "id"),
    href: attribute(item, "href"),
    mediaType: attribute(item, "media-type"),
    properties: attribute(item, "properties"),
  }));

  const spine = findElements(doc, "itemref").map((itemref) => ({
    idref: attribute(itemref, "idref"),
    linear: attribute(itemref, "linear").toLowerCase() !== "no",
  }));

  const [spineElement] = findElements(doc, "spine");
  const spineToc = spineElement ? attribute(spineElement, "toc").trim() : "";
  const ncxItem = items.find((item) => item.mediaType === NCX_MEDIA_TYPE);
  const navItem = items.find((item) =>
    item.properties.split(/\s+/).includes("nav"),
  );

  return {
    title: textOf(doc, "title") ?? "",
    author: textOf(doc, "creator"),
    language: textOf(doc, "language"),
    items,
    spine,
    ncxId: spineToc || ncxItem?.id || null,
    navId: navItem?.id ?? null,
  };
}

/** True when a `nav` lists `toc` in its `epub:type`/`type` token list. */
function isTocNav(nav: Element): boolean {
  return [attribute(nav, "epub:type"), attribute(nav, "type")].some((types) =>
    types.split(/\s+/).includes("toc"),
  );
}

/**
 * Chapter labels keyed by resolved zip path. A single implementation covers
 * both an EPUB2 NCX (`navPoint`/`navLabel`/`content@src`, nested navPoints
 * included) and an EPUB3 nav document. Anchors are read from the `nav` whose
 * `epub:type`/`type` says `toc`; only a document without a toc nav falls back
 * to scanning every nav. When several entries point at the same path the first
 * label in document order wins.
 */
export function parseTocLabels(
  xml: string,
  baseDir: string,
): Map<string, string> {
  const labels = new Map<string, string>();
  const doc = parseXml(xml);
  if (!doc) return labels;

  for (const navPoint of findElements(doc, "navPoint")) {
    const [content] = findElements(navPoint, "content");
    const src = content ? attribute(content, "src") : "";
    if (!src) continue;
    const label = textOf(navPoint, "text");
    if (!label) continue;
    const path = resolveZipPath(baseDir, src);
    if (!labels.has(path)) labels.set(path, label);
  }

  const navs = findElements(doc, "nav");
  const tocNavs = navs.filter(isTocNav);
  // A landmarks nav carries no chapter labels: scan it only when the document
  // declares no toc nav at all.
  for (const nav of tocNavs.length > 0 ? tocNavs : navs) {
    for (const anchor of findElements(nav, "a")) {
      const href = attribute(anchor, "href");
      const label = anchor.textContent?.trim();
      if (!href || !label) continue;
      const path = resolveZipPath(baseDir, href);
      if (!labels.has(path)) labels.set(path, label);
    }
  }

  return labels;
}
