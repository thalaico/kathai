<script lang="ts">
  import {
    books,
    addBook,
    removeBook,
    currentBook,
    currentChapterIndex,
    getProgress,
    type Book,
  } from '$stores/books';
  import { loadEPUBFile } from '$lib/epub-loader';
  import Discover from './Discover.svelte';

  let isLoading = $state(false);
  let error = $state('');

  async function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    isLoading = true;
    error = '';

    try {
      const loaded = await loadEPUBFile(file);
      const book: Book = {
        id: crypto.randomUUID(),
        filename: file.name,
        title: loaded.metadata.title || file.name,
        author: loaded.metadata.author,
        chapters: loaded.chapters,
        uploadedAt: Date.now(),
      };
      await addBook(book);
    } catch (err) {
      console.error(err);
      error = `Could not open that file.`;
    } finally {
      isLoading = false;
      target.value = '';
    }
  }

  async function selectBook(book: Book) {
    const progress = await getProgress(book.id);
    currentChapterIndex.set(progress?.chapterIndex ?? 0);
    currentBook.set(book);
  }

  async function deleteBook(e: Event, bookId: string) {
    e.stopPropagation();
    if (confirm('Remove this book from the shelf?')) {
      await removeBook(bookId);
    }
  }
</script>

<div class="page">
  <header>
    <h1>kathai</h1>
    <p class="subtitle">a reading room</p>
  </header>

  <hr class="rule" />

  <label class="upload" class:loading={isLoading}>
    <input type="file" accept=".epub" onchange={handleFileUpload} disabled={isLoading} />
    <span>{isLoading ? 'opening…' : '+ add a book'}</span>
  </label>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if $books.length === 0}
    <p class="empty">
      the shelf is empty.<br />
      add an <em>.epub</em> — or pick one from below.
    </p>
  {:else}
    <ul class="shelf">
      {#each $books as book (book.id)}
        <li>
          <button class="entry" onclick={() => selectBook(book)}>
            <span class="title">{book.title}</span>
            {#if book.author}
              <span class="author"> — {book.author}</span>
            {/if}
            <span class="meta">{book.chapters.length} ch.</span>
          </button>
          <button class="remove" onclick={(e) => deleteBook(e, book.id)} aria-label="remove">
            ×
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <Discover />

  <footer>
    <p>— kathai —</p>
  </footer>
</div>

<style>
  .page {
    max-width: 36rem;
    margin: 0 auto;
    padding: 3rem 1.75rem 4rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    text-align: center;
  }

  h1 {
    font-size: 2.4rem;
    font-weight: 400;
    font-variant: small-caps;
    letter-spacing: 0.08em;
    color: var(--ink);
  }

  .subtitle {
    margin-top: 0.25rem;
    font-style: italic;
    color: var(--ink-soft);
    font-size: 0.95rem;
  }

  .rule {
    border: none;
    border-top: 1px solid var(--rule);
    margin: 1.75rem 0 1.5rem;
  }

  .upload {
    display: block;
    text-align: center;
    padding: 0.9rem 1rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    cursor: pointer;
    color: var(--ink-soft);
    font-style: italic;
    background: transparent;
    transition: color 0.15s, border-color 0.15s;
  }

  .upload:hover {
    color: var(--ink);
    border-color: var(--ink-soft);
  }

  .upload.loading {
    opacity: 0.6;
    cursor: wait;
  }

  .upload input {
    display: none;
  }

  .error {
    margin-top: 1rem;
    color: var(--accent);
    text-align: center;
    font-style: italic;
    font-size: 0.9rem;
  }

  .empty {
    margin-top: 3rem;
    text-align: center;
    color: var(--ink-faint);
    font-style: italic;
    line-height: 2;
  }

  .shelf {
    list-style: none;
    margin-top: 2rem;
    flex: 1;
  }

  .shelf li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.9rem 0;
    border-bottom: 1px dashed var(--rule);
  }

  .shelf li:first-child {
    border-top: 1px dashed var(--rule);
  }

  .entry {
    flex: 1;
    text-align: left;
    padding: 0;
    min-height: 44px;
    color: var(--ink);
    line-height: 1.5;
  }

  .entry:hover .title {
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 4px;
  }

  .title {
    font-weight: 500;
  }

  .author {
    color: var(--ink-soft);
    font-style: italic;
  }

  .meta {
    color: var(--ink-faint);
    font-size: 0.8rem;
    margin-left: 0.5rem;
  }

  .remove {
    color: var(--ink-faint);
    font-size: 1.3rem;
    padding: 0 0.5rem;
    min-height: 44px;
    min-width: 44px;
  }

  .remove:hover {
    color: var(--accent);
  }

  footer {
    margin-top: 3rem;
    text-align: center;
    color: var(--ink-faint);
    font-size: 0.8rem;
    letter-spacing: 0.15em;
  }
</style>
