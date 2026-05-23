<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import ListCard from '$lib/components/ListCard.svelte';
  import ListPicker from '$lib/components/ListPicker.svelte';
  import { listUserLists, listCategories, listGreat700, createUserList } from '$lib/lists';
  import { learnTab, learnScroll, type LearnTab } from '$lib/stores/learnUi';
  import type { DictList, ListId } from '$lib/types';

  let userLists: DictList[] = [];
  let catLists: DictList[] = [];
  let great700Lists: DictList[] = [];
  let loading = true;
  let newName = '';
  let creating = false;
  const TAB_ORDER: LearnTab[] = ['user', 'cat', 'great700', 'random'];
  let panelEls: (HTMLDivElement | undefined)[] = [];

  // -------------------------------------------------------------------------
  // 「好手氣」分頁：短按骰子 = 直接 goto /random（全庫隨機）；長按 1.5 秒
  // = 浮出 ListPicker sheet，使用者可直接挑分類 / 自建表單為範圍再跳。
  // 長按機制永遠啟用，沒有「首次才有 / 摇過取消」的限制。
  // -------------------------------------------------------------------------
  const LONG_PRESS_MS = 1500;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressFired = false;
  let scopePicker: ListPicker | undefined;

  onMount(async () => {
    await refresh();
    await tick();
    restoreAllScrolls();
  });

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
    // If the long-press already fired (and opened the scope picker), don't
    // also navigate to /random — the picker's onChange will navigate instead.
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    goto('/random');
  }

  function onScopePick(id: ListId | null) {
    if (id) {
      goto(`/random?list=${encodeURIComponent(id)}`);
    } else {
      goto('/random');
    }
  }

  async function refresh() {
    loading = true;
    try {
      [userLists, catLists, great700Lists] = await Promise.all([
        listUserLists(),
        listCategories(),
        listGreat700()
      ]);
    } finally {
      loading = false;
    }
  }

  // Each panel keeps its own scroll position naturally (all 4 are mounted),
  // but we still persist to a store so navigating away and back restores it.
  function restoreAllScrolls() {
    const s = get(learnScroll);
    for (let i = 0; i < TAB_ORDER.length; i++) {
      const el = panelEls[i];
      if (el) el.scrollTop = s[TAB_ORDER[i]] ?? 0;
    }
  }

  function onPanelScroll(t: LearnTab, e: Event) {
    const top = (e.currentTarget as HTMLDivElement).scrollTop;
    learnScroll.update((s) => (s[t] === top ? s : { ...s, [t]: top }));
  }

  async function handleCreate(e: Event) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    creating = true;
    try {
      const id = await createUserList(name);
      newName = '';
      goto(`/learn/${encodeURIComponent(id)}`);
    } finally {
      creating = false;
    }
  }

  // -----------------------------------------------------------------
  // Carousel: 4 panels mounted horizontally inside a flex row, switched
  // by translating the row. Finger drag is tracked live so the panel
  // follows the touch; release snaps to the nearest panel with a CSS
  // transition. Threshold of 25% of container width before commit.
  //
  // Direction is locked on first non-trivial movement: horizontal-dominant
  // (dx > dy × 1.2) takes over and preventDefault stops vertical scroll;
  // otherwise vertical scroll wins and we don't intercept.
  //
  // GOTCHA — touch ↔ pointer interaction:
  //   Any touch that ends up calling e.preventDefault() on this container
  //   causes the browser to fire `pointercancel` on the touch's original
  //   target. For interactive children that rely on hold-gestures (the dice
  //   long-press, anything similar in future), that pointercancel kills the
  //   gesture timer mid-flight. We solve it by IGNORING any touch whose
  //   target is itself an interactive element (button / link / input / ...),
  //   leaving such elements free to handle the gesture themselves. Swipe
  //   still works when the touch starts on the panel background or a
  //   `<div role="button">` (ListCards), because `closest('button')` doesn't
  //   match a div regardless of its role.
  // -----------------------------------------------------------------
  let swiperEl: HTMLDivElement;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOffsetPx = 0;
  let containerWidth = 1;
  let dragDirection: 'pending' | 'horizontal' | 'vertical' = 'pending';
  // Latched on touchstart when the touch lands on an interactive child;
  // makes onSwipeMove / onSwipeEnd no-op for the rest of the gesture.
  let ignoreSwipe = false;

  function isInteractiveTouchTarget(t: EventTarget | null): boolean {
    return (
      t instanceof Element &&
      t.closest('button, a, input, textarea, select, label') !== null
    );
  }

  function onSwipeStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    if (isInteractiveTouchTarget(e.target)) {
      ignoreSwipe = true;
      return;
    }
    ignoreSwipe = false;
    dragStartX = e.touches[0].clientX;
    dragStartY = e.touches[0].clientY;
    dragOffsetPx = 0;
    dragDirection = 'pending';
    containerWidth = swiperEl?.clientWidth || 1;
  }

  function onSwipeMove(e: TouchEvent) {
    if (ignoreSwipe) return;
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - dragStartX;
    const dy = e.touches[0].clientY - dragStartY;

    if (dragDirection === 'pending') {
      // Wait until movement is large enough to commit to a direction.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      dragDirection = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical';
      if (dragDirection === 'horizontal') dragging = true;
    }

    if (dragDirection !== 'horizontal') return;
    e.preventDefault(); // stop vertical scroll while horizontally swiping
    let off = dx;
    // Rubber-band resistance at the ends so the user feels the edge.
    const cur = TAB_ORDER.indexOf($learnTab);
    if ((cur === 0 && off > 0) || (cur === TAB_ORDER.length - 1 && off < 0)) {
      off = off * 0.3;
    }
    dragOffsetPx = off;
  }

  function onSwipeEnd() {
    if (ignoreSwipe) {
      ignoreSwipe = false;
      return;
    }
    if (!dragging) return;
    const ratio = dragOffsetPx / containerWidth;
    const cur = TAB_ORDER.indexOf($learnTab);
    let nextTab: LearnTab = $learnTab;
    if (ratio < -0.25 && cur < TAB_ORDER.length - 1) {
      nextTab = TAB_ORDER[cur + 1];
    } else if (ratio > 0.25 && cur > 0) {
      nextTab = TAB_ORDER[cur - 1];
    }
    dragging = false;
    dragOffsetPx = 0;
    dragDirection = 'pending';
    if (nextTab !== $learnTab) {
      $learnTab = nextTab;
    }
  }

  $: tabIdx = Math.max(0, TAB_ORDER.indexOf($learnTab));
  $: dragRatio = dragging ? dragOffsetPx / containerWidth : 0;
  $: transformPct = (-tabIdx + dragRatio) * 100;
