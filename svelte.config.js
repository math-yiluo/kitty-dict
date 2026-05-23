import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: false
    }),
    prerender: {
      handleHttpError: 'warn',
      handleUnseenRoutes: 'ignore'
    },
    serviceWorker: {
      // Exclude /audio/* (~28k mp3 paths) from the `files` array injected
      // into the service worker. They're streamed on-demand into AUDIO_CACHE
      // with LRU eviction (see src/service-worker.ts), so listing them in
      // the SW bundle just inflates it (~1.3 MB → ~50 KB) without benefit.
      files: (filepath) => !filepath.startsWith('audio/')
    }
  }
};

export default config;
