<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { listUserLists, listCategories, listGreat700 } from '$lib/lists';
  import type { DictList, ListId } from '$lib/types';

  /** Currently selected list id; null means "all" (no filter). */
  export let value: ListId | null = null;
  /** Called when the user picks something; passes null for "all". */
  export let onChange: (next: ListId | null) => void;
  /**
   * If true, the component renders ONLY the sheet — the trigger pill is hidden.
   * The parent is expected to open the sheet imperatively via `bind:this` and
   * calling `.show()`. Useful for long-press / gesture-driven openers.
   */
  export let triggerless = false;

  let open = false;
  let userLists: DictList[] = [];
  let great700Lists: DictList[] = [];
  let catLists: DictList[] = [];
  let loaded = false;
  let sheetEl: HTMLElement | undefined;

  async function ensureLoaded() {
    if (loaded) return;
    [userLists, great700Lists, catLists] = await Promise.all([
      listUserLists(),
      listGreat700(),
      listCategories()
    ]);
    loaded = true;
  }

  /**
   * Exposed so triggerless mode (or parents that want a programmatic opener
   * in addition to the built-in pill) can open the sheet from outside.
   * Call via `pickerRef.show()` after `bind:this={pickerRef}`.
   */
  export async function show() {
    open = true;
    await ensureLoaded();
    await tick();
    if (value && sheetEl) {
      const target = sheetEl.querySelector<HTMLElement>(`[data-list-id="${CSS.escape(value)}"]`);
      target?.scrollIntoView({ block: 'center' });
    }
  }

  function hide() {
    open = false;
  }

  function pick(id: ListId | null) {
    onChange(id);
    hide();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      hide();
    }
  }

  $: currentLabel = (() => {
    if (!value) return '全部';
    if (!loaded) return '…';
    const all = [...userLists, ...great700Lists, ...catLists];
    const match = all.find((l) => l.id === value);
    return match?.name ?? '全部';
  })();

  $: currentCount = (() => {
    if (!value || !loaded) return null;
    const all = [...userLists, ...great700Lists, ...catLists];
    return all.find((l) => l.id === value)?.count ?? null;
  })();

  onMount(() => {
    void ensureLoaded();
  });
</script>

