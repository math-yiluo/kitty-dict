<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import {
    getList,
    getListEntries,
    renameUserList,
    deleteUserList,
    removeFromUserList
  } from '$lib/lists';
  import {
    getCachedList,
    setCachedList,
    clearCachedList,
    updateCachedListMeta,
    dropCachedListEntry
  } from '$lib/listCache';
  import { alertDialog, confirmDialog, promptDialog } from '$lib/dialog';
  import {
    player,
    loadList,
    pause,
    toggle,
    prev,
    next,
    cycleSpeed,
    gotoIndex,
    setMode,
    removeFromPlayer
  } from '$lib/player';
  import type { CardMode, DictList, ListId } from '$lib/types';
  import type { Snapshot } from './$types';
  import TopBar from '$lib/components/TopBar.svelte';
  import PlayerBar from '$lib/components/PlayerBar.svelte';

  let listMeta: DictList | null = null;
  let loading = true;
  let error = '';
  let cardEls: HTMLElement[] = [];
  // The scrollable container (the <ul> below). window doesn't scroll in this
  // app — main is overflow-hidden and the list itself is overflow-y-auto.
  // SvelteKit's built-in scroll restoration uses window.scrollTo, so it
  // does nothing here; we capture/restore listEl.scrollTop via `snapshot`
  // below instead.
  let listEl: HTMLUListElement | undefined;
  // Scroll position to apply after the list mounts + finishes loading.
  // Populated by snapshot.restore on back-navigation.
  let pendingScrollTop: number | null = null;

  // SvelteKit snapshot: preserve the list's scroll position across navigation
  // (e.g., when the user clicks a card → /entry/[id] → back). Pairs with the
  // in-memory cache in $lib/listCache, which ensures the list content is in
  // the DOM (with its full scrollHeight) by the time we restore scrollTop.
  export const snapshot: Snapshot<{ scrollTop: number }> = {
    capture: () => ({ scrollTop: listEl?.scrollTop ?? 0 }),
    restore: (snap) => {
      pendingScrollTop = snap.scrollTop;
    }
  };

  // Manage modal / edit-mode state for user-created lists.
  let showManageModal = false;
  let editMode = false;

  // Mode picker sheet (open from TopBar).
  let showModeSheet = false;

  const MODE_OPTIONS: { mode: CardMode; label: string; hint: string }[] = [
    { mode: 'word', label: '僅詞條', hint: '只顯示詞條卡片' },
    {
      mode: 'word-sentence',
      label: '詞與句',
      hint: '每個詞條後接其例句；shuffle 時例句跟隨詞條'
    },
    { mode: 'sentence', label: '僅例句', hint: '只顯示例句；無例句的詞條會跳過' }
  ];

  function openModePicker() {
    showModeSheet = true;
  }

  function pickMode(m: CardMode) {
    showModeSheet = false;
    setMode(m);
  }

  async function handlePrint() {
    // Web: use the browser's native print dialog — user picks "save as PDF".
    // Browsers produce a TRUE VECTOR PDF here (text remains text, lines are
    // lines, infinitely scalable, selectable, searchable).
    //
    // Native (Capacitor on Android): bridge over to our WebViewPdfPlugin
    // (Java, in android/app/src/main/java/tw/kitty/dict/WebViewPdfPlugin.java),
    // which calls `webView.createPrintDocumentAdapter()` — Chromium's
    // native print engine, the SAME pipeline Chrome uses for "Save as PDF"
    // on desktop. Output is a true vector PDF: same quality as the web
    // path, NOT the raster output the previous html2pdf.js approach
    // produced. The plugin renders the existing `.print-only` block in
    // this template using the same `@media print` CSS the web path uses.
    //
    // Hand the resulting file to the system share sheet via
    // @capacitor/share with `files: [uri]` — that triggers ACTION_SEND
    // with EXTRA_STREAM + application/pdf MIME, so the sheet enumerates
    // apps that can RECEIVE a PDF (Drive, Files, Gmail, …) — each with a
    // save action.
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      window.print();
      return;
    }
    if (!listMeta) return;

    // Loading overlay covers the viewport while the native print pipeline
    // runs (typically <5 s, no canvas raster step). MUST have class="no-print"
    // so the @media print rule `.no-print { display:none !important }`
    // hides it during the WebView's print rendering pass — otherwise it
    // would render as a fullscreen yellow rectangle covering everything in
    // the PDF.
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'no-print';
    loadingOverlay.style.cssText = [
      'position:fixed',
      'top:0', 'right:0', 'bottom:0', 'left:0',
      'background:#FFF8D6',
      'z-index:9999',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'color:#247E4D',
      'font-size:18px',
      'font-weight:600'
    ].join(';');
    loadingOverlay.textContent = '匯出 PDF 中…';
    document.body.appendChild(loadingOverlay);

    const removeOverlay = () => {
      if (loadingOverlay.parentNode) {
        loadingOverlay.parentNode.removeChild(loadingOverlay);
      }
    };

    try {
      // Bridge to native plugin. `registerPlugin('WebViewPdf')` returns a
      // proxy that calls our Java plugin's @PluginMethod methods. Cap 8
      // resolves this via Bridge.getPlugin('WebViewPdf') — works because
      // we registered the class in MainActivity.onCreate.
      const { registerPlugin } = await import('@capacitor/core');
      const WebViewPdf = registerPlugin<{
        printToPdf(opts: { filename: string }): Promise<{ uri: string }>;
      }>('WebViewPdf');
      const { Share } = await import('@capacitor/share');

      // Sanitize for filesystem: strip the chars Android / Windows / iOS
      // file managers all reject in filenames.
      const safeName = listMeta.name.replace(/[\\/:*?"<>|]/g, '_');
      const filename = `${safeName}.pdf`;

      console.log('[print] calling native WebViewPdf.printToPdf', filename);
      const { uri } = await WebViewPdf.printToPdf({ filename });
      console.log('[print] got vector PDF at', uri);

      // Remove the loading overlay BEFORE opening the share sheet. Two
      // reasons:
      //   1. Our overlay is z-index:9999; alertDialog is z-[60]. If
      //      Share.share() rejects (e.g. user backs out of the share sheet
      //      without picking anything) and we then `await alertDialog(...)`,
      //      the dialog renders behind the overlay — invisible, unclickable,
      //      promise never resolves, the user is stuck on the loading
      //      overlay forever. (Historical bug: tapping Export but then
      //      dismissing the share sheet without picking save/share left
      //      the user permanently stuck on the "exporting PDF…" overlay.)
      //   2. The Android share sheet is its own system UI; once it's up
      //      our overlay serves no purpose anyway.
      removeOverlay();

      try {
        await Share.share({
          title: listMeta.name,
          files: [uri],
          dialogTitle: '匯出 / 分享 PDF'
        });
        console.log('[print] done ✓');
      } catch (shareErr) {
        // Share sheet dismissed without picking a target. Treat as
        // user-intentional cancellation — PDF is already in cache, do
        // nothing. NO error dialog: the user already knew they were
        // backing out, popping a "匯出失敗" alert would be wrong.
        console.log('[print] share dismissed:', shareErr);
      }
    } catch (err) {
      // PDF generation (native plugin) actually failed. Surface the
      // error to the user.
      console.error('[print] failed:', err);
      removeOverlay(); // ensure dialog isn't hidden behind overlay
      await alertDialog({
        title: '匯出失敗',
        body: (err as Error)?.message ?? String(err)
      });
    } finally {
      removeOverlay(); // belt-and-suspenders; no-op if already removed
    }
  }

  // ----- Manage actions (only for user-created lists) -----

  function openManage() {
    if (!listMeta || listMeta.builtin) return;
    showManageModal = true;
  }

  async function actionRename() {
    if (!listMeta || !listId) return;
    showManageModal = false;
    const next = await promptDialog({
      title: '重新命名',
      body: '輸入新的單字表名稱（最多 15 字）',
      defaultValue: listMeta.name,
      maxLength: 15,
      confirmText: '儲存'
    });
    if (next == null) return;
    if (next === listMeta.name) return;
    try {
      await renameUserList(listId, next);
      listMeta = { ...listMeta, name: next };
      updateCachedListMeta(listId, { name: next });
    } catch (err) {
      await alertDialog({ title: '改名失敗', body: (err as Error).message });
    }
  }

  async function actionDelete() {
    if (!listMeta || !listId) return;
    const ok = await confirmDialog({
      title: `確定刪除「${listMeta.name}」？`,
      body: '這個動作無法復原。',
      confirmText: '刪除',
      destructive: true
    });
    if (!ok) return;
    try {
      await deleteUserList(listId);
      clearCachedList(listId);
      goto('/learn');
    } catch (err) {
      await alertDialog({ title: '刪除失敗', body: (err as Error).message });
      showManageModal = false;
    }
  }

  function actionEnterEdit() {
    showManageModal = false;
    editMode = true;
    pause();
  }

  async function removeEntry(entryId: number) {
    if (!listId) return;
    try {
      await removeFromUserList(listId, entryId);
      removeFromPlayer(entryId);
      if (listMeta) {
        listMeta = { ...listMeta, count: Math.max(0, listMeta.count - 1) };
      }
      dropCachedListEntry(listId, entryId);
    } catch (err) {
      await alertDialog({ title: '移除失敗', body: (err as Error).message });
    }
  }

  $: rawId = $page.params.listId;
  $: listId = (rawId ? decodeURIComponent(rawId) : null) as ListId | null;

  $: void load(listId);

  // Apply any pending scroll position once the list <ul> is mounted and
  // load() has finished. The cache hit path makes this near-instant; on
  // cache miss the trigger fires once loading flips to false.
  $: if (listEl && !loading && pendingScrollTop !== null) {
    const target = pendingScrollTop;
    pendingScrollTop = null;
    void tick().then(() => {
      if (listEl) listEl.scrollTop = target;
    });
  }

  async function load(id: ListId | null) {
    if (!id) return;

    // Cache hit: synchronously populate state so the page renders fully
    // before SvelteKit attempts scroll restoration. See $lib/listCache for
    // the full explanation.
    const cached = getCachedList(id);
    if (cached) {
      error = '';
      listMeta = cached.meta;
      loadList(id, cached.entries);
      loading = false;
      if ($page.url.searchParams.get('autoplay') === '1') {
        oneShotScrollNext = true;
        gotoIndex(0);
      }
      return;
    }

    // Cache miss: fall back to the original async path.
    loading = true;
    error = '';
    try {
      const [meta, entries] = await Promise.all([getList(id), getListEntries(id)]);
      if (!meta) {
        error = '找不到這張表單';
        loading = false;
        return;
      }
      listMeta = meta;
      loadList(id, entries);
      setCachedList(id, meta, entries);

      // ?autoplay=1 → user came in via the ListCard's ▶ button, start the
      // first card immediately. Plain card-body taps go to /learn/<id>
      // without this query param and stay paused (default behaviour).
      // Note: WKWebView / Android WebView require audio.play() to be triggered
      // from a user gesture; the gesture token from the ListCard click may have
      // expired by the time async load() resolves. If play() rejects, the
      // player just stays paused — `cursor` already moved to 0 so the UI
      // matches "ready to play" state, and the user can tap ▶ to start.
      if ($page.url.searchParams.get('autoplay') === '1') {
        oneShotScrollNext = true; // also center the first card on entry
        gotoIndex(0);
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  // -------------------------------------------------------------------------
  // Auto-scroll the currently-playing card into view, but yield to the user.
  //
  // Naive scrollIntoView snapped the page back the instant cursor advanced,
  // making it impossible to scroll up and inspect earlier cards while audio
  // played. Fix: if the user touched / scrolled in the last 1.5s, defer the
  // scroll-back until they've been still that long. Each new user input
  // resets the timer.
  //
  // We detect "user input" via wheel + touchmove (these don't fire from
  // programmatic scrollIntoView, only from real input), which is more reliable
  // than trying to flag-gate the scroll event.
  // -------------------------------------------------------------------------
  const SCROLL_BACK_DELAY = 1500;
  let lastUserScrollAt = -Infinity;
  let pendingScrollTimer: ReturnType<typeof setTimeout> | null = null;
  // One-shot flag: set when the user explicitly taps a card. The next
  // cursor-change reactive trigger centers that card (regardless of
  // auto-play state) and then clears the flag — so subsequent scrolling
  // is governed by the normal auto-play-only rule.
  let oneShotScrollNext = false;

  /**
   * Called from the card's article click handler. Sets the one-shot flag so
   * the about-to-change cursor gets scrolled into view once, then delegates
   * to player.gotoIndex which moves cursor + starts playback.
   */
  function tapCardToPlay(cursor: number) {
    oneShotScrollNext = true;
    gotoIndex(cursor);
  }

  function clearPendingScroll() {
    if (pendingScrollTimer) {
      clearTimeout(pendingScrollTimer);
      pendingScrollTimer = null;
    }
  }

  function isAutoPlaying(): boolean {
    return $player.autoAdvance && $player.isPlaying;
  }

  function onUserScrollGesture() {
    lastUserScrollAt = Date.now();
    // If a deferred scroll-back was queued, push it out by another full delay
    // (and re-check the condition when it fires — user might have paused mid-wait).
    if (pendingScrollTimer) {
      clearPendingScroll();
      pendingScrollTimer = setTimeout(() => {
        pendingScrollTimer = null;
        if (isAutoPlaying()) void doScrollIntoView($player.cursor);
      }, SCROLL_BACK_DELAY);
    }
  }

  // Reactive on the three things that determine "are we auto-playing right now":
  // cursor (changed by anything), autoAdvance (toggled), isPlaying (play/pause).
  $: void scheduleScrollIntoView($player.cursor, $player.autoAdvance, $player.isPlaying);

  function scheduleScrollIntoView(
    cursor: number,
    _autoAdvance: boolean,
    _isPlaying: boolean
  ) {
    clearPendingScroll();
    // One-shot: user just tapped a card to play it — center that card once,
    // immediately, ignoring auto-play state. After this single scroll the
    // flag is cleared and any further scroll-back is gated by the normal
    // auto-play rule below.
    if (oneShotScrollNext) {
      oneShotScrollNext = false;
      void doScrollIntoView(cursor);
      return;
    }
    // Auto-scroll only fires during genuine auto-play (autoAdvance ON AND
    // currently playing). Every other transition — manual tap on a card,
    // ▶/⏸/⏪/⏩, keyboard, mode change, pause, autoAdvance OFF — leaves the
    // user's scroll position alone.
    if (!isAutoPlaying()) return;
    const elapsed = Date.now() - lastUserScrollAt;
    if (elapsed >= SCROLL_BACK_DELAY) {
      void doScrollIntoView(cursor);
    } else {
      // User was recently interacting — wait out the remaining quiet time;
      // re-check the auto-play condition when timer fires.
      pendingScrollTimer = setTimeout(() => {
        pendingScrollTimer = null;
        if (isAutoPlaying()) void doScrollIntoView($player.cursor);
      }, SCROLL_BACK_DELAY - elapsed);
    }
  }

  async function doScrollIntoView(cursor: number) {
    await tick();
    const el = cardEls[cursor];
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // Keyboard shortcuts
  function onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowLeft') {
      prev();
    } else if (e.key === 'ArrowRight') {
      next();
    } else if (e.key === '[') {
      cycleSpeed();
    } else if (e.key === ']') {
      cycleSpeed();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', onKey);
    clearPendingScroll();
    // Leave player state in the store but pause playback when navigating away.
    pause();
  });
</script>

<section class="flex-1 flex flex-col overflow-hidden">
  {#if loading}
    <p class="px-4 pt-4 text-ink-muted text-sm">載入中…</p>
  {:else if error}
    <div class="px-4 pt-4">
      <p class="text-red-700 text-sm">{error}</p>
      <button
        type="button"
        class="mt-3 px-4 py-2 rounded-pill bg-accent text-bg-card text-sm"
        on:click={() => goto('/learn')}
      >
        返回表單列表
      </button>
    </div>
  {:else if listMeta}
    <TopBar
      list={listMeta}
      mode={$player.mode}
      onOpenModePicker={openModePicker}
      onPrint={handlePrint}
      onManage={listMeta.builtin ? null : openManage}
    />

    <!-- svelte-ignore a11y_no_static_element_interactions — wheel/touchmove are gesture detection for the scroll-back debouncer, not new interactions -->
    <ul
      bind:this={listEl}
      class="flex-1 overflow-y-auto px-4 pt-3 pb-2 flex flex-col gap-2.5"
      on:wheel={onUserScrollGesture}
      on:touchmove={onUserScrollGesture}
    >
      {#each $player.playSeq as cardIdx, cursor (cursor)}
        {@const c = $player.cards[cardIdx]}
        {#if c}
          {@const isCurrent = cursor === $player.cursor}
          <li bind:this={cardEls[cursor]}>
            <!--
              The whole <article> is the click target so any tap on the card
              — including the bottom-right row to the left of the chevron, the
              padding around content, badge, hanji/loma, 義項 / mandarin —
              triggers gotoIndex + play. We can't use a real <button> wrapper
              because the chevron + edit-× are themselves <button>s (nested
              interactive content is invalid HTML), so we use article + click
              handler + role="button"; chevron / × stay outside the click bubble
              via on:click|stopPropagation.
            -->
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus a11y_no_noninteractive_element_to_interactive_role -->
            <article
              role="button"
              tabindex="-1"
              on:click={() => tapCardToPlay(cursor)}
              class="bg-bg-card rounded-card px-4 py-4 border border-ink/5 relative cursor-pointer
                     transition-all duration-200 ease-out
                     {isCurrent
                       ? '-translate-y-1 scale-[1.02] shadow-[-22px_26px_38px_0_rgba(0,0,0,0.32)] z-10'
                       : 'shadow-sm'}"
            >
              {#if c.kind === 'entry'}
                <span
                  class="inline-block bg-accent text-bg-card text-xs font-semibold px-2.5 py-0.5 rounded-pill mb-2"
                  >詞條</span
                >
                <div class="text-2xl font-han font-semibold text-ink leading-tight">
                  {c.entry.hanji}
                </div>
                <div class="loma text-base text-accent-deep mt-0.5 break-words">
                  {c.entry.loma}
                </div>
                {#if c.entry.meanings.length}
                  <ol class="mt-2 grid gap-1 text-sm text-ink-soft">
                    {#each c.entry.meanings as m, i (i)}
                      <li class="flex gap-1.5">
                        <span class="text-accent-deep font-semibold shrink-0">{i + 1}.</span>
                        <span>{m.definition}</span>
                      </li>
                    {/each}
                  </ol>
                {/if}
              {:else}
                <!-- example card -->
                <span
                  class="inline-block bg-accent-deep text-bg-card text-xs font-semibold px-2.5 py-0.5 rounded-pill mb-2"
                  >例句</span
                >
                <div class="font-han text-ink leading-snug">{c.example.hanji}</div>
                <div class="loma text-sm text-accent-deep mt-0.5 break-words">
                  {c.example.loma}
                </div>
                {#if c.example.mandarin}
                  <div class="text-sm text-ink-muted mt-0.5">{c.example.mandarin}</div>
                {/if}
              {/if}

              <div class="flex justify-end mt-3">
                <button
                  type="button"
                  class="grid place-items-center w-7 h-7 rounded-full bg-accent text-bg-card active:scale-95 transition"
                  aria-label="詳情"
                  on:click|stopPropagation={() =>
                    goto(`/entry/${c.kind === 'entry' ? c.entry.id : c.source.id}`)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </button>
              </div>

              {#if editMode && c.kind === 'entry'}
                <button
                  type="button"
                  class="absolute right-3 top-3 grid place-items-center w-7 h-7 rounded-full
                         bg-red-100 text-red-700 border border-red-200 active:scale-90 transition"
                  aria-label="移除此詞條"
                  on:click|stopPropagation={() => removeEntry(c.entry.id)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
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
            </article>
          </li>
        {/if}
      {/each}
    </ul>

    {#if editMode}
      <!-- Edit-mode bar: replaces PlayerBar as the section's last child while
           editMode is on. Natural in-flow flex child → sits directly above TabBar. -->
      <div
        class="no-print z-10 px-4 py-3 bg-bg/95 backdrop-blur-md border-t border-ink/10 flex gap-3 items-center justify-between"
      >
        <span class="text-sm text-ink-muted">編輯模式：點 × 移除詞條</span>
        <button
          type="button"
          class="px-5 py-2 rounded-pill bg-accent text-bg-card text-sm font-semibold active:scale-95 transition"
          on:click={() => (editMode = false)}
        >
          完成
        </button>
      </div>
    {:else}
      <PlayerBar />
    {/if}

    <!-- Manage modal — bottom sheet for user-created lists only. -->
    {#if showManageModal && listMeta && !listMeta.builtin}
      <div
        class="no-print fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm flex items-end"
        on:click|self={() => (showManageModal = false)}
        on:keydown={(e) => e.key === 'Escape' && (showManageModal = false)}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
      >
        <div
          class="w-full bg-bg-card rounded-t-card border-t border-ink/10 p-4 pb-6 shadow-2xl"
          style="padding-bottom: calc(1.5rem + var(--safe-bottom));"
        >
          <div class="flex items-baseline justify-between mb-3">
            <div class="text-base font-han font-semibold text-ink truncate">{listMeta.name}</div>
            <button
              type="button"
              class="text-sm text-ink-muted px-2 py-1"
              on:click={() => (showManageModal = false)}>取消</button
            >
          </div>
          <ul class="grid gap-1.5">
            <li>
              <button
                type="button"
                class="w-full flex items-center gap-3 px-3 py-3 rounded-card hover:bg-bg-deep transition text-left"
                on:click={actionRename}
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
                  class="text-ink-soft"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span class="flex-1">
                  <span class="block text-sm font-medium text-ink">重新命名</span>
                  <span class="block text-xs text-ink-muted">改這張單字表的名字</span>
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                class="w-full flex items-center gap-3 px-3 py-3 rounded-card hover:bg-bg-deep transition text-left"
                on:click={actionEnterEdit}
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
                  class="text-ink-soft"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                <span class="flex-1">
                  <span class="block text-sm font-medium text-ink">移除詞條</span>
                  <span class="block text-xs text-ink-muted">進入編輯模式，逐張按 × 移除</span>
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                class="w-full flex items-center gap-3 px-3 py-3 rounded-card hover:bg-red-50 transition text-left"
                on:click={actionDelete}
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
                  class="text-red-600"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
                <span class="flex-1">
                  <span class="block text-sm font-medium text-red-700">刪除這張單字表</span>
                  <span class="block text-xs text-ink-muted">無法復原</span>
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    {/if}

    <!-- Mode picker — bottom sheet showing the three display modes. -->
    {#if showModeSheet}
      <div
        class="no-print fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm flex items-end"
        on:click|self={() => (showModeSheet = false)}
        on:keydown={(e) => e.key === 'Escape' && (showModeSheet = false)}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
      >
        <div
          class="w-full bg-bg-card rounded-t-card border-t border-ink/10 p-4 pb-6 shadow-2xl"
          style="padding-bottom: calc(1.5rem + var(--safe-bottom));"
        >
          <div class="flex items-baseline justify-between mb-3">
            <div class="text-base font-han font-semibold text-ink">顯示模式</div>
            <button
              type="button"
              class="text-sm text-ink-muted px-2 py-1"
              on:click={() => (showModeSheet = false)}>取消</button
            >
          </div>
          <ul class="grid gap-1.5">
            {#each MODE_OPTIONS as opt (opt.mode)}
              {@const selected = $player.mode === opt.mode}
              <li>
                <button
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-3 rounded-card transition text-left
                         {selected ? 'bg-accent-tint' : 'hover:bg-bg-deep'}"
                  on:click={() => pickMode(opt.mode)}
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
                  <span class="flex-1">
                    <span
                      class="block text-sm font-medium
                             {selected ? 'text-accent-deep' : 'text-ink'}">{opt.label}</span
                    >
                    <span class="block text-xs text-ink-muted">{opt.hint}</span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      </div>
    {/if}

    <!-- Print-only block — hidden in normal view; shown by @media print below. -->
    <div class="print-only" aria-hidden="true">
      <article class="print-doc">
        <header class="print-header">
          <h1>{listMeta.name}</h1>
          <p>{listMeta.count.toLocaleString()} 詞條</p>
        </header>
        <ol class="print-list">
          <!--
            Key by idx, NOT e.id — the same dictionary entry can legitimately
            appear twice in $player.entries (great700 Section C cases where two
            PDF rows map to the same entry_id, e.g. 「下 ē」 #063 + #064 →
            entry 167). Keying by e.id would crash svelte with a duplicate-key
            fatal error and the whole page would refuse to render.
          -->
          {#each $player.entries as e, idx (idx)}
            {@const exs = e.examples}
            <li class="print-entry">
              <div class="print-entry-head">
                <span class="print-idx">{idx + 1}</span>
                <div class="print-entry-words">
                  <div class="print-hanji">{e.hanji}</div>
                  <div class="print-loma">{e.loma}</div>
                </div>
              </div>
              {#if e.meanings.length}
                <ol class="print-meanings">
                  {#each e.meanings as m, i (m.meaning_id)}
                    {@const meaningExs = exs.filter((x) => x.meaning_id === m.meaning_id)}
                    <li class="print-meaning">
                      <div class="print-meaning-line">
                        <span class="print-meaning-idx">{i + 1}.</span>
                        {#if m.pos}<span class="print-pos">{m.pos}</span>{/if}
                        <span class="print-def">{m.definition}</span>
                      </div>
                      {#if meaningExs.length}
                        <ul class="print-examples">
                          {#each meaningExs as ex (ex.seq)}
                            <li>
                              <div class="print-ex-hanji">{ex.hanji}</div>
                              <div class="print-ex-loma">{ex.loma}</div>
                              {#if ex.mandarin}<div class="print-ex-mand">{ex.mandarin}</div>{/if}
                            </li>
                          {/each}
                        </ul>
                      {/if}
                    </li>
                  {/each}
                </ol>
              {/if}
            </li>
          {/each}
        </ol>
      </article>
    </div>
  {/if}
</section>

<style>
  /* The print block is hidden on screen; only the printed document sees it. */
  .print-only {
    display: none;
  }

  @media print {
    @page {
      size: A4;
      margin: 14mm 12mm;
      /* Page number in bottom-right, grey. CSS Paged Media Module Level 3
         margin-boxes — works in Firefox & Safari. Chromium-based browsers
         (Chrome, Edge) don't implement these margin-boxes; users on Chrome
         need to enable "Headers and footers" in the print dialog to get
         the built-in page numbers (also bottom-right by default). */
      @bottom-right {
        content: counter(page);
        font-family: 'Noto Sans TC', 'PingFang TC', system-ui, sans-serif;
        font-size: 9pt;
        color: #bbb;
      }
    }
    :global(html),
    :global(body) {
      background: white !important;
      height: auto !important;
      overflow: visible !important;
    }
    /* Hide the live UI shell — TopBar, card list, PlayerBar, TabBar all wear .no-print. */
    :global(.no-print),
    :global(ul.flex-1) {
      display: none !important;
    }
    /* Make sure ancestors don't clip the long flowing print-only document. */
    :global(main),
    :global(section.flex-1) {
      overflow: visible !important;
      height: auto !important;
      display: block !important;
    }
    .print-only {
      display: block !important;
      color: black;
      font-family:
        'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', system-ui, sans-serif;
    }
    .print-doc {
      max-width: 100%;
    }
    .print-header {
      border-bottom: 2px solid #247E4D;
      padding-bottom: 8pt;
      margin-bottom: 12pt;
    }
    .print-header h1 {
      font-size: 18pt;
      font-weight: 700;
      margin: 0;
    }
    .print-header p {
      font-size: 10pt;
      color: #555;
      margin: 4pt 0 0 0;
    }
    .print-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .print-entry {
      /* NO page-break-inside:avoid here — the whole entry can break across
         pages. Big entries (like 「仔」 with 14 meanings + 23 examples)
         simply can't fit on one page; if we forbade splitting them, the
         browser would push the entire entry to the next page and leave
         the previous page mostly blank. Atomic protection is applied at
         the three smaller-unit levels below (.print-entry-head with
         break-after:avoid → keeps head with first meaning; .print-meaning-line
         and .print-examples > li with break-inside:avoid). */
      margin-bottom: 24pt;
    }
    .print-entry-head {
      display: flex;
      gap: 8pt;
      /* Align number to the top of the hanji line, not its baseline,
         so it sits in the upper-left of the entry block. */
      align-items: flex-start;
      /* 單元類一 (head + first meaning) — keep them together: tell the
         browser not to break right after the head, so the first
         .print-meaning-line on the next sibling sticks with it. */
      page-break-after: avoid;
      break-after: avoid;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .print-idx {
      color: #c0c0c0;
      font-size: 9pt;
      min-width: 22pt;
      text-align: right;
      line-height: 1;
      /* Nudge slightly upward so it visually sits "above" the hanji top. */
      margin-top: -1pt;
    }
    .print-entry-words {
      display: flex;
      flex-direction: column;
      gap: 1pt;
    }
    .print-hanji {
      font-size: 16pt;
      font-weight: 700;
      line-height: 1.15;
    }
    .print-loma {
      font-size: 10pt;
      color: #247E4D;
      line-height: 1.15;
    }
    .print-meanings {
      list-style: none;
      padding-left: 30pt;
      margin: 5pt 0 0 0;
    }
    .print-meaning {
      margin: 4pt 0;
      /* NO page-break-inside:avoid — a meaning + its examples CAN break
         across pages. Atomic protection is at the line level / example
         level below. */
    }
    .print-meaning-line {
      font-size: 11pt;
      /* 單元類二 — each meaning line (number + pos + definition) is one
         atomic unit; never break inside it. */
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .print-meaning-idx {
      color: #247E4D;
      font-weight: 600;
      margin-right: 2pt;
    }
    .print-pos {
      display: inline-block;
      font-size: 8.5pt;
      color: #444;
      background: #f0f0f0;
      border-radius: 3pt;
      padding: 0 4pt;
      margin: 0 4pt 0 0;
      vertical-align: 1pt;
    }
    .print-def {
      color: #111;
    }
    .print-examples {
      list-style: none;
      padding-left: 14pt;
      margin: 3pt 0 0 0;
    }
    .print-examples li {
      border-left: 2pt solid #C9ECD7;
      padding-left: 6pt;
      margin: 3pt 0;
      /* 單元類三 — each example (hanji + loma + mandarin translation) is
         one atomic unit; never break inside an example. */
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .print-ex-hanji {
      font-size: 10pt;
      font-weight: 500;
    }
    .print-ex-loma {
      font-size: 9pt;
      color: #247E4D;
    }
    .print-ex-mand {
      font-size: 9pt;
      color: #666;
    }
  }
</style>
