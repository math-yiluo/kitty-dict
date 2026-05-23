<script lang="ts">
  /**
   * Compact card used in search results and (later) the learning list/player.
   * Layout matches the reference design:
   *   - 詞條 pill badge (top-left)
   *   - large hanji
   *   - accent-coloured loma
   *   - first meaning preview
   *   - chevron on its own row at the bottom-right (not absolute), so the
   *     preview text never gets clipped underneath it
   *
   * The card itself navigates to /entry/[id] when clicked; passing `highlight`
   * makes it the "currently playing" card.
   */
  import { goto } from '$app/navigation';

  export let id: number;
  export let hanji: string;
  export let loma: string;
  export let preview: string | undefined = undefined;
  export let highlight = false;
  export let onClick: (() => void) | null = null;

  function handleClick() {
    if (onClick) onClick();
    else goto(`/entry/${id}`);
  }
</script>

<button
  type="button"
  class="block w-full text-left bg-bg-card rounded-card px-4 py-4 shadow-sm
         border transition
         {highlight ? 'border-accent border-[1.5px] scale-[1.02] shadow-md' : 'border-ink/5'}"
  on:click={handleClick}
>
  <span class="inline-block bg-accent text-bg-card text-xs font-semibold px-2.5 py-0.5 rounded-pill mb-2">
    詞條
  </span>

  <div class="text-2xl font-han font-semibold text-ink leading-tight">{hanji}</div>
  <div class="loma text-base text-accent-deep mt-0.5 break-words">{loma}</div>

  {#if preview}
    <p class="text-sm text-ink-soft mt-1.5 line-clamp-2">{preview}</p>
  {/if}

  <div class="flex justify-end mt-3">
    <span
      class="grid place-items-center w-7 h-7 rounded-full bg-accent text-bg-card"
      aria-hidden="true"
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
    </span>
  </div>
</button>
