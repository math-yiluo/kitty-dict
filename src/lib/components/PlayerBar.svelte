<script lang="ts">
  import {
    player,
    toggle,
    prev,
    cycleSpeed,
    toggleShuffle,
    toggleAutoAdvance
  } from '$lib/player';
</script>

<!--
  Natural last flex child of the page's section. Sits directly above the in-flow
  TabBar with no manual offset — section's bottom edge is already at the TabBar's
  top, so PlayerBar's bottom edge lands exactly there.
-->
<div
  class="no-print z-10 px-4 py-3 bg-bg/95 backdrop-blur-md border-t border-ink/10"
>
  <div class="flex items-center justify-between gap-1">
    <!-- Shuffle -->
    <button
      type="button"
      class="w-11 h-11 grid place-items-center rounded-full transition
             {$player.shuffle ? 'text-accent-deep bg-accent-tint' : 'text-ink-muted'}"
      aria-pressed={$player.shuffle}
      aria-label="隨機順序"
      on:click={toggleShuffle}
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
        <polyline points="16 3 21 3 21 8" />
        <line x1="4" y1="20" x2="21" y2="3" />
        <polyline points="21 16 21 21 16 21" />
        <line x1="15" y1="15" x2="21" y2="21" />
        <line x1="4" y1="4" x2="9" y2="9" />
      </svg>
    </button>

    <!-- Prev -->
    <button
      type="button"
      class="w-11 h-11 grid place-items-center rounded-full text-ink hover:bg-bg-deep active:scale-95 transition"
      aria-label="上一個"
      on:click={prev}
      disabled={$player.cursor === 0}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <polygon points="19 5 9 12 19 19" />
        <polygon points="11 5 1 12 11 19" />
      </svg>
    </button>

    <!-- Play / Pause -->
    <button
      type="button"
      class="w-14 h-14 grid place-items-center rounded-full bg-bg-card border border-ink/10
             text-ink hover:bg-accent-tint active:scale-95 transition shadow-sm"
      aria-label={$player.isPlaying ? '暫停' : '播放'}
      aria-pressed={$player.isPlaying}
      on:click={toggle}
    >
      {#if $player.isPlaying}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      {:else}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <polygon points="7 4 21 12 7 20" />
        </svg>
      {/if}
    </button>

    <!-- Auto-advance toggle -->
    <button
      type="button"
      class="px-3 h-11 rounded-pill text-xs font-semibold transition active:scale-95
             {$player.autoAdvance
               ? 'bg-accent text-bg-card'
               : 'bg-bg-card text-ink-muted border border-ink/15'}"
      aria-label="自動播放下一個"
      aria-pressed={$player.autoAdvance}
      title="開啟後音檔播完自動切下一條"
      on:click={toggleAutoAdvance}
    >
      自動
    </button>

    <!-- Speed -->
    <button
      type="button"
      class="px-3 h-11 rounded-pill bg-accent text-bg-card text-sm font-semibold active:scale-95 transition min-w-[3.25rem]"
      aria-label="調整倍速"
      on:click={cycleSpeed}
    >
      {$player.speed % 1 === 0 ? $player.speed.toFixed(1) : $player.speed}x
    </button>
  </div>
</div>
