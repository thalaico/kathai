<script lang="ts">
  import { onMount } from 'svelte';
  import Library from '$components/Library.svelte';
  import Reader from '$components/Reader.svelte';
  import { currentBook, loadBooksFromDB } from '$stores/books';
  import { loadSettings } from '$stores/settings';
  import { installRouter } from '$lib/router';

  onMount(async () => {
    try {
      await Promise.all([loadBooksFromDB(), loadSettings()]);
    } catch (err) {
      console.error(err);
    }
    // Install the router *after* books are loaded so deep links like
    // /book/gutenberg-1342/3 resolve against real data.
    installRouter();
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
