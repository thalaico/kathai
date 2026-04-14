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
  // Chapter resolution (with runtime re-split for old cached books)
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
  // Pagination: vertical translate, line-height-aligned.
  //
  // The text flows normally in a single column inside a fixed-height
  // container with overflow:hidden. A "page" is an integer number of
  // line-heights that fits in the container height — we translate the
  // article by -currentPage * pageHeight to show the next page. Line
  // alignment means text is never cut mid-row.
  // ─────────────────────────────────────────────────────────────

  let pagesContainer = $state<HTMLDivElement | null>(null);
  let articleEl = $state<HTMLElement | null>(null);
  let sentenceEls = $state<(HTMLSpanElement | null)[]>([]);
  let pageHeight = $state(0);
  let totalPages = $state(1);
  let currentPage = $state(0);
  /** Used so chapter changes driven by "prev from page 0" land on the last page. */
  let pendingPageTarget: 'first' | 'last' = 'first';

  async function measure() {
    if (!pagesContainer || !articleEl) return;
    await tick();
    // One more RAF so browser layout catches up with the Svelte update.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const ch = pagesContainer.clientHeight;
    if (ch === 0) return;

    const computed = getComputedStyle(articleEl);
    const rawLineHeight = parseFloat(computed.lineHeight);
    const lineHeight = Number.isFinite(rawLineHeight) && rawLineHeight > 0
      ? rawLineHeight
      : parseFloat(computed.fontSize) * 1.75;

    // Largest integer number of lines that fits in the container height.
    const lines = Math.max(1, Math.floor(ch / lineHeight));
    const newPageHeight = lines * lineHeight;
    pageHeight = newPageHeight;

    const contentHeight = articleEl.scrollHeight;
    totalPages = Math.max(1, Math.ceil(contentHeight / newPageHeight));

    if (pendingPageTarget === 'last') {
      currentPage = totalPages - 1;
      pendingPageTarget = 'first';
    } else if (currentPage >= totalPages) {
      currentPage = 0;
    }
  }

  // Re-measure whenever the rendered text changes.
  $effect(() => {
    void sentences;
    measure();
  });

  onMount(() => {
    const ro = new ResizeObserver(() => measure());
    if (pagesContainer) ro.observe(pagesContainer);
    return () => ro.disconnect();
  });

  // Save reading progress as chapters change.
  $effect(() => {
    const book = $currentBook;
    const idx = $currentChapterIndex;
    if (book && idx >= 0) saveProgress(book.id, idx).catch(console.error);
  });

  // Clamp if persisted index overruns the (possibly re-split) chapter list.
  $effect(() => {
    const len = effectiveChapters.length;
    if (len > 0 && $currentChapterIndex >= len) navigateToChapter(0);
  });

  // ─────────────────────────────────────────────────────────────
  // Navigation: pages first, auto-advance chapters at the edges.
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
  // TTS wiring — narration auto-flips pages to follow the reader.
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

  // Follow the narration: whenever the current chunk changes, jump to
  // the page containing its sentence span so the highlight is visible.
  $effect(() => {
    const status = $playerState.status;
    const chunkIdx = $playerState.currentChunk;
    if (status === 'idle') return;
    if (pageHeight === 0) return;
    const el = sentenceEls[chunkIdx];
    if (!el) return;
    const target = Math.max(0, Math.min(totalPages - 1, Math.floor(el.offsetTop / pageHeight)));
    if (target !== currentPage) currentPage = target;
  });

  // Keyboard navigation: ← / → / space flip pages.
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
        style:transform={`translateY(-${currentPage * pageHeight}px)`}
      >
        {#each sentences as sentence, i (i)}
          <span
            class="sentence"
            class:active={$playerState.status !== 'idle' && $playerState.currentChunk === i}
            bind:this={sentenceEls[i]}
          >{sentence}</span>{' '}
        {/each}
      </article>
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

  /* Fixed-height window into continuously-flowing text. Article grows
     with its content; translateY slides it up by one page at a time. */
  .pages {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .pages article {
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

  /* Tap zones over the page. Left 30% = prev, right 30% = next. */
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
