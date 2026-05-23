<script lang="ts">
  import { goto } from '$app/navigation';
  import type { DictList } from '$lib/types';

  export let list: DictList;

  // Two entry modes:
  //   - Tap card body (anywhere except the ▶ button): open the list, do NOT autoplay
  //   - Tap the ▶ button on the right: open the list AND start playing the first card
  function openOnly() {
    goto(`/learn/${encodeURIComponent(list.id)}`);
  }
  function openAndPlay() {
    goto(`/learn/${encodeURIComponent(list.id)}?autoplay=1`);
  }
</script>

<!--
  Card body is a div (not <button>) because the play button nested inside would
  be invalid HTML (button-in-button). We give it role="button" + tabindex + the
  click handler; the play button uses on:click|stopPropagation so taps on it
  don't bubble up to the card-body handler.
-->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_to_interactive_role a11y_interactive_supports_focus -->
<div
  role="button"
  tabindex="-1"
  on:click={openOnly}
  class="block w-full text-left bg-bg-card rounded-card px-4 py-3.5 border border-ink/5 shadow-sm
         active:scale-[0.98] transition cursor-pointer"
>
  <div class="flex items-center justify-between gap-3">
    <div class="min-w-0 flex-1">
      <div class="font-han font-semibold text-ink leading-tight truncate">{list.name}</div>
      <div class="text-xs text-ink-muted mt-0.5">{list.count.toLocaleString()} 詞條</div>
    </div>
    <button
      type="button"
      on:click|stopPropagation={openAndPlay}
      aria-label="開啟並開始播放"
      class="grid place-items-center w-9 h-9 rounded-full bg-accent text-bg-card shrink-0
             active:scale-95 transition"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <polygon points="6 4 20 12 6 20" />
      </svg>
    </button>
  </div>
</div>
