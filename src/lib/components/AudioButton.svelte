<script lang="ts">
  /**
   * Single-click audio button. Plays the given mp3 URL.
   * Visually a small green pill with a speaker glyph; disabled when no URL.
   */
  export let url: string | null;
  export let label = '播放';
  export let size: 'sm' | 'md' = 'md';

  let audio: HTMLAudioElement | null = null;
  let playing = false;

  async function toggle(e: MouseEvent) {
    e.stopPropagation();
    if (!url) return;
    if (!audio) {
      audio = new Audio(url);
      audio.addEventListener('ended', () => (playing = false));
      audio.addEventListener('pause', () => (playing = false));
    }
    if (playing) {
      audio.pause();
      audio.currentTime = 0;
    } else {
      try {
        await audio.play();
        playing = true;
      } catch {
        playing = false;
      }
    }
  }

  $: dim = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
  $: iconSize = size === 'sm' ? 14 : 18;
</script>

<button
  type="button"
  class="{dim} grid place-items-center rounded-full bg-accent-tint text-accent-deep
         disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition"
  disabled={!url}
  on:click={toggle}
  aria-label={label}
  aria-pressed={playing}
>
  {#if playing}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  {:else}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M11 5L6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4z" />
      <path d="M16.5 12a3.5 3.5 0 0 0-2-3.16v6.32A3.5 3.5 0 0 0 16.5 12z" />
    </svg>
  {/if}
</button>
