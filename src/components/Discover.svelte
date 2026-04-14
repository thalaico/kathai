<script lang="ts">
  import {
    searchGutenberg,
    downloadGutenbergEPUB,
    LANGUAGES,
    type GutenbergBook,
  } from '$lib/gutenberg';
  import { loadEPUBFromBuffer } from '$lib/epub-loader';
  import { addBook, type Book } from '$stores/books';

  let query = $state('');
  let language = $state('en');
  let results = $state<GutenbergBook[]>([]);
  let loading = $state(false);
  let error = $state('');
  let importingId = $state<number | null>(null);
  let page = $state(1);
  let hasMore = $state(false);
  let loadedForQuery = $state<string | null>(null);
  let loadedForLang = $state<string>('en');

  let searchCtrl: AbortController | null = null;

  async function doSearch(q: string, lang: string, nextPage: number) {
    searchCtrl?.abort();
    searchCtrl = new AbortController();
    loading = true;
    error = '';
    try {
      const res = await searchGutenberg(q, {
        page: nextPage,
        language: lang,
        signal: searchCtrl.signal,
      });
      results = nextPage === 1 ? res.books : [...results, ...res.books];
      hasMore = res.hasMore;
      page = nextPage;
      loadedForQuery = q;
      loadedForLang = lang;
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') {
        console.error(err);
        error = 'Could not reach Project Gutenberg.';
      }
    } finally {
      loading = false;
    }
  }

  // Debounced search, re-runs whenever `query` or `language` changes.
  // Fires immediately on mount / language change; debounces typing.
  $effect(() => {
    const q = query;
    const lang = language;
    const delay = q === '' || lang !== loadedForLang ? 0 : 300;
    const t = setTimeout(() => doSearch(q, lang, 1), delay);
    return () => clearTimeout(t);
  });

  function loadMore() {
    doSearch(loadedForQuery ?? '', loadedForLang, page + 1);
  }

  async function importBook(gb: GutenbergBook) {
    if (importingId !== null) return;
    importingId = gb.id;
    error = '';
    try {
      const buffer = await downloadGutenbergEPUB(gb);
      const loaded = await loadEPUBFromBuffer(buffer);
      const book: Book = {
        id: `gutenberg-${gb.id}`,
        filename: `pg${gb.id}.epub`,
        title: loaded.metadata.title || gb.title,
        author: loaded.metadata.author || gb.authors.join(', ') || undefined,
        chapters: loaded.chapters,
        uploadedAt: Date.now(),
      };
      await addBook(book);
    } catch (err) {
      console.error(err);
      error = `Could not download "${gb.title}".`;
    } finally {
      importingId = null;
    }
  }

</script>

<section class="discover">
  <hr class="rule" />
  <p class="heading">from the library of project gutenberg</p>

  <div class="search">
    <input
      type="text"
      placeholder="search titles or authors…"
      bind:value={query}
    />
    <select bind:value={language} aria-label="language">
      {#each LANGUAGES as lang}
        <option value={lang.code}>{lang.label}</option>
      {/each}
    </select>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if results.length === 0 && !loading}
    <p class="empty">nothing to show.</p>
  {:else}
    <ul class="results">
      {#each results as book (book.id)}
        <li>
          <div class="info">
            <span class="title">{book.title}</span>
            {#if book.authors.length > 0}
              <span class="author"> — {book.authors.join(', ')}</span>
            {/if}
            <span class="meta">{book.languages.join(', ')} · {book.downloadCount.toLocaleString()} dl</span>
          </div>
          <button
            class="import"
            onclick={() => importBook(book)}
            disabled={importingId !== null}
          >
            {importingId === book.id ? 'opening…' : 'add'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if loading}
    <p class="loading">loading…</p>
  {:else if hasMore}
    <button class="more" onclick={loadMore}>more</button>
  {/if}
</section>

<style>
  .discover {
    margin-top: 2.5rem;
  }

  .rule {
    border: none;
    border-top: 1px solid var(--rule);
    margin: 0 0 1.25rem;
  }

  .heading {
    text-align: center;
    font-variant: small-caps;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
    font-style: italic;
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .search {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
  }

  .search input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--rule);
    padding: 0.6rem 0.2rem;
    font-size: 1rem;
    color: var(--ink);
    font-style: italic;
    outline: none;
    font-family: inherit;
  }

  .search input:focus {
    border-bottom-color: var(--ink-soft);
  }

  .search input::placeholder {
    color: var(--ink-faint);
    font-style: italic;
  }

  .search select {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--rule);
    padding: 0.6rem 0.25rem;
    color: var(--ink-soft);
    font-style: italic;
    font-family: inherit;
    font-size: 0.9rem;
    outline: none;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    padding-right: 1.1rem;
    background-image: linear-gradient(45deg, transparent 50%, var(--ink-faint) 50%),
      linear-gradient(135deg, var(--ink-faint) 50%, transparent 50%);
    background-position:
      calc(100% - 8px) 60%,
      calc(100% - 3px) 60%;
    background-size: 5px 5px;
    background-repeat: no-repeat;
  }

  .search select:focus {
    border-bottom-color: var(--ink-soft);
    color: var(--ink);
  }

  .search select option {
    background: var(--paper);
    color: var(--ink);
  }

  .error {
    margin-top: 0.75rem;
    color: var(--accent);
    text-align: center;
    font-style: italic;
    font-size: 0.9rem;
  }

  .loading {
    text-align: center;
    color: var(--ink-faint);
    font-style: italic;
    padding: 1rem 0;
    font-size: 0.9rem;
  }

  .empty {
    color: var(--ink-faint);
    font-style: italic;
    text-align: center;
    padding: 1rem 0;
  }

  .results {
    list-style: none;
    margin-top: 1rem;
  }

  .results li {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-bottom: 1px dashed var(--rule);
  }

  .results li:first-child {
    border-top: 1px dashed var(--rule);
  }

  .info {
    flex: 1;
    line-height: 1.5;
    min-width: 0;
  }

  .title {
    font-weight: 500;
  }

  .author {
    color: var(--ink-soft);
    font-style: italic;
  }

  .meta {
    display: block;
    font-size: 0.72rem;
    color: var(--ink-faint);
    font-variant: small-caps;
    letter-spacing: 0.08em;
    margin-top: 0.15rem;
  }

  .import {
    color: var(--ink-soft);
    font-style: italic;
    font-size: 0.9rem;
    padding: 0.4rem 0.6rem;
    min-height: 44px;
    min-width: 44px;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    font-family: inherit;
  }

  .import:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--ink-soft);
  }

  .import:disabled {
    opacity: 0.4;
    cursor: wait;
  }

  .more {
    display: block;
    margin: 1.25rem auto 0;
    color: var(--ink-soft);
    font-style: italic;
    padding: 0.5rem 1rem;
    min-height: 44px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.95rem;
  }

  .more:hover {
    color: var(--ink);
  }
</style>
