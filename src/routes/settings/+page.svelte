<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    downloadBackup,
    parseBackup,
    applyBackup,
    type Backup
  } from '$lib/export';
  import { listUserLists } from '$lib/lists';
  import type { DictList } from '$lib/types';

  let busy = false;
  let message: { kind: 'info' | 'error'; text: string } | null = null;
  let fileInput: HTMLInputElement;

  // ----- Export picker (which user lists to include) -----
  // Source-of-truth on selected set is a Set<ListId> — easy add/remove and
  // simple .size for the confirm button label / disabled state.
  let showExportPicker = false;
  let exportLists: DictList[] = [];
  let exportSelected = new Set<string>();

  async function openExportPicker() {
    busy = true;
    message = null;
    try {
      exportLists = await listUserLists();
      exportSelected = new Set(exportLists.map((l) => l.id));
      showExportPicker = true;
    } catch (err) {
      message = { kind: 'error', text: (err as Error).message };
    } finally {
      busy = false;
    }
  }

  function toggleExportPick(id: string) {
    const next = new Set(exportSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    exportSelected = next;
  }

  function exportSelectAll() {
    exportSelected = new Set(exportLists.map((l) => l.id));
  }

  function exportSelectNone() {
    exportSelected = new Set();
  }

  function cancelExportPicker() {
    showExportPicker = false;
  }

  async function confirmExport() {
    if (exportSelected.size === 0) return;
    busy = true;
    try {
      // user:N → N
      const ids: number[] = [];
      for (const sid of exportSelected) {
        const m = /^user:(\d+)$/.exec(sid);
        if (m) ids.push(Number(m[1]));
      }
      await downloadBackup(ids);
      showExportPicker = false;
      message = { kind: 'info', text: `已匯出 ${ids.length} 張單字表。` };
    } catch (err) {
      message = { kind: 'error', text: (err as Error).message };
    } finally {
      busy = false;
    }
  }

  // ----- Import picker (which lists from the parsed backup to apply) -----
  // We split parse from apply so we can preview list names before writing
  // anything to Dexie. Selection key = list name (the backup payload has no
  // stable id; name is what `applyBackup`'s filter matches on).
  let showImportPicker = false;
  let importBackupObj: Backup | null = null;
  let importSelected = new Set<string>();

  async function onImportPicked(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    busy = true;
    message = null;
    try {
      const text = await f.text();
      const backup = parseBackup(text);
      importBackupObj = backup;
      importSelected = new Set(backup.lists.map((l) => l.name));
      showImportPicker = true;
    } catch (err) {
      message = { kind: 'error', text: (err as Error).message };
    } finally {
      // Always clear the input so picking the same file again re-triggers change.
      if (fileInput) fileInput.value = '';
      busy = false;
    }
  }

  function toggleImportPick(name: string) {
    const next = new Set(importSelected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    importSelected = next;
  }

  function importSelectAll() {
    if (!importBackupObj) return;
    importSelected = new Set(importBackupObj.lists.map((l) => l.name));
  }

  function importSelectNone() {
    importSelected = new Set();
  }

  function cancelImportPicker() {
    showImportPicker = false;
    importBackupObj = null;
  }

  async function confirmImport() {
    if (!importBackupObj || importSelected.size === 0) return;
    busy = true;
    try {
      const result = await applyBackup(importBackupObj, importSelected);
      showImportPicker = false;
      importBackupObj = null;
      message = {
        kind: 'info',
        text: `已匯入 ${result.imported} 張單字表${
          result.renamed ? `（${result.renamed} 張因同名而改名）` : ''
        }。`
      };
    } catch (err) {
      message = { kind: 'error', text: (err as Error).message };
    } finally {
      busy = false;
    }
  }

  // Friendly preview labels for the import-picker rows.
  $: importBackupDate = importBackupObj
    ? new Date(importBackupObj.exportedAt).toLocaleString('zh-Hant')
    : '';
</script>

<section class="flex-1 flex flex-col overflow-hidden">
  <header
    class="px-4 pt-3 pb-2 bg-bg sticky top-0 z-10 flex items-center gap-2 border-b border-ink/5"
  >
    <button
      type="button"
      class="w-9 h-9 grid place-items-center rounded-full hover:bg-bg-deep transition"
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
    <h1 class="text-base font-han font-semibold text-ink">設定</h1>
  </header>

  <div class="flex-1 overflow-y-auto px-4 pt-4 pb-4 grid gap-4">
    {#if message}
      <div
        class="rounded-card border px-4 py-3 text-sm
               {message.kind === 'info'
          ? 'bg-accent-tint border-accent/30 text-accent-deep'
          : 'bg-red-50 border-red-200 text-red-800'}"
      >
        {message.text}
      </div>
    {/if}

    <section class="bg-bg-card rounded-card px-5 py-4 border border-ink/5 shadow-sm">
      <h2 class="font-han font-semibold text-ink mb-1">資料備份</h2>
      <p class="text-sm text-ink-muted mb-3">
        把單字表匯出成 JSON 檔，可以在不同裝置間搬運。匯出 / 匯入時都能勾選要包含哪些表單。
      </p>
      <div class="flex gap-2 flex-wrap">
        <button
          type="button"
          on:click={openExportPicker}
          disabled={busy}
          class="px-4 py-2 rounded-pill bg-accent text-bg-card text-sm font-semibold
                 disabled:opacity-40 active:scale-95 transition"
        >
          匯出 JSON
        </button>
        <label
          class="px-4 py-2 rounded-pill bg-bg-deep text-ink-soft text-sm font-medium
                 cursor-pointer active:scale-95 transition"
          class:opacity-40={busy}
        >
          匯入 JSON
          <input
            bind:this={fileInput}
            type="file"
            accept="application/json,.json"
            class="hidden"
            on:change={onImportPicked}
            disabled={busy}
          />
        </label>
      </div>
    </section>
  </div>
</section>

<!--
  Export picker — bottom sheet listing the user's saved lists.
  Default state: every list checked. The user uncheckes any they don't want,
  then hits "匯出 (N)". For zero-selected, button is disabled.
-->
{#if showExportPicker}
  <div
    class="no-print fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm flex items-end"
    on:click|self={cancelExportPicker}
    on:keydown={(e) => e.key === 'Escape' && cancelExportPicker()}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div
      class="w-full bg-bg-card rounded-t-card border-t border-ink/10 p-4 shadow-2xl
             flex flex-col max-h-[80vh]"
      style="padding-bottom: calc(1.5rem + var(--safe-bottom));"
    >
      <div class="flex items-baseline justify-between mb-2">
        <div class="text-base font-han font-semibold text-ink">選擇要匯出的單字表</div>
        <button
          type="button"
          class="text-sm text-ink-muted px-2 py-1"
          on:click={cancelExportPicker}>取消</button
        >
      </div>

      {#if exportLists.length === 0}
        <p class="text-sm text-ink-muted py-6 text-center">你還沒有單字表。</p>
      {:else}
        <div class="flex gap-2 mb-2 text-xs text-ink-muted">
          <button
            type="button"
            class="px-2 py-1 rounded-pill border border-ink/15 hover:bg-bg-deep transition"
            on:click={exportSelectAll}>全選</button
          >
          <button
            type="button"
            class="px-2 py-1 rounded-pill border border-ink/15 hover:bg-bg-deep transition"
            on:click={exportSelectNone}>全不選</button
          >
        </div>
        <ul class="grid gap-1 overflow-y-auto flex-1">
          {#each exportLists as l (l.id)}
            {@const checked = exportSelected.has(l.id)}
            <li>
              <button
                type="button"
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition text-left
                       {checked ? 'bg-accent-tint' : 'hover:bg-bg-deep'}"
                on:click={() => toggleExportPick(l.id)}
                aria-pressed={checked}
              >
                <span
                  class="w-4 h-4 rounded grid place-items-center border shrink-0
                         {checked
                    ? 'bg-accent border-accent text-bg-card'
                    : 'border-ink/30'}"
                  aria-hidden="true"
                >
                  {#if checked}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  {/if}
                </span>
                <span class="font-han flex-1 min-w-0 truncate text-sm">{l.name}</span>
                <span class="text-xs text-ink-muted shrink-0"
                  >{l.count.toLocaleString()}</span
                >
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="mt-3 flex justify-end gap-2">
        <button
          type="button"
          on:click={confirmExport}
          disabled={exportSelected.size === 0 || busy}
          class="px-4 py-2 rounded-pill bg-accent text-bg-card text-sm font-semibold
                 disabled:opacity-40 active:scale-95 transition"
        >
          {busy ? '處理中…' : `匯出（${exportSelected.size}）`}
        </button>
      </div>
    </div>
  </div>
{/if}

<!--
  Import picker — same shape as export picker but driven by the parsed Backup.
  Shows each list's name + entry count, plus the backup's export timestamp at
  the top so the user can tell which backup file this is.
-->
{#if showImportPicker && importBackupObj}
  <div
    class="no-print fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm flex items-end"
    on:click|self={cancelImportPicker}
    on:keydown={(e) => e.key === 'Escape' && cancelImportPicker()}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div
      class="w-full bg-bg-card rounded-t-card border-t border-ink/10 p-4 shadow-2xl
             flex flex-col max-h-[80vh]"
      style="padding-bottom: calc(1.5rem + var(--safe-bottom));"
    >
      <div class="flex items-baseline justify-between mb-1">
        <div class="text-base font-han font-semibold text-ink">選擇要匯入的單字表</div>
        <button
          type="button"
          class="text-sm text-ink-muted px-2 py-1"
          on:click={cancelImportPicker}>取消</button
        >
      </div>
      <p class="text-xs text-ink-muted mb-2">備份時間：{importBackupDate}</p>

      {#if importBackupObj.lists.length === 0}
        <p class="text-sm text-ink-muted py-6 text-center">這個備份檔沒有任何單字表。</p>
      {:else}
        <div class="flex gap-2 mb-2 text-xs text-ink-muted">
          <button
            type="button"
            class="px-2 py-1 rounded-pill border border-ink/15 hover:bg-bg-deep transition"
            on:click={importSelectAll}>全選</button
          >
          <button
            type="button"
            class="px-2 py-1 rounded-pill border border-ink/15 hover:bg-bg-deep transition"
            on:click={importSelectNone}>全不選</button
          >
        </div>
        <ul class="grid gap-1 overflow-y-auto flex-1">
          {#each importBackupObj.lists as l (l.name)}
            {@const checked = importSelected.has(l.name)}
            <li>
              <button
                type="button"
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition text-left
                       {checked ? 'bg-accent-tint' : 'hover:bg-bg-deep'}"
                on:click={() => toggleImportPick(l.name)}
                aria-pressed={checked}
              >
                <span
                  class="w-4 h-4 rounded grid place-items-center border shrink-0
                         {checked
                    ? 'bg-accent border-accent text-bg-card'
                    : 'border-ink/30'}"
                  aria-hidden="true"
                >
                  {#if checked}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  {/if}
                </span>
                <span class="font-han flex-1 min-w-0 truncate text-sm">{l.name}</span>
                <span class="text-xs text-ink-muted shrink-0"
                  >{l.entryIds.length.toLocaleString()}</span
                >
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="mt-3 flex justify-end gap-2">
        <button
          type="button"
          on:click={confirmImport}
          disabled={importSelected.size === 0 || busy}
          class="px-4 py-2 rounded-pill bg-accent text-bg-card text-sm font-semibold
                 disabled:opacity-40 active:scale-95 transition"
        >
          {busy ? '處理中…' : `匯入（${importSelected.size}）`}
        </button>
      </div>
    </div>
  </div>
{/if}
