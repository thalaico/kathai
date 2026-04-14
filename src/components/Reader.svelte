<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { currentBook, currentChapterIndex, saveProgress } from '$stores/books';
  import {
    extractPlainText,
    pickSplitTag,
    splitAtHeadings,
    MIN_CHAPTER_LENGTH,
    SPLIT_LENGTH_THRESHOLD,
    type Chapter,
  } from '$lib/epub-loader';
  import { chunkBySentences } from '$lib/text-chunker';
  import { playerState, startPlaying, stopPlaying } from '$stores/player';
  import { navigateToChapter, navigateToShelf } from '$lib/router';
  import Player from './Player.svelte';

  // ─────────────────────────────────────────────────────────────
  // Effective chapter list (with runtime re-split for old caches)
  // ─────────────────────────────────────────────────────────────

  let effectiveChapters = $derived.by<Chapter[]>(() => {
    const book = $currentBook;
    if (!book) return [];
    const out: Chapter[] = [];
    for (const ch of book.chapters) {
      const storedText = ch.plainText ?? extractPlainText(ch.htmlContent);
      if (storedText.length >= SPLIT_LENGTH_THRESHOLD && ch.htmlContent) {
        try {
          const parsed = new DOMParser().parseFromString(ch.htmlContent, 'text/html');
          const body = parsed.body;
          if (body) {
            const tag = pickSplitTag(body);
            if (tag) {
              const parts = splitAtHeadings(body, tag);
              if (parts.length >= 2) {
                parts.forEach((part, i) => {
                  if (part.text.length >= MIN_CHAPTER_LENGTH) {
                    out.push({
                      id: `${ch.id}--${i}`,
                      label: part.label || `${ch.label} ${i + 1}`,
                      htmlContent: '',
                      plainText: part.text,
                    });
                  }
                });
                continue;
              }
            }
          }
        } catch (err) {
          console.warn('Failed to re-split stored chapter', ch.id, err);
        }
      }
      if (storedText.length >= MIN_CHAPTER_LENGTH) {
        out.push({ ...ch, plainText: storedText });
      }
    }
    return out.length > 0 ? out : book.chapters;
  });

  let currentChapter = $derived(effectiveChapters[$currentChapterIndex] ?? null);
  let sentences = $derived(
    currentChapter ? chunkBySentences(currentChapter.plainText, 40) : [],
  );

  // ─────────────────────────────────────────────────────────────
  // Pagination via CSS multicol + JS-measured transform
  // ─────────────────────────────────────────────────────────────

  let pagesContainer = $state<HTMLDivElement | null>(null);
  let articleEl = $state<HTMLElement | null>(null);
  let containerWidth = $state(0);
  let totalPages = $state(1);
  let currentPage = $state(0);
  /** Set to 'last' when a chapter change should land on the final page. */
  let pendingPageTarget: 'first' | 'last' = 'first';

  async function measure() {
    if (!pagesContainer || !articleEl) return;
    await tick();
    const cw = pagesContainer.clientWidth;
    if (cw === 0) return;
    containerWidth = cw;
    const sw = articleEl.scrollWidth;
    totalPages = Math.max(1, Math.round(sw / cw));
    if (pendingPageTarget === 'last') {
      currentPage = totalPages - 1;
      pendingPageTarget = 'first';
    } else if (currentPage >= totalPages) {
      currentPage = 0;
    }
  }

  // Remeasure whenever the sentences (and therefore the laid-out text) change.
  $effect(() => {
    // Read the reactive deps so the effect fires on chapter changes.
    void sentences;
    void containerWidth;
    measure();
  });

  onMount(() => {
    const ro = new ResizeObserver(() => measure());
    if (pagesContainer) ro.observe(pagesContainer);
    return () => ro.disconnect();
  });

  // Save reading progress as the chapter changes.
  $effect(() => {
    const book = $currentBook;
    const idx = $currentChapterIndex;
    if (book && idx >= 0) {
      saveProgress(book.id, idx).catch(console.error);
    }
  });

  // Clamp if persisted index overruns the (possibly re-split) chapter list.
  $effect(() => {
    const len = effectiveChapters.length;
    if (len > 0 && $currentChapterIndex >= len) navigateToChapter(0);
  });

  // ─────────────────────────────────────────────────────────────
  // Navigation: page-first, with auto chapter advance at the edges
  // ─────────────────────────────────────────────────────────────

  function nextPage() {
    if (currentPage < totalPages - 1) {
      currentPage++;
      return;
    }
    if ($currentChapterIndex < effectiveChapters.length - 1) {
      autoAdvance = false;
      stopPlaying();
      pendingPageTarget = 'first';
      navigateToChapter($currentChapterIndex + 1);
    }
  }

  function prevPage() {
    if (currentPage > 0) {
      currentPage--;
      return;
    }
    if ($currentChapterIndex > 0) {
      autoAdvance = false;
      stopPlaying();
      pendingPageTarget = 'last';
      navigateToChapter($currentChapterIndex - 1);
    }
  }

  function back() {
    autoAdvance = false;
    stopPlaying();
    navigateToShelf();
  }

  // ─────────────────────────────────────────────────────────────
  // TTS wiring
  // ─────────────────────────────────────────────────────────────

  let autoAdvance = $state(false);

  function playCurrentChapter() {
    const ch = currentChapter;
    if (!ch) return;
    autoAdvance = true;
    startPlaying(ch.plainText, () => {
      if (!autoAdvance) return;
      const next = $currentChapterIndex + 1;
      if (next < effectiveChapters.length) {
        pendingPageTarget = 'first';
        navigateToChapter(next);
        queueMicrotask(() => playCurrentChapter());
      } else {
        autoAdvance = false;
      }
    });
  }

  function listen() {
    if ($playerState.chunks.length > 0) {
      autoAdvance = false;
      stopPlaying();
    } else {
      playCurrentChapter();
    }
  }

  // Keyboard navigation: ←/→ flip pages.
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      nextPage();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevPage();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $currentBook}
  {@const book = $currentBook}
  {@const idx = $currentChapterIndex}
  <div class="reader">
    <header>
      <button class="back" onclick={back}>← shelf</button>
      <div class="title-block">
        <h1>{book.title}</h1>
        {#if book.author}
          <p class="author">{book.author}</p>
        {/if}
      </div>
      <button class="listen" onclick={listen}>
        {$playerState.chunks.length > 0 ? '■' : '♪'}
      </button>
    </header>

    <hr class="rule" />

    <p class="chapter-label">
      {currentChapter?.label || `Chapter ${idx + 1}`}
    </p>

    <div class="pages" bind:this={pagesContainer}>
      <article
        bind:this={articleEl}
        style:transform={`translateX(-${currentPage * 100}%)`}
      >
        {#each sentences as sentence, i (i)}
          <span
            class="sentence"
            class:active={$playerState.status !== 'idle' && $playerState.currentChunk === i}
          >{sentence}</span>{' '}
        {/each}
      </article>
      <!-- tap zones — left half prev, right half next -->
      <button class="zone left" onclick={prevPage} aria-label="previous page"></button>
      <button class="zone right" onclick={nextPage} aria-label="next page"></button>
    </div>

    <Player />

    <hr class="rule" />

    <footer>
      <button class="ctrl" onclick={prevPage} disabled={currentPage === 0 && idx === 0}>
        ← prev
      </button>
      <span class="folio">
        {currentPage + 1} / {totalPages}
        <span class="sep">·</span>
        ch. {idx + 1}/{effectiveChapters.length}
      </span>
      <button
        class="ctrl"
        onclick={nextPage}
        disabled={currentPage === totalPages - 1 && idx === effectiveChapters.length - 1}
      >
        next →
      </button>
    </footer>
  </div>
{:else}
  <p class="empty">choose a book from the shelf</p>
{/if}

<style>
  .reader {
    max-width: 34rem;
    margin: 0 auto;
    padding: 2rem 1.75rem 1.5rem;
    height: 100vh;
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  header {
    position: relative;
    text-align: center;
  }

  .back {
    position: absolute;
    left: 0;
    top: 0;
    padding: 0.25rem 0;
    color: var(--ink-faint);
    font-style: italic;
    font-size: 0.9rem;
    min-height: 44px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: inherit;
  }
  .back:hover { color: var(--ink-soft); }

  .listen {
    position: absolute;
    right: 0;
    top: 0;
    padding: 0.25rem 0.5rem;
    color: var(--ink-faint);
    font-size: 1.1rem;
    min-height: 44px;
    min-width: 44px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: inherit;
  }
  .listen:hover { color: var(--ink); }

  .title-block { padding: 0.25rem 3rem; }

  h1 {
    font-size: 1.2rem;
    font-weight: 500;
    font-variant: small-caps;
    letter-spacing: 0.04em;
  }

  .author {
    margin-top: 0.15rem;
    font-style: italic;
    color: var(--ink-soft);
    font-size: 0.8rem;
  }

  .rule {
    border: none;
    border-top: 1px solid var(--rule);
    margin: 1rem 0;
  }

  .chapter-label {
    text-align: center;
    font-style: italic;
    color: var(--ink-soft);
    font-size: 0.9rem;
    margin-bottom: 1rem;
    font-variant: small-caps;
    letter-spacing: 0.08em;
  }

  /* The pagination surface. Fixed-height, multicol article inside, columns
     slide via translateX. min-height:0 is critical so the flex child can
     actually shrink to give the multicol element a concrete height. */
  .pages {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .pages article {
    height: 100%;
    column-width: 100%;
    column-gap: 0;
    column-fill: auto;
    font-size: 1.05rem;
    line-height: 1.75;
    text-align: justify;
    hyphens: auto;
    transition: transform 0.28s cubic-bezier(0.3, 0.7, 0.4, 1);
    will-change: transform;
  }

  .sentence {
    transition: background-color 0.25s ease;
    border-radius: 2px;
    padding: 0 1px;
  }

  .sentence.active {
    background-color: var(--paper-edge);
    box-shadow: 0 0 0 3px var(--paper-edge);
  }

  /* Invisible tap zones over the page for touch navigation. */
  .zone {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 30%;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .zone.left { left: 0; }
  .zone.right { right: 0; }
  .zone:focus-visible {
    outline: 1px dashed var(--ink-faint);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 0.25rem;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .ctrl {
    color: var(--ink-soft);
    font-style: italic;
    padding: 0.5rem 0;
    min-height: 44px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.95rem;
  }
  .ctrl:hover:not(:disabled) { color: var(--ink); }
  .ctrl:disabled {
    color: var(--ink-faint);
    opacity: 0.35;
    cursor: not-allowed;
  }

  .folio {
    color: var(--ink-faint);
    font-size: 0.78rem;
    font-variant: small-caps;
    letter-spacing: 0.1em;
  }
  .folio .sep { margin: 0 0.35rem; }

  .empty {
    text-align: center;
    margin-top: 4rem;
    color: var(--ink-faint);
    font-style: italic;
  }
</style>
