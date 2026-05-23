<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { getEntry } from '$lib/entry';
  import { entryAudioUrl, exampleAudioUrl } from '$lib/audio';
  import AudioButton from '$lib/components/AudioButton.svelte';
  import AddToListMenu from '$lib/components/AddToListMenu.svelte';
  import type { EntryDetail } from '$lib/types';

  let detail: EntryDetail | null = null;
  let error = '';
  let loading = true;

  $: id = Number($page.params.id);

  onMount(load);
  $: if (id) load();

  async function load() {
    loading = true;
    error = '';
    try {
      detail = await getEntry(id);
      if (!detail) error = '找不到這個詞條';
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  // Group examples by meaning_id for inline display under each meaning.
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
  <header class="px-4 pt-3 pb-2 bg-bg sticky top-0 z-10 flex items-center gap-2 border-b border-ink/5">
    <button
      type="button"
      class="w-9 h-9 grid place-items-center rounded-full hover:bg-bg-deep transition"
      on:click={() => history.back()}
      aria-label="返回"
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
    <h1 class="flex-1 text-base font-semibold text-ink">詞條</h1>
    {#if detail}
      <AddToListMenu entryId={detail.entry.id} />
    {/if}
  </header>

  <div class="flex-1 overflow-y-auto px-4 pb-4">
    {#if loading}
      <p class="text-ink-muted text-sm mt-4">載入中…</p>
    {:else if error}
      <p class="text-red-700 text-sm mt-4">{error}</p>
    {:else if detail}
      <!-- Hero -->
      <section class="mt-3 bg-bg-card rounded-card px-5 py-5 border border-ink/5 shadow-sm">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <div class="text-4xl font-han font-semibold text-ink leading-tight">
              {detail.entry.hanji}
            </div>
            <div class="loma text-xl text-accent-deep mt-1 break-words">{detail.entry.loma}</div>
          </div>
          <AudioButton url={entryAudioUrl(detail.entry.id, detail.entry.audio_file)} size="md" />
        </div>

        {#if detail.entry.type && detail.entry.type !== '主詞目'}
          <div class="mt-3 text-xs text-ink-muted">類型：{detail.entry.type}</div>
        {/if}

        {#if detail.categories.length}
          <div class="mt-3 flex flex-wrap gap-1.5">
            {#each detail.categories as c (c)}
              <button
                type="button"
                class="text-xs text-accent-deep bg-accent-tint rounded-pill px-2.5 py-1
                       hover:bg-accent/30 transition"
                on:click={() => goto(`/learn/${encodeURIComponent('cat:' + c)}`)}
              >
                {c}
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <!-- Alt pronunciations -->
      {#if detail.alt.length}
        <section class="mt-4 bg-bg-card rounded-card px-5 py-4 border border-ink/5 shadow-sm">
          <h2 class="text-sm font-semibold text-accent-deep mb-2">其他唸法</h2>
          <ul class="grid gap-1.5">
            {#each detail.alt as a (a.entry_id + '/' + a.kind + '/' + (a.loma ?? ''))}
              <li class="text-sm text-ink-soft flex items-baseline gap-2">
                <span class="text-xs text-ink-muted">
                  {a.kind === 'alt' ? '又唸作' : a.kind === 'coalesce' ? '合音唸作' : '俗唸作'}
                </span>
                {#if a.hanji}<span class="font-han">{a.hanji}</span>{/if}
                {#if a.loma}<span class="loma text-accent-deep">{a.loma}</span>{/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- Meanings & examples -->
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
                    <AudioButton
                      url={exampleAudioUrl(ex.entry_id, ex.audio_file)}
                      size="sm"
                    />
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
</section>
