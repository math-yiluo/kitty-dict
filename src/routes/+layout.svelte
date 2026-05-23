<script lang="ts">
  import '../app.css';
  import TabBar from '$lib/components/TabBar.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import { onMount } from 'svelte';

  // Pages where the bottom TabBar should be hidden (e.g. full-screen entry detail).
  // Keep this list intentionally short — the TabBar is the app's primary navigation.
  $: hideTabBar = false;

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/service-worker.js', { scope: '/' })
        .catch((err) => console.warn('[sw] registration failed', err));
    }

    // -------------------------------------------------------------------
    // Android hardware back button (Capacitor only — no-op on web/PWA).
    //
    // Default Capacitor behaviour exits the app on every back press, which
    // is wrong for an SPA with multi-level navigation (search → entry →
    // back should land on search, not kill the app). We override:
    //   - history has back state → window.history.back()
    //   - root of history stack  → App.exitApp()
    //
    // Dynamic import so SSR / web build don't pull in the Capacitor native
    // module (it tree-shakes out on plain web; Capacitor.isNativePlatform
    // also short-circuits any browser preview).
    // -------------------------------------------------------------------
    let cleanup: (() => void) | undefined;
    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('backButton', () => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          App.exitApp();
        }
      });
      cleanup = () => {
        void handle.remove();
      };
    })();
    return () => cleanup?.();
  });
</script>

<div class="h-dvh flex flex-col">
  <main class="flex-1 min-h-0 overflow-hidden flex flex-col" style="padding-top: var(--safe-top);">
    <slot />
  </main>
  {#if !hideTabBar}
    <TabBar />
  {/if}
</div>

<Dialog />
