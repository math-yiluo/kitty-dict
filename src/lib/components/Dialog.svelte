<script lang="ts">
  import { tick } from 'svelte';
  import { dialogState } from '$lib/dialog';

  let value = '';
  let inputEl: HTMLInputElement | undefined;

  // When a prompt opens, seed the input + focus it.
  $: if ($dialogState?.kind === 'prompt') {
    value = $dialogState.defaultValue ?? '';
    tick().then(() => inputEl?.select());
  }

  function close(result: unknown) {
    const d = $dialogState;
    if (!d) return;
    dialogState.set(null);
    d.resolve(result);
  }

  function onSubmit(e: Event) {
    e.preventDefault();
    const d = $dialogState;
    if (!d) return;
    if (d.kind === 'prompt') {
      const t = value.trim();
      close(t.length === 0 ? null : t);
    } else {
      close(true);
    }
  }

  function onCancel() {
    const d = $dialogState;
    if (!d) return;
    if (d.kind === 'confirm') close(false);
    else close(null);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }
</script>

{#if $dialogState}
  <div
    class="no-print fixed inset-0 z-[60] bg-ink/40 backdrop-blur-sm
           flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:keydown={onKey}
    on:click|self={onCancel}
  >
    <div
      class="bg-bg-card rounded-card max-w-sm w-full p-5 shadow-2xl border border-ink/10
             animate-[fadeUp_120ms_ease-out]"
    >
      {#if $dialogState.title}
        <h2 class="text-base font-han font-semibold text-ink mb-2 break-words">
          {$dialogState.title}
        </h2>
      {/if}
      {#if $dialogState.body}
        <p class="text-sm text-ink-soft mb-4 whitespace-pre-line break-words">
          {$dialogState.body}
        </p>
      {/if}

      <form on:submit={onSubmit}>
        {#if $dialogState.kind === 'prompt'}
          <input
            bind:this={inputEl}
            bind:value
            type="text"
            maxlength={$dialogState.maxLength ?? undefined}
            class="w-full bg-bg border border-ink/15 rounded-pill px-4 py-2.5 text-sm
                   text-ink focus:outline-none focus:ring-2 focus:ring-accent/40
                   focus:border-accent transition mb-4"
          />
        {/if}

        <div class="flex justify-end gap-2">
          {#if $dialogState.kind !== 'alert'}
            <button
              type="button"
              class="px-4 py-2 rounded-pill text-sm font-medium text-ink-muted
                     hover:bg-bg-deep active:scale-95 transition"
              on:click={onCancel}
            >
              {$dialogState.cancelText ?? '取消'}
            </button>
          {/if}
          <button
            type="submit"
            class="px-4 py-2 rounded-pill text-sm font-semibold transition active:scale-95
                   {$dialogState.destructive
                     ? 'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200'
                     : 'bg-accent text-bg-card hover:opacity-90'}"
          >
            {$dialogState.confirmText ??
              ($dialogState.kind === 'confirm'
                ? '確定'
                : $dialogState.kind === 'prompt'
                  ? '確認'
                  : '好')}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  @keyframes fadeUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
