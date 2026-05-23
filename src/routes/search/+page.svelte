<script lang="ts">
  import { onMount } from 'svelte';
  import { search } from '$lib/search';
  import type { SearchHit } from '$lib/types';
  import EntryCard from '$lib/components/EntryCard.svelte';

  let query = '';
  let hits: SearchHit[] = [];
  let loading = false;
  let error = '';
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let inputEl: HTMLInputElement | null = null;

  onMount(() => {
    inputEl?.focus();
  });

  function onInput() {
    if (debounce) clearTimeout(debounce);
    error = '';
    if (!query.trim()) {
      hits = [];
      loading = false;
      return;
    }
    loading = true;
    debounce = setTimeout(runSearch, 180);
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      hits = [];
      loading = false;
      return;
    }
    try {
      const t0 = performance.now();
      hits = await search(q, 30);
      const ms = (performance.now() - t0).toFixed(0);
      console.debug(`[search] "${q}" → ${hits.length} hits in ${ms}ms`);
    } catch (err) {
      error = (err as Error).message;
      hits = [];
    } finally {
      loading = false;
    }
  }

  function clear() {
    query = '';
    hits = [];
    inputEl?.focus();
  }
</script>

<section class="flex-1 flex flex-col overflow-hidden">
  <!--
    Two layout modes share the same <input> DOM node so focus / IME composition
    survive the transition between them:
      - idle  (!query): wrapper takes the full height and centers the search bar
                        vertically (Google-style landing).
      - active (query): wrapper sticks to the top so results scroll under it.
  -->
  <div
    class="bg-bg z-10 px-4 {query
      ? 'pt-4 pb-2 sticky top-0'
      : 'flex-1 flex flex-col items-center justify-center pb-32'}"
  >
    <h1 class="sr-only">檢索</h1>
    <div class="w-full {query ? '' : 'max-w-md'}">
      <div class="relative">
        <input
          bind:this={inputEl}
          type="search"
          bind:value={query}
          on:input={onInput}
          placeholder="輸入漢字或羅馬字…"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          class="w-full bg-bg-card border border-ink/10 rounded-pill px-5 py-3 pr-12
                 text-base text-ink placeholder:text-ink-muted focus:outline-none
                 focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
        />
        {#if query}
          <button
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center
                   rounded-full text-ink-muted hover:bg-bg-deep transition"
            aria-label="清除"
            on:click={clear}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        {/if}
      </div>
      {#if !query}
        <!--
          Idle hint: four worked examples covering the four input styles the
          search supports. Same target word (柿 / khī / khi7) for the first
          three rows so users see how the encodings map to each other at a
          glance.

          Layout: inline 3-column grid so all four rows align column-by-column:
            col 1 — examples, left-aligned (so each row's first char lines up)
            col 2 — the · separator, single-char column (naturally centered)
            col 3 — labels, centered inside the column's intrinsic width
          The whole grid is `inline-grid` inside a `text-center` wrapper so it
          sits as one block centered under the search bar.
        -->
        <div class="mt-6 text-center text-sm">
          <p class="text-ink-muted mb-3">試試這些搜尋方式</p>
          <div class="inline-grid grid-cols-[auto_auto_auto] gap-x-2 gap-y-1.5 text-ink-muted">
            <span class="font-han text-left">柿</span>
            <span>·</span>
            <span class="text-center">台文漢字</span>

            <span class="loma text-left">khī</span>
            <span>·</span>
            <span class="text-center">台羅</span>

            <span class="loma text-left">khi7</span>
            <span>·</span>
            <span class="text-center">數字標聲調</span>

            <span class="text-left">柿子</span>
            <span>·</span>
            <span class="text-center">華語詞義</span>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if query}
    <div class="flex-1 overflow-y-auto px-4 pb-4 pt-2">
      {#if error}
        <p class="text-red-700 text-sm">錯誤：{error}</p>
      {:else if loading}
        <p class="text-ink-muted text-sm">搜尋中…</p>
      {:else if hits.length === 0}
        <p class="text-ink-muted text-sm mt-4">沒有找到「{query}」</p>
      {:else}
        <ul class="grid gap-3">
          {#each hits as h (h.entry.id)}
            <li>
              <EntryCard id={h.entry.id} hanji={h.entry.hanji} loma={h.entry.loma} preview={h.preview} />
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>
