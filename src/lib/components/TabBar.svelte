<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { writable } from 'svelte/store';

  // Two top-level destinations. Order matters — the user requested 學習 on the left, 檢索 on the right.
  const tabs = [
    { id: 'learn', label: '學習', href: '/learn', icon: 'book' },
    { id: 'search', label: '檢索', href: '/search', icon: 'search' }
  ] as const;

  /**
   * Active tab is sticky across "neutral" routes (/entry, /random, /settings).
   * Only paths under /learn or /search reset the highlight, so when the user
   * navigates from a 學習 list → entry detail, the tab stays on 學習 instead
   * of jumping to 檢索 just because /entry was previously associated with it.
   */
  const lastExplicit = writable<'learn' | 'search'>('learn');

  $: {
    const p = $page.url.pathname;
    if (p.startsWith('/search')) lastExplicit.set('search');
    else if (p === '/learn' || p.startsWith('/learn/')) lastExplicit.set('learn');
    // /entry, /random, /settings: leave the highlight where it was.
  }

  $: current = $lastExplicit;
</script>

<!--
  In-flow flex child of the root layout (<div class="h-dvh flex flex-col"> in
  +layout.svelte). Takes its own ~64px + safe-bottom of height at the bottom,
  which makes <main class="flex-1"> automatically shorter — so every scroll
  container, scrollbar, and bottom-stuck bar inside main stops at the TabBar's
  top edge instead of extending under it.
-->
<nav
  class="no-print z-40 bg-bg/95 backdrop-blur-md border-t border-ink/10"
  style="padding-bottom: var(--safe-bottom);"
>
  <ul class="grid grid-cols-2">
    {#each tabs as t (t.id)}
      {@const active = current === t.id}
      <li>
        <button
          type="button"
          class="w-full flex flex-col items-center gap-0.5 py-2.5 active:bg-bg-deep transition-colors"
          on:click={() => goto(t.href)}
          aria-current={active ? 'page' : undefined}
        >
          <span
            class="grid place-items-center w-7 h-7 rounded-full transition-colors"
            class:bg-accent-tint={active}
          >
            {#if t.icon === 'book'}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class:text-accent-deep={active}
                class:text-ink-soft={!active}
              >
                <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z" />
                <path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />
              </svg>
            {:else}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class:text-accent-deep={active}
                class:text-ink-soft={!active}
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            {/if}
          </span>
          <span
            class="text-xs"
            class:font-semibold={active}
            class:text-accent-deep={active}
            class:text-ink-muted={!active}
          >
            {t.label}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</nav>
