/*
 * Project Gutenberg discovery via Gutendex.
 *
 * Gutendex (https://gutendex.com) is a free, no-key JSON API over the
 * Project Gutenberg catalog. We use it for metadata + search, and fetch
 * the EPUB bytes directly from whatever URL Gutendex returns.
 */

const GUTENDEX = 'https://gutendex.com/books/';

export interface GutenbergBook {
  id: number;
  title: string;
  authors: string[];
  languages: string[];
  downloadCount: number;
  epubUrl?: string;
}

interface GutendexAuthor {
  name: string;
  birth_year?: number | null;
  death_year?: number | null;
}

interface GutendexBook {
  id: number;
  title: string;
  authors: GutendexAuthor[];
  languages: string[];
  download_count: number;
  formats: Record<string, string>;
}

interface GutendexResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: GutendexBook[];
}

export interface SearchResult {
  books: GutenbergBook[];
  hasMore: boolean;
  total: number;
}

function pickEpubUrl(formats: Record<string, string>): string | undefined {
  // Prefer images-free EPUB if present, else any application/epub+zip variant.
  const keys = Object.keys(formats);
  const epubKey =
    keys.find((k) => k.startsWith('application/epub+zip') && !formats[k].includes('.images')) ||
    keys.find((k) => k.startsWith('application/epub+zip'));
  return epubKey ? formats[epubKey] : undefined;
}

function normalize(b: GutendexBook): GutenbergBook {
  return {
    id: b.id,
    title: b.title,
    authors: b.authors.map((a) => a.name),
    languages: b.languages,
    downloadCount: b.download_count,
    epubUrl: pickEpubUrl(b.formats),
  };
}

export interface SearchOptions {
  page?: number;
  /** ISO 639-1 code, or 'all' / undefined to skip the filter. */
  language?: string;
  signal?: AbortSignal;
}

export async function searchGutenberg(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const { page = 1, language, signal } = opts;
  const params = new URLSearchParams();
  if (query.trim()) params.set('search', query.trim());
  params.set('page', String(page));
  if (language && language !== 'all') params.set('languages', language);
  // Popular first when not searching, otherwise default relevance.
  if (!query.trim()) params.set('sort', 'popular');

  const res = await fetch(`${GUTENDEX}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Gutendex ${res.status}`);

  const data: GutendexResponse = await res.json();
  return {
    books: data.results.map(normalize).filter((b) => !!b.epubUrl),
    hasMore: !!data.next,
    total: data.count,
  };
}

/** Top languages on Project Gutenberg, by book count (approx). */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'all', label: 'all languages' },
  { code: 'en', label: 'english' },
  { code: 'fr', label: 'français' },
  { code: 'de', label: 'deutsch' },
  { code: 'es', label: 'español' },
  { code: 'it', label: 'italiano' },
  { code: 'pt', label: 'português' },
  { code: 'nl', label: 'nederlands' },
  { code: 'fi', label: 'suomi' },
  { code: 'zh', label: '中文' },
  { code: 'la', label: 'latina' },
];

export async function downloadGutenbergEPUB(
  book: GutenbergBook,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!book.epubUrl) throw new Error('No EPUB available for this book');

  // Gutenberg mirrors generally serve CORS *. If this throws on some network,
  // surface it — we won't paper over it with a proxy (zero-backend promise).
  const res = await fetch(book.epubUrl, { signal, mode: 'cors' });
  if (!res.ok) throw new Error(`Gutenberg ${res.status}`);
  return res.arrayBuffer();
}
