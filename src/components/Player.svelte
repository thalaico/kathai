<script lang="ts">
  import {
    playerState,
    pausePlaying,
    resumePlaying,
    stopPlaying,
    nextChunk,
    prevChunk,
    setRate,
  } from '$stores/player';

  const rates = [0.75, 1.0, 1.25, 1.5];

  function cycleRate() {
    const current = $playerState.rate;
    const idx = rates.indexOf(current);
    setRate(rates[(idx + 1) % rates.length]);
  }
</script>

{#if $playerState.chunks.length > 0}
  <div class="player">
    <hr class="rule" />
    <div class="row">
      <button onclick={prevChunk} aria-label="previous sentence">‹‹</button>

      {#if $playerState.status === 'playing'}
        <button class="primary" onclick={pausePlaying} aria-label="pause">
          ❚❚&nbsp;&nbsp;pause
        </button>
      {:else}
        <button class="primary" onclick={resumePlaying} aria-label="play">
          ▶&nbsp;&nbsp;listen
        </button>
      {/if}

      <button onclick={nextChunk} aria-label="next sentence">››</button>
    </div>

    <div class="meta">
      <span>{$playerState.currentChunk + 1} / {$playerState.chunks.length}</span>
      <button class="rate" onclick={cycleRate}>{$playerState.rate.toFixed(2)}×</button>
      <button class="stop" onclick={stopPlaying}>stop</button>
    </div>
  </div>
{/if}

<style>
  .player {
    padding-top: 0.75rem;
  }

  .rule {
    border: none;
    border-top: 1px solid var(--rule);
    margin: 0 0 0.75rem;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
  }

  .row button {
    color: var(--ink-soft);
    font-style: italic;
    padding: 0.5rem 0.25rem;
    min-height: 44px;
    min-width: 44px;
    font-size: 1rem;
  }

  .row button:hover {
    color: var(--ink);
  }

  .primary {
    font-variant: small-caps;
    letter-spacing: 0.1em;
    color: var(--ink) !important;
    font-style: normal !important;
    padding: 0.5rem 1rem !important;
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: var(--ink-faint);
    font-variant: small-caps;
    letter-spacing: 0.1em;
  }

  .meta button {
    color: var(--ink-faint);
    font-size: 0.8rem;
    font-variant: small-caps;
    letter-spacing: 0.1em;
    min-height: 44px;
    padding: 0 0.5rem;
  }

  .meta button:hover {
    color: var(--ink);
  }

  .rate {
    font-family: var(--mono);
    font-variant: normal;
    letter-spacing: 0;
  }
</style>
