/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_CACHE = `app-${version}`;
const AUDIO_CACHE = 'audio-v1';

const APP_SHELL = new Set([
  ...build, // JS / CSS produced by SvelteKit
  // /audio/* is already excluded at build-time via svelte.config.js's
  // kit.serviceWorker.files filter; those mp3s go through AUDIO_CACHE with
  // LRU eviction (see fetch handler below) instead of the always-cached
  // APP_SHELL bucket.
  ...files
]);

// Audio LRU bookkeeping — track URLs in cache order. The cache itself has no
// inherent ordering, so we maintain a parallel list in a single Response.
const LRU_KEY = '/__lru__';
const AUDIO_LRU_MAX = 200;

async function getLru(cache: Cache): Promise<string[]> {
  const resp = await cache.match(LRU_KEY);
  if (!resp) return [];
  try {
    return (await resp.json()) as string[];
  } catch {
    return [];
  }
}

async function setLru(cache: Cache, list: string[]): Promise<void> {
  await cache.put(LRU_KEY, new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }));
}

async function touchAudioLru(cache: Cache, url: string): Promise<void> {
  const lru = await getLru(cache);
  const next = [url, ...lru.filter((u) => u !== url)];
  while (next.length > AUDIO_LRU_MAX) {
    const dropped = next.pop()!;
    await cache.delete(dropped);
  }
  await setLru(cache, next);
}

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      await cache.addAll([...APP_SHELL]);
      await sw.skipWaiting();
    })()
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Reap old caches from previous versions but keep the audio cache.
      const keep = new Set([APP_CACHE, AUDIO_CACHE]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;

  // Audio: cache-first with LRU eviction so we don't fill up disk
  if (url.pathname.startsWith('/audio/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(AUDIO_CACHE);
        const cached = await cache.match(req);
        if (cached) {
          // Update LRU asynchronously so the response isn't delayed
          event.waitUntil(touchAudioLru(cache, req.url));
          return cached;
        }
        const resp = await fetch(req);
        if (resp.ok) {
          cache.put(req, resp.clone()).then(() => touchAudioLru(cache, req.url));
        }
        return resp;
      })()
    );
    return;
  }

  // Everything else (app shell, dictionary.db, static): cache-first, fall back to network
  event.respondWith(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp.ok && resp.type === 'basic') {
          cache.put(req, resp.clone());
        }
        return resp;
      } catch (err) {
        // For navigations, fall back to the SPA index
        if (req.mode === 'navigate') {
          const index = await cache.match('/');
          if (index) return index;
        }
        throw err;
      }
    })()
  );
});
