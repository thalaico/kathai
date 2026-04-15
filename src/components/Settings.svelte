<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { settings, updateSettings } from '$stores/settings';
  import { getKittenEngine } from '$lib/tts';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  let status = $state<
    | { type: 'idle' }
    | { type: 'loading'; message: string }
    | { type: 'ready' }
    | { type: 'error'; error: string }
  >({ type: 'idle' });
  let voices = $state<string[]>([]);
  let unsubStatus: (() => void) | null = null;

  onMount(() => {
    const engine = getKittenEngine();
    unsubStatus = engine.subscribeStatus((s) => {
      status = s;
      if (s.type === 'ready') {
        engine.listVoices().then((v) => (voices = v.map((x) => x.id)));
      }
    });
  });

  onDestroy(() => {
    unsubStatus?.();
  });

  async function enableKitten() {
    const engine = getKittenEngine();
    try {
      await engine.load();
      await updateSettings({ engine: 'kitten' });
    } catch (err) {
      console.error(err);
    }
  }

  async function disableKitten() {
    await updateSettings({ engine: 'web-speech' });
  }

  async function pickVoice(id: string) {
    await updateSettings({ voiceId: id });
  }
</script>

{#if open}
  <div
    class="backdrop"
    role="button"
    tabindex="-1"
    onclick={onclose}
    onkeydown={(e) => e.key === 'Escape' && onclose()}
  >
    <div
      class="panel"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="settings-title"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header>
        <h2 id="settings-title">settings</h2>
        <button class="close" onclick={onclose} aria-label="close">×</button>
      </header>

      <hr class="rule" />

      <section>
        <h3>voice</h3>
        <p class="hint">
          {#if $settings.engine === 'web-speech'}
            using your device's built-in voice. zero download, but quality varies.
          {:else if status.type === 'ready'}
            using kittentts — neural voice, ~23 MB cached on your device.
          {:else}
            kittentts is a small neural tts model (~23 MB). download once, runs fully on your device, works offline after.
          {/if}
        </p>

        {#if status.type === 'error'}
          <p class="error">kittentts error:</p>
          <pre class="error-detail">{status.error}</pre>
          <button class="primary" onclick={enableKitten}>try again</button>
          <button class="secondary" onclick={disableKitten}>
            use device voice instead
          </button>
        {:else if status.type === 'loading'}
          <p class="status">{status.message}</p>
        {:else if status.type === 'ready'}
          {#if voices.length > 0}
            <label class="field">
              <span>voice</span>
              <select
                value={$settings.voiceId ?? voices[0]}
                onchange={(e) => pickVoice((e.target as HTMLSelectElement).value)}
              >
                {#each voices as v}
                  <option value={v}>{v}</option>
                {/each}
              </select>
            </label>
          {:else}
            <p class="status">loading voices…</p>
          {/if}
          <button class="secondary" onclick={disableKitten}>
            use device voice instead
          </button>
        {:else if $settings.engine === 'kitten'}
          <!-- Kitten was selected but engine is idle (fresh session).
               Offer to resume the load, which will hit the IndexedDB cache
               and come back 'ready' almost instantly. -->
          <button class="primary" onclick={enableKitten}>
            enable kittentts (already downloaded)
          </button>
          <button class="secondary" onclick={disableKitten}>
            use device voice instead
          </button>
        {:else}
          <button class="primary" onclick={enableKitten}>
            download kittentts (~23 MB)
          </button>
        {/if}
      </section>

      <hr class="rule" />

      <section class="privacy">
        <h3>privacy</h3>
        <p>
          kathai has no server, no account, no sync, no telemetry. everything —
          your books, your reading progress, your settings, the downloaded
          kittentts model — lives in your browser's indexeddb on this device
          only.
        </p>
        <p class="hint">
          clearing your browser data will reset kathai completely.
        </p>
      </section>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 55%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 50;
    border: none;
  }

  .panel {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 4px;
    max-width: 30rem;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    padding: 1.5rem 1.75rem;
    box-shadow: 0 20px 60px -20px color-mix(in srgb, var(--ink) 45%, transparent);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    font-size: 1.1rem;
    font-variant: small-caps;
    letter-spacing: 0.08em;
    font-weight: 500;
  }

  .close {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: var(--ink-soft);
    cursor: pointer;
    padding: 0 0.5rem;
    min-height: 44px;
    min-width: 44px;
    font-family: inherit;
  }
  .close:hover { color: var(--ink); }

  .rule {
    border: none;
    border-top: 1px solid var(--rule);
    margin: 1rem 0;
  }

  h3 {
    font-size: 0.85rem;
    font-variant: small-caps;
    letter-spacing: 0.1em;
    color: var(--ink-soft);
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  section p {
    font-size: 0.9rem;
    line-height: 1.6;
    margin-bottom: 0.75rem;
  }

  .hint {
    color: var(--ink-soft);
    font-style: italic;
    font-size: 0.85rem;
  }

  .error {
    color: var(--accent);
    font-style: italic;
  }

  .error-detail {
    font-family: var(--mono);
    font-size: 0.75rem;
    background: var(--paper-edge);
    border: 1px solid var(--rule);
    padding: 0.6rem 0.75rem;
    margin: 0.5rem 0 0.75rem;
    border-radius: 2px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 14rem;
    overflow-y: auto;
    color: var(--ink-soft);
  }

  .status {
    font-style: italic;
    color: var(--ink-soft);
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.5rem 0 0.75rem;
  }
  .field span {
    font-style: italic;
    color: var(--ink-soft);
    min-width: 4rem;
  }
  .field select {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--rule);
    color: var(--ink);
    font-family: inherit;
    font-size: 0.95rem;
    padding: 0.4rem 0;
    font-style: italic;
  }

  button.primary,
  button.secondary {
    font-family: inherit;
    border-radius: 2px;
    padding: 0.6rem 1rem;
    cursor: pointer;
    min-height: 44px;
    font-style: italic;
  }

  button.primary {
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
  }
  button.primary:hover {
    background: var(--ink-soft);
    border-color: var(--ink-soft);
  }

  button.secondary {
    background: transparent;
    color: var(--ink-soft);
    border: 1px solid var(--rule);
    margin-top: 0.5rem;
  }
  button.secondary:hover {
    color: var(--ink);
    border-color: var(--ink-soft);
  }

  .privacy p {
    color: var(--ink-soft);
    font-size: 0.82rem;
    line-height: 1.6;
  }
</style>
