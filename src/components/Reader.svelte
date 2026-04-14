<script lang="ts">
  import { currentBook, currentChapterIndex, saveProgress } from '$stores/books';
  import { extractPlainText, type Chapter } from '$lib/epub-loader';
  import { chunkBySentences } from '$lib/text-chunker';
  import { playerState, startPlaying, stopPlaying } from '$stores/player';
  import { navigateToChapter, navigateToShelf } from '$lib/router';
  import Player from './Player.svelte';

  const MIN_CHAPTER_LENGTH = 50;

  function chapterText(ch: Chapter): string {
    // Books loaded before plainText was pre-extracted may not have it stored.
    return ch.plainText ?? extractPlainText(ch.htmlContent);
  }

  /**
   * Produce the effective chapter list — the one the user navigates through.
   * Books already saved in IndexedDB from earlier builds have empty-ish
   * sections (cover, title page) in their `chapters` array; we drop those
   * here at display time so Next/Prev skip over them.
   */
  let effectiveChapters = $derived.by<Chapter[]>(() => {
    const book = $currentBook;
    if (!book) return [];
    const withText = book.chapters.map((ch) => ({
      ...ch,
      plainText: chapterText(ch),
    }));
    const filtered = withText.filter((ch) => ch.plainText.length >= MIN_CHAPTER_LENGTH);
    return filtered.length > 0 ? filtered : withText;
  });

  let plainText = $state('');
  let sentences = $state<string[]>([]);
  let autoAdvance = $state(false);
  let sentenceEls = $state<(HTMLSpanElement | null)[]>([]);

  function playCurrentChapter() {
    const chapters = effectiveChapters;
    const idx = $currentChapterIndex;
    const chapter = chapters[idx];
    if (!chapter) return;
    autoAdvance = true;
    startPlaying(chapter.plainText, () => {
      // Fires when the chapter finishes naturally. If another chapter
      // exists and auto-advance is still armed, roll forward and keep going.
      if (!autoAdvance) return;
      const next = $currentChapterIndex + 1;
      if (next < effectiveChapters.length) {
        navigateToChapter(next);
        queueMicrotask(() => playCurrentChapter());
      } else {
        autoAdvance = false;
      }
    });
  }

  // Clamp the saved index if the effective chapter list is shorter than
  // whatever index got persisted from an earlier build.
  $effect(() => {
    const len = effectiveChapters.length;
    if (len > 0 && $currentChapterIndex >= len) {
      navigateToChapter(0);
    }
  });

  $effect(() => {
    const chapters = effectiveChapters;
    const idx = $currentChapterIndex;
    const book = $currentBook;
    if (chapters.length > 0 && idx >= 0 && chapters[idx]) {
      plainText = chapters[idx].plainText;
      sentences = chunkBySentences(plainText, 40);
      sentenceEls = new Array(sentences.length).fill(null);
      if (book) saveProgress(book.id, idx).catch(console.error);
    } else {
      plainText = '';
      sentences = [];
      sentenceEls = [];
    }
  });

  // Scroll the active sentence into view while narrating.
  $effect(() => {
    if ($playerState.status === 'idle') return;
    const el = sentenceEls[$playerState.currentChunk];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  function nextChapter() {
    if ($currentChapterIndex < effectiveChapters.length - 1) {
      autoAdvance = false;
      stopPlaying();
      navigateToChapter($currentChapterIndex + 1);
    }
  }

  function prevChapter() {
    if ($currentChapterIndex > 0) {
      autoAdvance = false;
      stopPlaying();
      navigateToChapter($currentChapterIndex - 1);
    }
  }

  function back() {
    autoAdvance = false;
    stopPlaying();
    navigateToShelf();
  }

  function listen() {
    if ($playerState.chunks.length > 0) {
      autoAdvance = false;
      stopPlaying();
    } else {
      playCurrentChapter();
    }
  }
</script>

{#if $currentBook}
  {@const book = $currentBook}
  {@const idx = $currentChapterIndex}
  {@const chapter = effectiveChapters[idx]}
  <div class="page">
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
      {chapter?.label || `Chapter ${idx + 1}`}
    </p>

    <article>
      {#each sentences as sentence, i}
        <span
          class="sentence"
          class:active={$playerState.status !== 'idle' && $playerState.currentChunk === i}
          bind:this={sentenceEls[i]}
        >
          {sentence}
        </span>
        {' '}
      {/each}
    </article>

    <Player />

    <hr class="rule" />

    <footer>
      <button onclick={prevChapter} disabled={idx === 0}>← prev</button>
      <span class="folio">{idx + 1} / {effectiveChapters.length}</span>
      <button onclick={nextChapter} disabled={idx >= effectiveChapters.length - 1}>
        next →
      </button>
    </footer>
  </div>
{:else}
  <p class="empty">choose a book from the shelf</p>
{/if}

<style>
  .page {
    max-width: 34rem;
    margin: 0 auto;
    padding: 2.5rem 1.75rem 3rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
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
  }

  .back:hover {
    color: var(--ink-soft);
  }

  .listen {
    position: absolute;
    right: 0;
    top: 0;
    padding: 0.25rem 0.5rem;
    color: var(--ink-faint);
    font-size: 1.1rem;
    min-height: 44px;
    min-width: 44px;
  }

  .listen:hover {
    color: var(--ink);
  }

  .title-block {
    padding: 0.25rem 3rem;
  }

  h1 {
    font-size: 1.35rem;
    font-weight: 500;
    font-variant: small-caps;
    letter-spacing: 0.04em;
  }

  .author {
    margin-top: 0.15rem;
    font-style: italic;
    color: var(--ink-soft);
    font-size: 0.85rem;
  }

  .rule {
    border: none;
    border-top: 1px solid var(--rule);
    margin: 1.5rem 0;
  }

  .chapter-label {
    text-align: center;
    font-style: italic;
    color: var(--ink-soft);
    font-size: 0.95rem;
    margin-bottom: 1.5rem;
    font-variant: small-caps;
    letter-spacing: 0.08em;
  }

  article {
    flex: 1;
    font-size: 1.05rem;
    line-height: 1.8;
    text-align: justify;
    hyphens: auto;
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

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: env(safe-area-inset-bottom);
  }

  footer button {
    color: var(--ink-soft);
    font-style: italic;
    padding: 0.5rem 0;
    min-height: 44px;
  }

  footer button:hover:not(:disabled) {
    color: var(--ink);
  }

  footer button:disabled {
    color: var(--ink-faint);
    opacity: 0.4;
    cursor: not-allowed;
  }

  .folio {
    color: var(--ink-faint);
    font-size: 0.85rem;
    font-variant: small-caps;
    letter-spacing: 0.1em;
  }

  .empty {
    text-align: center;
    margin-top: 4rem;
    color: var(--ink-faint);
    font-style: italic;
  }
</style>
