import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: {
      // Allow vite to read the sql.js wasm artifact from node_modules
      allow: ['..']
    }
  },
  optimizeDeps: {
    // @sqlite.org/sqlite-wasm bundles its own .wasm via import.meta.url; let
    // Vite see it but don't pre-bundle (esbuild can't follow the wasm import).
    exclude: ['@sqlite.org/sqlite-wasm']
  },
  worker: {
    format: 'es'
  }
});
