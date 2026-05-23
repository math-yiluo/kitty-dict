<script lang="ts">
  import {
    listUserLists,
    createUserList,
    addToUserList,
    removeFromUserList,
    listsContaining
  } from '$lib/lists';
  import type { DictList, ListId } from '$lib/types';

  export let entryId: number;

  let open = false;
  let lists: DictList[] = [];
  let containingIds = new Set<ListId>();
  let loaded = false;
  let newName = '';

  async function refresh() {
    [lists, containingIds] = await Promise.all([
      listUserLists(),
      listsContaining(entryId).then((all) => new Set(all.filter((l) => !l.builtin).map((l) => l.id)))
    ]);
    loaded = true;
  }

  async function toggleList(id: ListId) {
    if (containingIds.has(id)) {
      await removeFromUserList(id, entryId);
    } else {
      await addToUserList(id, entryId);
    }
    await refresh();
  }

  async function createAndAdd(e: Event) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const id = await createUserList(name);
    await addToUserList(id, entryId);
    newName = '';
    await refresh();
  }

  function toggleMenu() {
    open = !open;
    if (open && !loaded) refresh();
  }
</script>

<div class="relative">
  <button
    type="button"
    class="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-pill
           bg-accent text-bg-card active:scale-95 transition"
    on:click={toggleMenu}
    aria-expanded={open}
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
    加入單字表
  </button>

  {#if open}
    <div
      class="absolute right-0 top-full mt-2 w-64 bg-bg-card rounded-card border border-ink/10 shadow-lg z-20 p-3"
    >
      {#if !loaded}
        <p class="text-sm text-ink-muted">載入中…</p>
      {:else}
        {#if lists.length === 0}
          <p class="text-sm text-ink-muted mb-2">你還沒有單字表。</p>
        {:else}
          <ul class="grid gap-1 max-h-56 overflow-y-auto">
            {#each lists as l (l.id)}
              {@const checked = containingIds.has(l.id)}
              <li>
                <button
                  type="button"
                  class="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md
                         hover:bg-bg-deep transition text-sm"
                  on:click={() => toggleList(l.id)}
                >
                  <span
                    class="w-4 h-4 rounded grid place-items-center border
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
                  <span class="font-han truncate">{l.name}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <form on:submit={createAndAdd} class="mt-2 flex gap-1.5">
          <input
            bind:value={newName}
            type="text"
            placeholder="新單字表…"
            maxlength="15"
            class="flex-1 min-w-0 text-sm bg-bg border border-ink/10 rounded-pill px-3 py-1.5
                   focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            class="shrink-0 px-3 py-1.5 rounded-pill bg-accent text-bg-card text-sm font-semibold
                   disabled:opacity-40 active:scale-95 transition"
          >
            ＋
          </button>
        </form>
      {/if}
    </div>
  {/if}
</div>
