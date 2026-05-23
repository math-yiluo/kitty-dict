<script lang="ts">
  import { goto } from '$app/navigation';
  import type { CardMode, DictList } from '$lib/types';

  export let list: DictList;
  export let mode: CardMode;
  export let onOpenModePicker: () => void;
  /** If provided, shows a "manage" icon (gear) that opens user-list management. */
  export let onManage: (() => void) | null = null;
  /** If provided, shows a print icon that calls this. */
  export let onPrint: (() => void) | null = null;

  const MODE_LABEL: Record<CardMode, string> = {
    word: '僅詞條',
    'word-sentence': '詞與句',
    sentence: '僅例句'
  };
</script>

<header
  class="no-print px-4 pt-3 pb-2 bg-bg sticky top-0 z-10 flex items-center gap-3 border-b border-ink/5"
>
  <button
    type="button"
    class="w-9 h-9 grid place-items-center rounded-full hover:bg-bg-deep transition shrink-0"
    aria-label="返回"
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

  <h1 class="flex-1 text-base font-han font-semibold text-ink truncate">{list.name}</h1>

  <!-- Mode picker pill: shows current mode label + a ▾ to indicate it's a menu -->
  <button
    type="button"
    class="inline-flex items-center gap-1 px-3 py-1 rounded-pill bg-accent text-bg-card text-xs
           font-semibold transition active:scale-95 shrink-0"
    aria-label="切換顯示模式"
    title="切換顯示模式"
    on:click={onOpenModePicker}
  >
    {MODE_LABEL[mode]}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if onPrint}
    <button
      type="button"
      class="w-9 h-9 grid place-items-center rounded-full hover:bg-bg-deep transition shrink-0"
      aria-label="列印 / 匯出"
      on:click={onPrint}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
    </button>
  {/if}

  {#if onManage}
    <button
      type="button"
      class="w-9 h-9 grid place-items-center rounded-full hover:bg-bg-deep transition shrink-0"
      aria-label="管理表單"
      title="管理表單"
      on:click={onManage}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="2.2" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.21 16.9l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 0 1 7.04 3.9l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06A2 2 0 1 1 19.62 7.04l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  {/if}
</header>
