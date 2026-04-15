<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import Library from '$components/Library.svelte';
  import Reader from '$components/Reader.svelte';
  import { currentBook, loadBooksFromDB } from '$stores/books';
  import { loadSettings, settings } from '$stores/settings';
  import { installRouter } from '$lib/router';
  import { getKittenEngine } from '$lib/tts';

  onMount(async () => {
    try {
      await Promise.all([loadBooksFromDB(), loadSettings()]);
    } catch (err) {
      console.error(err);
    }
    // Install the router *after* books are loaded so deep links like
    // /book/gutenberg-1342/3 resolve against real data.
    installRouter();

    // If the user previously enabled KittenTTS, quietly re-load it in
    // the background. The model bytes are already in IndexedDB so this
    // usually completes in well under a second without any network.
    if (get(settings).engine === 'kitten') {
      getKittenEngine()
        .load()
        .catch((err) => console.warn('[kathai] KittenTTS auto-load failed:', err));
    }
  });
</script>

<main>
  {#if $currentBook}
    <Reader />
  {:else}
    <Library />
  {/if}
</main>

<style>
  main {
    min-height: 100vh;
  }
</style>
