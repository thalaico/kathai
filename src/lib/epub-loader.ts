import ePub from 'epubjs';

export interface BookMetadata {
  title?: string;
  author?: string;
}

export interface Chapter {
  id: string;
  label: string;
  /** Raw HTML of the chapter body. Kept for future rich rendering. */
  htmlContent: string;
  /** Pre-extracted plain text (normalized whitespace). */
  plainText: string;
}

export interface LoadedBook {
  metadata: BookMetadata;
  chapters: Chapter[];
}

/** Minimum characters of body text for a spine item to count as a real chapter. */
export const MIN_CHAPTER_LENGTH = 50;

/**
 * Spine items larger than this are candidates for heading-based splitting.
 * Project Gutenberg stuffs entire novels into one XHTML file marked up
 * with <h2>Chapter I.</h2>, etc; anything smaller is probably already a
 * single chapter.
 */
export const SPLIT_LENGTH_THRESHOLD = 8000;

export async function loadEPUBFile(file: File): Promise<LoadedBook> {
  const buffer = await file.arrayBuffer();
  return loadEPUBFromBuffer(buffer);
}

export async function loadEPUBFromBuffer(buffer: ArrayBuffer): Promise<LoadedBook> {
  const book = ePub(buffer);
  await book.ready;

  const metadata = await book.loaded.metadata;

  // Build a TOC label map so we get real chapter names.
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

  let sectionIndex = 0;
  for (const item of spineItems) {
    try {
      // epub.js returns the documentElement (the <html> Element), not a Document.
      const root = (await item.load(book.load.bind(book))) as Element;
      const doc = root.ownerDocument ?? null;
      const body: Element | null = (doc?.body ?? root.querySelector?.('body')) || null;
      if (!body) {
        item.unload?.();
        sectionIndex++;
        continue;
      }

      const canonicalHref = String(item.href ?? '').split('#')[0];
      const sectionLabel =
        labelByHref.get(canonicalHref) ||
        item.label ||
        item.idref ||
        `Section ${sectionIndex + 1}`;

      const baseId = String(item.idref || `section-${sectionIndex}`);

      // Extract the whole section's text once to decide whether to split.
      const sectionText = extractText(body);

      const splitTag = sectionText.length >= SPLIT_LENGTH_THRESHOLD ? pickSplitTag(body) : null;
      const parts = splitTag ? splitAtHeadings(body, splitTag) : [];

      if (parts.length >= 2) {
        // Many chapters packed in one spine item — split and push each.
        parts.forEach((part, i) => {
          chapters.push({
            id: `${baseId}--${i}`,
            label: part.label || `${sectionLabel} ${i + 1}`,
            htmlContent: '', // fragment cloning is lossy across documents; skip for now
            plainText: part.text,
          });
        });
      } else {
        chapters.push({
          id: baseId,
          label: sectionLabel,
          htmlContent: body.innerHTML,
          plainText: sectionText,
        });
      }

      item.unload?.();
    } catch (err) {
      console.warn('Failed to load section', item?.idref, err);
    }
    sectionIndex++;
  }

  // Drop sections that have no real prose (covers, title pages, blank pages).
  const filtered = chapters.filter((c) => c.plainText.length >= MIN_CHAPTER_LENGTH);

  return {
    metadata: {
      title: metadata?.title,
      author: metadata?.creator,
    },
    // If filtering stripped everything (tiny/weird EPUB), show the raw list.
    chapters: filtered.length > 0 ? filtered : chapters,
  };
}

/** Grab normalized text from an element, ignoring scripts/styles. */
export function extractText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll?.('script, style').forEach((e) => e.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Pick the most frequent heading level (h1 / h2 / h3) in this element.
 * Returns null if no level has at least 2 headings — not worth splitting.
 * Ties prefer h2 (the typical "chapter" level), then h1, then h3.
 */
export function pickSplitTag(body: Element): 'h1' | 'h2' | 'h3' | null {
  const counts: Record<'h1' | 'h2' | 'h3', number> = {
    h1: body.querySelectorAll('h1').length,
    h2: body.querySelectorAll('h2').length,
    h3: body.querySelectorAll('h3').length,
  };
  const order: ('h1' | 'h2' | 'h3')[] = ['h2', 'h1', 'h3'];
  let best: 'h1' | 'h2' | 'h3' | null = null;
  let bestCount = 1;
  for (const tag of order) {
    if (counts[tag] > bestCount) {
      best = tag;
      bestCount = counts[tag];
    }
  }
  return bestCount >= 2 ? best : null;
}

/**
 * Split an element at each occurrence of `tag`, returning one entry per
 * section. The heading itself becomes the label and is included in the
 * section's text. Content before the first heading becomes an optional
 * prelude section if it's long enough.
 */
export function splitAtHeadings(
  body: Element,
  tag: 'h1' | 'h2' | 'h3',
): { label: string; text: string }[] {
  const doc = body.ownerDocument;
  if (!doc) return [];

  const headings = Array.from(body.querySelectorAll(tag));
  if (headings.length < 2) return [];

  const sections: { label: string; text: string }[] = [];

  // Optional prelude: everything before the first heading.
  try {
    const preludeRange = doc.createRange();
    preludeRange.setStart(body, 0);
    preludeRange.setEndBefore(headings[0]);
    const preludeText = rangeToText(preludeRange);
    if (preludeText.length >= MIN_CHAPTER_LENGTH) {
      sections.push({ label: 'Opening', text: preludeText });
    }
  } catch {
    // some trees can't be ranged cleanly — skip the prelude
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i];
    const end = headings[i + 1];
    try {
      const range = doc.createRange();
      range.setStartBefore(start);
      if (end) range.setEndBefore(end);
      else range.setEndAfter(body.lastChild || body);
      const text = rangeToText(range);
      const label = (start.textContent || '').replace(/\s+/g, ' ').trim() || `Chapter ${i + 1}`;
      sections.push({ label, text });
    } catch {
      // If range creation fails, fall back to plain textContent of the heading
      sections.push({
        label: (start.textContent || '').trim(),
        text: (start.textContent || '').trim(),
      });
    }
  }

  return sections;
}

function rangeToText(range: Range): string {
  const fragment = range.cloneContents();
  // DocumentFragment.querySelectorAll exists; strip scripts/styles.
  fragment.querySelectorAll?.('script, style').forEach((el) => el.remove());
  return (fragment.textContent || '').replace(/\s+/g, ' ').trim();
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
