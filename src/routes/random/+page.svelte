<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto, replaceState } from '$app/navigation';
  import { queryOne } from '$lib/db';
  import { getEntry } from '$lib/entry';
  import { entryAudioUrl, exampleAudioUrl } from '$lib/audio';
  import { getListEntries, parseListId } from '$lib/lists';
  import AudioButton from '$lib/components/AudioButton.svelte';
  import AddToListMenu from '$lib/components/AddToListMenu.svelte';
  import ListPicker from '$lib/components/ListPicker.svelte';
  import type { EntryDetail, ListId } from '$lib/types';

  let detail: EntryDetail | null = null;
  let loading = true;
  let error = '';
  let historyStack: number[] = [];
  let canGoBack = false;

  // Long-press support on the "再來一個 🎲" button: short tap = next random,
  // long press 1.5s = open the same ListPicker sheet that the top-of-page
  // 範圍 pill uses. Mirrors the /learn dice button's behaviour so the gesture
  // is consistent before vs. after entering 好手氣 mode.
  const LONG_PRESS_MS = 1500;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressFired = false;
  let scopePicker: ListPicker | undefined;

  function onDicePointerDown() {
    longPressFired = false;
    pressTimer = setTimeout(() => {
      longPressFired = true;
      pressTimer = null;
      void scopePicker?.show();
    }, LONG_PRESS_MS);
  }

  function onDicePointerUp() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function onDicePointerCancel() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function onDiceClick() {
    // Long-press already fired and opened the sheet — swallow the click so
    // we don't also fire nextRandom.
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    void nextRandom();
  }

  // Picked scope: null = no filter; otherwise either a user or cat list id.
  // URL is the source of truth: ?list=user:N | ?list=cat:XXX
  let selectedListId: ListId | null = (() => {
    const fromList = $page.url.searchParams.get('list');
    if (fromList) return fromList as ListId;
    // Legacy: keep the old ?category= URLs working.
    const fromCat = $page.url.searchParams.get('category');
    if (fromCat) return (`cat:${fromCat}` as ListId);
    return null;
  })();

  onMount(async () => {
    await nextRandom();
  });

  async function nextRandom() {
    loading = true;
    error = '';
    try {
      const id = await randomEntryId(selectedListId);
      if (id === null) {
        error = '這個範圍沒有可播放的詞條';
        loading = false;
        return;
      }
      // remember current as history before moving on (so back button works)
      if (detail) {
        historyStack = [...historyStack, detail.entry.id].slice(-20);
        canGoBack = true;
      }
      detail = await getEntry(id);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function previous() {
    const stack = [...historyStack];
    const prevId = stack.pop();
    if (prevId === undefined) return;
    historyStack = stack;
    canGoBack = stack.length > 0;
    loading = true;
    try {
      detail = await getEntry(prevId);
    } finally {
      loading = false;
    }
  }

  async function randomEntryId(listId: ListId | null): Promise<number | null> {
    // No filter — pick any playable entry app-wide.
    if (!listId) {
      const r = await queryOne<{ id: number }>(
        `SELECT id FROM entries
          WHERE audio_file IS NOT NULL
            AND id IN (SELECT entry_id FROM examples)
          ORDER BY RANDOM() LIMIT 1`
      );
      return r?.id ?? null;
    }

    const { kind, key } = parseListId(listId);

    if (kind === 'cat') {
      // Prefer entries that are playable and have at least one example.
      const r = await queryOne<{ id: number }>(
        `SELECT e.id AS id
           FROM entries e
           JOIN entry_categories c ON c.entry_id = e.id
          WHERE c.category = ?
            AND e.audio_file IS NOT NULL
            AND e.id IN (SELECT entry_id FROM examples)
          ORDER BY RANDOM() LIMIT 1`,
        [key]
      );
      if (r) return r.id;
      // Fallback: any entry in this category, even without audio/examples
      const fb = await queryOne<{ id: number }>(
        `SELECT e.id AS id
           FROM entries e
           JOIN entry_categories c ON c.entry_id = e.id
          WHERE c.category = ?
          ORDER BY RANDOM() LIMIT 1`,
        [key]
      );
      return fb?.id ?? null;
    }

    if (kind === 'great700') {
      // Pick directly via SQL — much cheaper than loading all 100 entries
      // then random-picking client-side. Prefer playable + has-examples.
      const listIdx = Number(key);
      const r = await queryOne<{ id: number }>(
        `SELECT e.id AS id
           FROM entries e
           JOIN great700_entries g ON g.entry_id = e.id
          WHERE g.list_idx = ?
            AND e.audio_file IS NOT NULL
            AND e.id IN (SELECT entry_id FROM examples)
          ORDER BY RANDOM() LIMIT 1`,
        [listIdx]
      );
      if (r) return r.id;
      const fb = await queryOne<{ id: number }>(
        `SELECT e.id AS id
           FROM entries e
           JOIN great700_entries g ON g.entry_id = e.id
          WHERE g.list_idx = ?
          ORDER BY RANDOM() LIMIT 1`,
        [listIdx]
      );
      return fb?.id ?? null;
    }

    // User list — pick a random entry from the saved set.
    const entries = await getListEntries(listId);
    if (entries.length === 0) return null;
    const playable = entries.filter((e) => e.audio_file);
    const pool = playable.length ? playable : entries;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  function onPick(nextId: ListId | null) {
    selectedListId = nextId;
    historyStack = [];
    canGoBack = false;
    // Reflect in URL so the choice survives refresh / is shareable.
    // Use SvelteKit's replaceState so the router's internal state stays in sync;
    // raw history.replaceState would silently desync and bite us on back/forward.
    replaceState(nextId ? `/random?list=${encodeURIComponent(nextId)}` : '/random', {});
    void nextRandom();
  }

  $: examplesByMeaning = (() => {
    const map = new Map<number, NonNullable<typeof detail>['examples']>();
    if (!detail) return map;
    for (const ex of detail.examples) {
      const arr = map.get(ex.meaning_id) ?? [];
      arr.push(ex);
      map.set(ex.meaning_id, arr);
    }
    return map;
  })();
</script>

<section class="flex-1 flex flex-col overflow-hidden">
  <header
    class="px-4 pt-3 pb-2 bg-bg sticky top-0 z-10 flex items-center gap-2 border-b border-ink/5"
  >
    <button
      type="button"
      class="w-9 h-9 grid place-items-center rounded-full hover:bg-bg-deep transition"
      aria-label="返回學習"
      on:click={() => goto('/learn')}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="15 6 9 12 15 18" />
      </svg>
    </button>
    <h1 class="flex-1 text-base font-han font-semibold text-ink">🎲 好手氣</h1>
  </header>

  <div class="px-4 pt-3">
    <span class="block text-xs text-ink-muted mb-1">範圍</span>
    <ListPicker bind:this={scopePicker} value={selectedListId} onChange={onPick} />
  </div>

  <div class="flex-1 overflow-y-auto px-4 pb-4 pt-3">
    {#if loading}
      <p class="text-ink-muted text-sm">挑選中…</p>
    {:else if error}
      <p class="text-red-700 text-sm">{error}</p>
    {:else if detail}
      <section class="bg-bg-card rounded-card px-5 py-5 border border-ink/5 shadow-sm">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <div class="text-4xl font-han font-semibold text-ink leading-tight">
              {detail.entry.hanji}
            </div>
            <div class="loma text-xl text-accent-deep mt-1 break-words">{detail.entry.loma}</div>
          </div>
          <div class="flex items-center gap-2">
            <AudioButton url={entryAudioUrl(detail.entry.id, detail.entry.audio_file)} />
          </div>
        </div>

        {#if detail.categories.length}
          <div class="mt-3 flex flex-wrap gap-1.5">
            {#each detail.categories as c (c)}
              <span class="text-xs text-accent-deep bg-accent-tint rounded-pill px-2.5 py-1">
                {c}
              </span>
            {/each}
          </div>
        {/if}

        <div class="mt-3 flex justify-end">
          <AddToListMenu entryId={detail.entry.id} />
        </div>
      </section>

      <section class="mt-4 grid gap-3">
        {#each detail.meanings as m, idx (m.meaning_id)}
          <article class="bg-bg-card rounded-card px-5 py-4 border border-ink/5 shadow-sm">
            <header class="flex items-baseline gap-2 mb-2">
              <span class="text-accent font-semibold">{idx + 1}.</span>
              {#if m.pos}
                <span class="text-xs text-ink-muted bg-bg-deep rounded-pill px-2 py-0.5">{m.pos}</span>
              {/if}
            </header>
            <p class="text-ink leading-relaxed">{m.definition}</p>

            {#if examplesByMeaning.get(m.meaning_id)?.length}
              <ul class="mt-3 grid gap-2 pl-2 border-l-2 border-accent-tint">
                {#each examplesByMeaning.get(m.meaning_id) ?? [] as ex (ex.seq)}
                  <li class="flex items-start gap-2">
                    <AudioButton url={exampleAudioUrl(ex.entry_id, ex.audio_file)} size="sm" />
                    <div class="flex-1 text-sm">
                      <div class="font-han text-ink">{ex.hanji}</div>
                      <div class="loma text-accent-deep mt-0.5">{ex.loma}</div>
                      {#if ex.mandarin}
                        <div class="text-ink-muted mt-0.5">{ex.mandarin}</div>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </article>
        {/each}
      </section>
    {/if}
  </div>

  <!-- Bottom action bar: prev + next.
       Natural last flex child of section → lands directly above the in-flow TabBar. -->
  <div
    class="z-10 px-4 py-3 bg-bg/95 backdrop-blur-md border-t border-ink/10 flex gap-3"
  >
    <button
      type="button"
      class="flex-1 py-2.5 rounded-pill bg-bg-card border border-ink/15 text-ink-soft text-sm font-medium
             disabled:opacity-40 active:scale-95 transition"
      disabled={!canGoBack}
      on:click={previous}
    >
      上一個
    </button>
    <button
      type="button"
      class="flex-[2] py-2.5 rounded-pill bg-accent text-bg-card text-sm font-semibold
             active:scale-95 transition select-none touch-none"
      on:pointerdown={onDicePointerDown}
      on:pointerup={onDicePointerUp}
      on:pointercancel={onDicePointerCancel}
      on:click={onDiceClick}
      on:contextmenu|preventDefault
      disabled={loading}
    >
      再來一個 🎲
    </button>
  </div>
</section>
