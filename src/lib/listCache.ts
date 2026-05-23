/**
 * In-memory cache for the most recently-loaded list on /learn/[listId].
 *
 * Why: SvelteKit's scroll restoration runs immediately after navigation
 * completes. When the user navigates back from /entry/[id] to a /learn/[listId]
 * page that does async SQLite queries on mount, the page is initially just
 * "載入中…" (~30px tall), the browser clamps scrollTo(0, savedY) to 0, and by
 * the time the real content fills in, SvelteKit has already given up on
 * restoring scroll position.
 *
 * Solution: cache the most recently-loaded {meta, entries} keyed by list id.
 * On a cache hit, the page can populate state synchronously, so the full
 * content is in the DOM before SvelteKit attempts scroll restoration.
 *
 * Lives in a separate module (not in +page.svelte's `<script module>`) to
 * avoid a circular-dependency edge case in Vite's SSR module loader when a
 * module-level script imports types from `$lib/lists`.
 *
 * Trade-off: if the user mutates this list from elsewhere (e.g., adds an
 * entry via /entry/[id]'s "加入單字表" button), the cache is stale until
 * they navigate to a different list and back. Local mutations on the
 * /learn/[listId] page itself keep the cache in sync via the helpers below.
 */

import type { DictList, ListId } from './types';
import type { EntryWithMeanings } from './lists';

interface ListCacheEntry {
  id: ListId;
  meta: DictList;
  entries: EntryWithMeanings[];
}

let cache: ListCacheEntry | null = null;

export function getCachedList(id: ListId): ListCacheEntry | null {
  return cache && cache.id === id ? cache : null;
}

export function setCachedList(id: ListId, meta: DictList, entries: EntryWithMeanings[]): void {
  cache = { id, meta, entries };
}

export function clearCachedList(id?: ListId): void {
  // Clear only if it matches (when id given), or unconditionally otherwise.
  if (!id || (cache && cache.id === id)) {
    cache = null;
  }
}

/** Patch cache's meta in place (e.g., after rename). No-op if cache miss. */
export function updateCachedListMeta(id: ListId, patch: Partial<DictList>): void {
  if (cache && cache.id === id) {
    cache = { ...cache, meta: { ...cache.meta, ...patch } };
  }
}

/** Drop one entry from cache + decrement meta.count. No-op if cache miss. */
export function dropCachedListEntry(id: ListId, entryId: number): void {
  if (cache && cache.id === id) {
    cache = {
      ...cache,
      meta: { ...cache.meta, count: Math.max(0, cache.meta.count - 1) },
      entries: cache.entries.filter((e) => e.id !== entryId)
    };
  }
}
