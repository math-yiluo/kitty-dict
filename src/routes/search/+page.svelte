<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { search } from '$lib/search';
  import type { SearchHit } from '$lib/types';
  import type { Snapshot } from './$types';
  import EntryCard from '$lib/components/EntryCard.svelte';

  let query = '';
  let hits: SearchHit[] = [];
  let loading = false;
  let error = '';
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let inputEl: HTMLInputElement | null = null;
  // The scrollable results container. Bound below so the snapshot can save
  // and restore the user's scroll position.
  let resultsEl: HTMLDivElement | undefined;
  // Scroll position to apply once the results container is in the DOM.
  // Populated by snapshot.restore on back-navigation.
  let pendingScrollTop: number | null = null;
  // The query string that produced the currently-displayed `hits`. Used by
  // snapshot.restore to detect "hits are stale relative to query" — happens
  // when the user typed/edited fast enough to leave the page before the
  // debounced runSearch had a chance to fire (or while it was still in
  // flight). Without this, the restored page either shows "沒有找到" for a
  // query that was never actually searched, or stale hits from the previous
  // query the user had typed.
  let lastSearchedQuery = '';
  // Flipped by snapshot.restore to signal "we just came back from /entry —
  // the keyboard should stay down". Watched by the reactive block below
  // so the dismiss runs regardless of whether snapshot.restore fires
  // before or after onMount (SvelteKit doesn't guarantee the order).
  let snapshotJustRestored = false;

  // SvelteKit snapshot: preserve query + hits + scroll position across
  // navigation (e.g. user types → results → taps a card → /entry/[id] →
  // back). Without this, the page re-mounts with cleared state and the
  // user lands back on the empty search bar instead of where they were.
  //
  // Hits are restored directly rather than re-running search() — results
  // are deterministic for a given query, so re-fetching is wasted work
  // and would briefly flash a 'searching…' state on back-nav. EXCEPTION:
  // if the saved hits don't match the saved query (user left mid-edit),
  // we DO re-run so the user doesn't see misleading content.
  export const snapshot: Snapshot<{
    query: string;
    hits: SearchHit[];
    lastSearchedQuery: string;
    scrollTop: number;
  }> = {
    capture: () => ({
      query,
      hits,
      lastSearchedQuery,
      scrollTop: resultsEl?.scrollTop ?? 0
    }),
    restore: (snap) => {
      query = snap.query;
      hits = snap.hits;
      // Snapshots from a pre-update build won't have this field — treat
      // as '' (forces re-search if query is non-empty, which is the safe
      // outcome and matches the post-update intent).
      lastSearchedQuery = snap.lastSearchedQuery ?? '';
      // Signal to the reactive dismiss-keyboard block. We DON'T dismiss
      // here directly because snapshot.restore might run before inputEl
      // is bound (bind:this is set during/after mount).
      snapshotJustRestored = true;

      // Re-run search when the saved hits don't represent the saved query.
      // Two cases this covers:
      //   - User typed but navigated before the 180ms debounce fired
      //     (hits empty, query non-empty, lastSearchedQuery stale)
      //   - User edited the query mid-debounce; saved hits are from a
      //     previous query
      // Use setTimeout 0 (not direct call) so this happens AFTER snapshot
      // restoration finishes and the component is fully wired up.
      const trimmed = query.trim();
      if (trimmed && trimmed !== lastSearchedQuery) {
        // Don't restore the saved scroll here: it belongs to the OLD result
        // set, and the re-search will replace `hits` with different content.
        // Restoring it would scroll against the stale list (the scroll block
        // guards on hits.length>0 and would fire immediately), then never
        // re-apply after the new hits land. Leave pendingScrollTop null so
        // the fresh results start at the top.
        pendingScrollTop = null;
        loading = true;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(runSearch, 0);
      } else {
        // Hits match the query — restore the exact scroll position.
        pendingScrollTop = snap.scrollTop;
      }
    }
  };

  onMount(() => {
    // Only focus if snapshot.restore hasn't already flagged this as a
    // back-navigation. If restore fires AFTER onMount (SvelteKit timing
    // not guaranteed), the reactive block below catches it.
    if (!snapshotJustRestored && !query) {
      inputEl?.focus();
    }
  });

  // Reactive: dismiss the keyboard whenever snapshot.restore flips the
  // flag, regardless of whether that happens before or after onMount.
  // We reset the flag inside the block so a future restore (unlikely but
  // possible) can re-trigger. inputEl is in the dependency set so the
  // block re-evaluates once bind:this fires, in case the flag was set
  // before the element was bound.
  $: if (snapshotJustRestored && inputEl) {
    snapshotJustRestored = false;
    // Multi-attempt dismiss — WebView's auto-focus-on-history-back can
    // fire at the initial render, the first paint, OR a tick later.
    // We cover all three. The dismissKeyboard helper handles native
    // (Capacitor Keyboard.hide) vs web (blur).
    void dismissKeyboard();
    requestAnimationFrame(() => void dismissKeyboard());
    setTimeout(() => void dismissKeyboard(), 200);
  }

  // Apply any pending scroll position once the results container exists.
  // Reactive on `resultsEl` (becomes defined when {#if query} flips on)
  // and `hits` (ensures the list children are laid out → scrollHeight is
  // final, so scrollTop assignment lands at the right offset).
  $: if (resultsEl && hits.length > 0 && pendingScrollTop !== null) {
    const target = pendingScrollTop;
    pendingScrollTop = null;
    void tick().then(() => {
      if (resultsEl) resultsEl.scrollTop = target;
    });
  }

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
      lastSearchedQuery = '';
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
      // Mark q as displayed regardless of outcome (success / 0 hits / error).
      // This keeps snapshot.restore from re-running the same failing search
      // on every back-navigation; the user can manually retry by editing.
      lastSearchedQuery = q;
      loading = false;
    }
  }

  function clear() {
    query = '';
    hits = [];
    lastSearchedQuery = '';
    inputEl?.focus();
  }

  // Submit handler — fires when user presses Enter or the soft keyboard's
  // Search/Go button. Two effects:
  //   1. Flush any pending debounced runSearch immediately, so they see
  //      results right away instead of waiting out the 180ms timer.
  //   2. Dismiss the soft keyboard, freeing the screen for browsing
  //      results. Input keeps its value; tapping it re-opens the
  //      keyboard normally (default browser behaviour).
  function onSubmit() {
    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
      void runSearch();
    }
    void dismissKeyboard();
  }

  /**
   * Hide the soft keyboard reliably across web and native (Capacitor).
   *
   * Web: blur() is usually enough — browsers tie keyboard visibility to
   * the focused input element.
   *
   * Native (Android WebView): blur() alone often leaves the keyboard
   * up because the IME visibility state is decoupled from the WebView's
   * focused element — the system remembers "keyboard should be open" and
   * keeps showing it. @capacitor/keyboard's hide() calls the Android
   * InputMethodManager directly, which is the only reliable way to
   * dismiss it.
   *
   * Dynamic imports so the plugin doesn't enter the bundle on web /
   * before we actually need it.
   */
  async function dismissKeyboard() {
    inputEl?.blur();
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { Keyboard } = await import('@capacitor/keyboard');
      await Keyboard.hide();
    } catch {
      // Plugin missing or platform error — blur was the fallback.
    }
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
      <!--
        Wrap input in a form so the soft keyboard's "Search/Go" button (or a
        physical Enter key) fires submit. preventDefault stops the would-be
        page reload; onSubmit handles flush + blur (see script above).
      -->
      <form class="relative" on:submit|preventDefault={onSubmit}>
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
      </form>
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
    <div bind:this={resultsEl} class="flex-1 overflow-y-auto px-4 pb-4 pt-2">
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
