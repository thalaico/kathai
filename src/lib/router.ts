/*
 * Tiny path-based router. The URL is the source of truth for navigation:
 * components call navigateTo*() helpers and everything else (the book
 * stores, the reader view) falls out of that.
 *
 * Routes:
 *   /                           → the shelf
 *   /book/:bookId               → book, chapter 0
 *   /book/:bookId/:chapter      → book at a specific chapter
 *
 * bookId is the stable identifier kathai already uses:
 *   - `gutenberg-<id>` for Project Gutenberg imports (stable & shareable)
 *   - a UUID for uploaded files (stable per device)
 */

import { get } from 'svelte/store';
import { books, currentBook, currentChapterIndex, type Book } from '$stores/books';

export type Route =
  | { type: 'shelf' }
  | { type: 'book'; bookId: string; chapter: number };

export function parseRoute(pathname: string): Route {
  const m = pathname.match(/^\/book\/([^/]+)(?:\/(\d+))?\/?$/);
  if (!m) return { type: 'shelf' };
  return {
    type: 'book',
    bookId: decodeURIComponent(m[1]),
    chapter: Math.max(0, parseInt(m[2] ?? '0', 10) || 0),
  };
}

export function formatRoute(route: Route): string {
  if (route.type === 'shelf') return '/';
  return `/book/${encodeURIComponent(route.bookId)}/${route.chapter}`;
}

/**
 * Resolve the current `location.pathname` against the loaded library and
 * apply it to the stores. Call after books have been loaded from IndexedDB.
 * Unknown book IDs silently fall back to the shelf.
 */
export function syncFromUrl(): void {
  const route = parseRoute(location.pathname);

  if (route.type === 'shelf') {
    currentBook.set(null);
    return;
  }

  const book = get(books).find((b) => b.id === route.bookId);
  if (book) {
    currentBook.set(book);
    currentChapterIndex.set(route.chapter);
    return;
  }

  // URL referenced a book we don't have. Fall back to the shelf and
  // quietly rewrite the URL so reload/share doesn't keep landing here.
  currentBook.set(null);
  if (location.pathname !== '/') history.replaceState({}, '', '/');
}

export function navigateToBook(book: Book, chapter = 0): void {
  const path = formatRoute({ type: 'book', bookId: book.id, chapter });
  if (location.pathname !== path) history.pushState({}, '', path);
  currentBook.set(book);
  currentChapterIndex.set(chapter);
}

export function navigateToChapter(chapter: number): void {
  const book = get(currentBook);
  if (!book) return;
  const clamped = Math.max(0, chapter);
  const path = formatRoute({ type: 'book', bookId: book.id, chapter: clamped });
  // replaceState: chapter changes update the URL but don't add history
  // entries, so browser Back returns to the shelf, not the previous chapter.
  if (location.pathname !== path) history.replaceState({}, '', path);
  currentChapterIndex.set(clamped);
}

export function navigateToShelf(): void {
  if (location.pathname !== '/') history.pushState({}, '', '/');
  currentBook.set(null);
}

/**
 * Wire up browser-level navigation. Call once, after the library has been
 * loaded from IndexedDB, so deep links resolve against real data.
 */
export function installRouter(): void {
  window.addEventListener('popstate', syncFromUrl);
  syncFromUrl();
}
