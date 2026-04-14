import ePub from 'epubjs';

export interface BookMetadata {
  title?: string;
  author?: string;
}

export interface Chapter {
  id: string;
  label: string;
  /** Raw XHTML from the spine item. Kept for future rich rendering. */
  htmlContent: string;
  /** Pre-extracted plain text (normalized whitespace). */
  plainText: string;
}

export interface LoadedBook {
  metadata: BookMetadata;
  chapters: Chapter[];
}

/** Minimum characters of body text for a spine item to count as a real chapter. */
const MIN_CHAPTER_LENGTH = 50;

export async function loadEPUBFile(file: File): Promise<LoadedBook> {
  const buffer = await file.arrayBuffer();
  return loadEPUBFromBuffer(buffer);
}

export async function loadEPUBFromBuffer(buffer: ArrayBuffer): Promise<LoadedBook> {
  const book = ePub(buffer);
  await book.ready;

  const metadata = await book.loaded.metadata;

  // Build a label map from the TOC so we get real chapter names instead of
  // "Chapter N" placeholders. TOC items may have hash fragments — we key by
  // the canonical file part only.
  const nav = await book.loaded.navigation;
  const labelByHref = new Map<string, string>();
  const visit = (items: any[]) => {
    for (const it of items ?? []) {
      if (it?.href && it?.label) {
        const canonical = String(it.href).split('#')[0];
        if (!labelByHref.has(canonical)) labelByHref.set(canonical, String(it.label).trim());
      }
      if (it?.subitems?.length) visit(it.subitems);
    }
  };
  visit((nav as any)?.toc ?? []);

  const chapters: Chapter[] = [];
  const spineItems: any[] = (book.spine as any)?.spineItems ?? [];

  let index = 0;
  for (const item of spineItems) {
    try {
      // epub.js returns the documentElement (the <html> Element), not a Document.
      const root = (await item.load(book.load.bind(book))) as Element;
      const doc = root.ownerDocument ?? null;
      const body: Element | null = (doc?.body ?? root.querySelector?.('body')) || null;
      const textSource = body ?? root;

      // Clone so we don't mutate the cached parse; strip scripts/styles.
      const clone = textSource.cloneNode(true) as Element;
      clone.querySelectorAll?.('script, style').forEach((el) => el.remove());
      const plainText = (clone.textContent || '').replace(/\s+/g, ' ').trim();

      // Keep the HTML of the body (not the whole <html> element) so future
      // rich-rendering has clean markup without <head>/<title> noise.
      const htmlContent = body ? body.innerHTML : root.innerHTML ?? '';

      // Derive the best-effort label from TOC → spine.href → idref.
      const canonicalHref = String(item.href ?? '').split('#')[0];
      const label =
        labelByHref.get(canonicalHref) ||
        item.label ||
        item.idref ||
        `Section ${index + 1}`;

      chapters.push({
        id: item.idref || `section-${index}`,
        label,
        htmlContent,
        plainText,
      });

      item.unload?.();
    } catch (err) {
      console.warn('Failed to load section', item?.idref, err);
    }
    index++;
  }

  // Drop sections that have no real prose (covers, title pages, blank pages).
  const filtered = chapters.filter((c) => c.plainText.length >= MIN_CHAPTER_LENGTH);

  return {
    metadata: {
      title: metadata?.title,
      author: metadata?.creator,
    },
    // If filtering stripped everything (tiny or weird EPUB), fall back to the
    // unfiltered list so the user at least sees *something*.
    chapters: filtered.length > 0 ? filtered : chapters,
  };
}

/**
 * DOMParser-based text extraction from a full HTML document string.
 * Used as a runtime fallback for books cached before we stored `plainText`.
 */
export function extractPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style').forEach((el) => el.remove());
  const text = doc.body?.textContent || doc.documentElement?.textContent || '';
  return text.replace(/\s+/g, ' ').trim();
}
