<script lang="ts">
  import { onMount } from 'svelte';
  import Library from '$components/Library.svelte';
  import Reader from '$components/Reader.svelte';
  import { currentBook, loadBooksFromDB } from '$stores/books';

  onMount(() => {
    loadBooksFromDB().catch(console.error);
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