{#if !triggerless}
  <button
    type="button"
    on:click={show}
    class="w-full bg-bg-card border border-ink/10 rounded-pill px-4 py-2.5
           text-left flex items-center justify-between gap-2
           hover:bg-bg-deep focus:outline-none focus:ring-2 focus:ring-accent/40
           focus:border-accent transition"
  >
    <span class="flex-1 min-w-0 truncate text-sm text-ink">
      {currentLabel}
      {#if currentCount !== null}
        <span class="text-ink-muted text-xs ml-1">（{currentCount.toLocaleString()}）</span>
      {/if}
    </span>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="text-ink-muted shrink-0"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>
{/if}

{#if open}
  <div
    class="no-print fixed inset-0 z-[55] bg-ink/40 backdrop-blur-sm flex items-end"
    on:click|self={hide}
    on:keydown={onKey}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div
      bind:this={sheetEl}
      class="w-full bg-bg-card rounded-t-card border-t border-ink/10 shadow-2xl
             max-h-[75vh] flex flex-col animate-[fadeUp_140ms_ease-out]"
      style="padding-bottom: var(--safe-bottom);"
    >
      <header class="px-5 pt-4 pb-2 flex items-center justify-between border-b border-ink/5">
        <h2 class="font-han font-semibold text-ink text-base">選擇範圍</h2>
        <button
          type="button"
          class="text-sm text-ink-muted px-2 py-1 hover:bg-bg-deep rounded-pill transition"
          on:click={hide}>取消</button
        >
      </header>

      <div class="flex-1 overflow-y-auto px-2 py-2 custom-scroll">
        <button
          type="button"
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition text-left
                 {value === null ? 'bg-accent-tint text-accent-deep font-semibold' : 'hover:bg-bg-deep'}"
          on:click={() => pick(null)}
        >
          <span
            class="w-4 h-4 rounded-full border grid place-items-center
                   {value === null ? 'border-accent-deep' : 'border-ink/30'}"
            aria-hidden="true"
          >
            {#if value === null}
              <span class="w-2 h-2 bg-accent-deep rounded-full"></span>
            {/if}
          </span>
          <span class="flex-1 text-sm">全部（不過濾）</span>
        </button>

        {#if !loaded}
          <p class="text-ink-muted text-sm text-center py-6">載入中…</p>
        {:else}
          {#if userLists.length}
            <div
              class="px-3 pt-3 pb-1 text-xs font-semibold text-ink-muted uppercase tracking-wider"
            >
              我的單字表
            </div>
            {#each userLists as l (l.id)}
              {@const selected = value === l.id}
              <button
                type="button"
                data-list-id={l.id}
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition text-left
                       {selected ? 'bg-accent-tint text-accent-deep font-semibold' : 'hover:bg-bg-deep'}"
                on:click={() => pick(l.id)}
              >
                <span
                  class="w-4 h-4 rounded-full border grid place-items-center shrink-0
                         {selected ? 'border-accent-deep' : 'border-ink/30'}"
                  aria-hidden="true"
                >
                  {#if selected}
                    <span class="w-2 h-2 bg-accent-deep rounded-full"></span>
                  {/if}
                </span>
                <span class="flex-1 min-w-0 text-sm truncate">{l.name}</span>
                <span class="text-xs text-ink-muted shrink-0">{l.count.toLocaleString()}</span>
              </button>
            {/each}
          {/if}

          {#if great700Lists.length}
            <div
              class="px-3 pt-3 pb-1 text-xs font-semibold text-ink-muted uppercase tracking-wider"
            >
              700 字
            </div>
            {#each great700Lists as l (l.id)}
              {@const selected = value === l.id}
              <button
                type="button"
                data-list-id={l.id}
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition text-left
                       {selected ? 'bg-accent-tint text-accent-deep font-semibold' : 'hover:bg-bg-deep'}"
                on:click={() => pick(l.id)}
              >
                <span
                  class="w-4 h-4 rounded-full border grid place-items-center shrink-0
                         {selected ? 'border-accent-deep' : 'border-ink/30'}"
                  aria-hidden="true"
                >
                  {#if selected}
                    <span class="w-2 h-2 bg-accent-deep rounded-full"></span>
                  {/if}
                </span>
                <span class="flex-1 min-w-0 text-sm truncate">{l.name}</span>
                <span class="text-xs text-ink-muted shrink-0">{l.count.toLocaleString()}</span>
              </button>
            {/each}
          {/if}

          <div
            class="px-3 pt-3 pb-1 text-xs font-semibold text-ink-muted uppercase tracking-wider"
          >
            分類詞庫
          </div>
          {#each catLists as l (l.id)}
            {@const selected = value === l.id}
            <button
              type="button"
              data-list-id={l.id}
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition text-left
                     {selected ? 'bg-accent-tint text-accent-deep font-semibold' : 'hover:bg-bg-deep'}"
              on:click={() => pick(l.id)}
            >
              <span
                class="w-4 h-4 rounded-full border grid place-items-center shrink-0
                       {selected ? 'border-accent-deep' : 'border-ink/30'}"
                aria-hidden="true"
              >
                {#if selected}
                  <span class="w-2 h-2 bg-accent-deep rounded-full"></span>
                {/if}
              </span>
              <span class="flex-1 min-w-0 text-sm truncate">{l.name}</span>
              <span class="text-xs text-ink-muted shrink-0">{l.count.toLocaleString()}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes fadeUp {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  /* .custom-scroll class kept on the sheet's scroll div as a hint; the
     scrollbar styling itself is now global in src/app.css. */
</style>
