import { writable } from 'svelte/store';
import { getAllFromDB, saveToDB, deleteFromDB, getFromDB } from '$lib/db';
import type { Chapter } from '$lib/epub-loader';

export interface Book {
  id: string;
  filename: string;
  title: string;
  author?: string;
  chapters: Chapter[];
  uploadedAt: number;
}

export interface Progress {
  bookId: string;
  chapterIndex: number;
  lastReadAt: number;
}

export const books = writable<Book[]>([]);
export const currentBook = writable<Book | null>(null);
export const currentChapterIndex = writable<number>(0);

export async function loadBooksFromDB(): Promise<Book[]> {
  const all = await getAllFromDB<Book>('epubs');
  all.sort((a, b) => b.uploadedAt - a.uploadedAt);
  books.set(all);
  return all;
}

export async function addBook(book: Book): Promise<void> {
  await saveToDB('epubs', book);
  await loadBooksFromDB();
}

export async function removeBook(bookId: string): Promise<void> {
  await deleteFromDB('epubs', bookId);
  await deleteFromDB('progress', bookId).catch(() => {});
  await loadBooksFromDB();
}

export async function saveProgress(bookId: string, chapterIndex: number): Promise<void> {
  const progress: Progress = { bookId, chapterIndex, lastReadAt: Date.now() };
  await saveToDB('progress', progress);
}

export async function getProgress(bookId: string): Promise<Progress | undefined> {
  return getFromDB<Progress>('progress', bookId);
}