</script>

<section class="flex-1 flex flex-col overflow-hidden">
  <header class="px-4 pt-4 pb-2 bg-bg sticky top-0 z-10 flex items-start justify-between gap-3">
    <div class="flex-1">
      <h1 class="text-2xl font-bold text-ink">學習</h1>
      <p class="text-sm text-ink-muted">挑一張表單開始學習，或自建單字表</p>
    </div>
    <button
      type="button"
      class="w-9 h-9 grid place-items-center rounded-full hover:bg-bg-deep transition mt-1"
      aria-label="設定"
      on:click={() => goto('/settings')}
    >
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
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.21 16.9l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 0 1 7.04 3.9l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06A2 2 0 1 1 19.62 7.04l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  </header>

  <!-- Tabs -->
  <nav class="px-4 sticky top-[5.25rem] z-10 bg-bg">
    <div class="inline-flex bg-bg-card rounded-pill p-1 border border-ink/10">
      <button
        type="button"
        class="px-4 py-1.5 rounded-pill text-sm transition
               {$learnTab === 'user' ? 'bg-accent text-bg-card font-semibold' : 'text-ink-muted'}"
        on:click={() => ($learnTab = 'user')}
      >
        我的單字表
      </button>
      <button
        type="button"
        class="px-4 py-1.5 rounded-pill text-sm transition
               {$learnTab === 'cat' ? 'bg-accent text-bg-card font-semibold' : 'text-ink-muted'}"
        on:click={() => ($learnTab = 'cat')}
      >
        分類詞庫
      </button>
      <button
        type="button"
        class="px-4 py-1.5 rounded-pill text-sm transition
               {$learnTab === 'great700' ? 'bg-accent text-bg-card font-semibold' : 'text-ink-muted'}"
        on:click={() => ($learnTab = 'great700')}
      >
        700 字
      </button>
      <button
        type="button"
        class="px-4 py-1.5 rounded-pill text-sm transition
               {$learnTab === 'random' ? 'bg-accent text-bg-card font-semibold' : 'text-ink-muted'}"
        on:click={() => ($learnTab = 'random')}
      >
        試試運氣吧
      </button>
    </div>
  </nav>

  <!--
    Carousel container. All 4 panels are mounted; only the active one is in
    view via translateX. Touch events on the container track drag → live
    transform of the inner row → snap on release.
  -->
  <!-- svelte-ignore a11y_no_static_element_interactions — touch is gesture detection, scroll containers are the per-panel interactive elements -->
  <div
    bind:this={swiperEl}
    class="flex-1 overflow-hidden"
    on:touchstart={onSwipeStart}
    on:touchmove|nonpassive={onSwipeMove}
    on:touchend={onSwipeEnd}
    on:touchcancel={onSwipeEnd}
  >
    <div
      class="flex h-full will-change-transform"
      style="transform: translateX({transformPct}%); transition: {dragging
        ? 'none'
        : 'transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1)'};"
    >
      <!-- Panel: 我的單字表 -->
      <div
        bind:this={panelEls[0]}
        on:scroll={(e) => onPanelScroll('user', e)}
        class="shrink-0 w-full h-full overflow-y-auto px-4 pb-4 pt-3"
      >
        {#if loading}
          <p class="text-ink-muted text-sm">載入中…</p>
        {:else}
          <form on:submit={handleCreate} class="flex gap-2 mb-4">
            <input
              bind:value={newName}
              type="text"
              placeholder="新單字表名稱…"
              maxlength="15"
              class="flex-1 bg-bg-card border border-ink/10 rounded-pill px-4 py-2.5
                     text-sm text-ink placeholder:text-ink-muted focus:outline-none
                     focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              class="px-4 py-2.5 rounded-pill bg-accent text-bg-card text-sm font-semibold
                     disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition"
            >
              新建
            </button>
          </form>

          {#if userLists.length === 0}
            <div class="flex items-center justify-center min-h-[50vh]">
              <p class="text-ink-muted text-sm text-center">你還沒有單字表。快建立一個吧！</p>
            </div>
          {:else}
            <ul class="grid gap-2.5">
              {#each userLists as l (l.id)}
                <li><ListCard list={l} /></li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>

      <!-- Panel: 分類詞庫 -->
      <div
        bind:this={panelEls[1]}
        on:scroll={(e) => onPanelScroll('cat', e)}
        class="shrink-0 w-full h-full overflow-y-auto px-4 pb-4 pt-3"
      >
        {#if loading}
          <p class="text-ink-muted text-sm">載入中…</p>
        {:else}
          <ul class="grid gap-2.5">
            {#each catLists as l (l.id)}
              <li><ListCard list={l} /></li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Panel: 700 字 -->
      <div
        bind:this={panelEls[2]}
        on:scroll={(e) => onPanelScroll('great700', e)}
        class="shrink-0 w-full h-full overflow-y-auto px-4 pb-4 pt-3"
      >
        {#if loading}
          <p class="text-ink-muted text-sm">載入中…</p>
        {:else}
          <ul class="grid gap-2.5">
            {#each great700Lists as l (l.id)}
              <li><ListCard list={l} /></li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Panel: 試試運氣吧 -->
      <div
        bind:this={panelEls[3]}
        on:scroll={(e) => onPanelScroll('random', e)}
        class="shrink-0 w-full h-full overflow-y-auto px-4 pb-4 pt-3"
      >
        <div class="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6">
          <!--
            The dice button is inside the swipe-carousel. Touch events
            bubbling up to the carousel were our root cause for the
            long-press not firing: the carousel's touchmove handler
            calls e.preventDefault() once it commits to a horizontal
            direction, and per the Pointer Events spec that triggers
            `pointercancel` on the touch's original pointer (the dice
            in our case), which our onDicePointerCancel then uses to
            clear the 1.5-second long-press timer.

            `on:touchstart|stopPropagation` + `on:touchmove|stopPropagation`
            here halts the touch-event bubble at the dice. The carousel
            never sees these touches, never gets a chance to call
            preventDefault, never causes a pointercancel — long-press
            timer survives the full 1.5s and `scopePicker?.show()` fires.
            Pointer events on the dice are NOT affected (they ride a
            separate event stream + are explicitly bound on the button).
          -->
          <button
            type="button"
            class="w-40 h-40 grid place-items-center rounded-full bg-accent text-bg-card
                   shadow-xl active:scale-95 transition text-7xl select-none touch-none"
            aria-label="隨機抽一個詞條"
            on:touchstart|stopPropagation
            on:touchmove|stopPropagation
            on:pointerdown={onDicePointerDown}
            on:pointerup={onDicePointerUp}
            on:pointercancel={onDicePointerCancel}
            on:click={onDiceClick}
            on:contextmenu|preventDefault
          >
            🎲
          </button>
          <p class="text-sm text-ink-muted text-center max-w-[20rem]">
            點骰子隨機抽一個詞條
          </p>
        </div>
      </div>
    </div>
  </div>

  <!--
    Hidden ListPicker: opened programmatically by the dice long-press
    handler. `triggerless` suppresses the built-in trigger pill — the
    dice button is the trigger here.

    CRITICAL: this MUST live OUTSIDE the carousel's transformed inner
    row. Per the CSS Transforms spec, any non-`none` `transform` on an
    ancestor makes that ancestor the containing block for `position:fixed`
    descendants — instead of the viewport. The carousel inner row uses
    `transform: translateX(...)` to slide between tabs, so a ListPicker
    placed inside one of the panels would have its `position:fixed inset:0`
    modal anchored to the translated row, rendering it ~3 viewport-widths
    off-screen to the left when the random tab is active. That was the
    "long-press has no effect on /learn but works on /random" bug — the
    timer DID fire and `scopePicker.show()` DID set `open=true`; the
    modal just rendered far outside the visible viewport.

    Sitting here as a sibling of the carousel (and of the section's other
    children), with no transform / filter / will-change between it and
    the document root, its fixed-position modal correctly anchors to the
    viewport.
  -->
  <ListPicker bind:this={scopePicker} triggerless value={null} onChange={onScopePick} />
</section>
