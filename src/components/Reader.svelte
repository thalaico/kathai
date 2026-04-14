<script lang="ts">
  import { currentBook, currentChapterIndex, saveProgress } from '$stores/books';
  import { extractPlainText } from '$lib/epub-loader';
  import { chunkBySentences } from '$lib/text-chunker';
  import { playerState, startPlaying, stopPlaying } from '$stores/player';
  import Player from './Player.svelte';

  let plainText = $state('');
  let sentences = $state<string[]>([]);

  $effect(() => {
    const book = $currentBook;
    const idx = $currentChapterIndex;
    if (book && idx >= 0 && book.chapters[idx]) {
      plainText = extractPlainText(book.chapters[idx].htmlContent);
      sentences = chunkBySentences(plainText, 40);
      saveProgress(book.id, idx).catch(console.error);
    } else {
      plainText = '';
      sentences = [];
    }
    // Stop narration when chapter changes.
    stopPlaying();
  });

  function nextChapter() {
    const book = $currentBook;
    if (book && $currentChapterIndex < book.chapters.length - 1) {
      currentChapterIndex.set($currentChapterIndex + 1);
    }
  }

  function prevChapter() {
    if ($currentChapterIndex > 0) {
      currentChapterIndex.set($currentChapterIndex - 1);
    }
  }

  function back() {
    stopPlaying();
    currentBook.set(null);
  }

  function listen() {
    if ($playerState.chunks.length > 0) {
      stopPlaying();
    } else {
      startPlaying(plainText);
    }
  }
</script>

{#if $currentBook}
  {@const book = $currentBook}
  {@const idx = $currentChapterIndex}
  {@const chapter = book.chapters[idx]}
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
      <span class="folio">{idx + 1} / {book.chapters.length}</span>
      <button onclick={nextChapter} disabled={idx >= book.chapters.length - 1}>
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
