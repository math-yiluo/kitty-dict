/**
 * Player store: drives the combined list/play view at /learn/[listId].
 *
 * Conceptual model:
 *   entries[]      — raw source data (each entry carries its own examples[]).
 *   mode           — 'word' | 'word-sentence' | 'sentence'; controls how
 *                    entries+examples are projected into renderable cards.
 *   cards[]        — flat array of renderable cards (entry or example variant),
 *                    in natural source order.
 *   groupStarts[]  — start index of each "group" in cards[]. A group is what
 *                    shuffle treats as one atomic unit:
 *                      mode=word          → one card per group
 *                      mode=word-sentence → entry + its examples per group
 *                      mode=sentence      → same-entry examples per group
 *   playSeq[]      — final playback order: a permutation of cards[] indices.
 *                    Identity when shuffle is off; otherwise group-shuffled.
 *   cursor         — index into playSeq.
 *
 * Current card to play / highlight: cards[playSeq[cursor]].
 *
 * One global HTMLAudioElement is kept alive across navigations within the
 * same list. Switching to a different list resets state. Progress persists
 * to sessionStorage so a refresh resumes mode + cursor.
 *
 * The store deliberately doesn't auto-play on `loadList`: playback always
 * starts from an explicit user gesture (▶ button), which is required by
 * iOS WKWebView for audio to work at all.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { entryAudioUrl, exampleAudioUrl } from './audio';
import type { CardMode, Example, ListId } from './types';
import type { EntryWithMeanings } from './lists';

export type Card =
  | { kind: 'entry'; entry: EntryWithMeanings }
  | { kind: 'example'; example: Example; source: EntryWithMeanings };

export interface PlayerState {
  listId: ListId | null;
  entries: EntryWithMeanings[];
  mode: CardMode;
  cards: Card[];
  groupStarts: number[]; // group boundaries in cards[]
  playSeq: number[]; // indices into cards[] in final play order
  cursor: number; // index into playSeq
  isPlaying: boolean;
  speed: number;
  shuffle: boolean;
  autoAdvance: boolean;
}

export const SPEED_CYCLE = [1.0, 1.25, 1.5, 2.0, 0.5, 0.75] as const;
export const MODES: readonly CardMode[] = ['word', 'word-sentence', 'sentence'];

function blank(): PlayerState {
  return {
    listId: null,
    entries: [],
    mode: 'word',
    cards: [],
    groupStarts: [],
    playSeq: [],
    cursor: 0,
    isPlaying: false,
    speed: 1.0,
    shuffle: false,
    autoAdvance: false
  };
}

export const player = writable<PlayerState>(blank());

let audio: HTMLAudioElement | null = null;
let preloadedUrl: string | null = null;
let preloadEl: HTMLAudioElement | null = null;
let advanceTimer: ReturnType<typeof setTimeout> | null = null;

// ---------- card & sequence builders ----------

function rebuildCards(
  entries: EntryWithMeanings[],
  mode: CardMode
): { cards: Card[]; groupStarts: number[] } {
  const cards: Card[] = [];
  const groupStarts: number[] = [];

  if (mode === 'word') {
    for (const e of entries) {
      groupStarts.push(cards.length);
      cards.push({ kind: 'entry', entry: e });
    }
  } else if (mode === 'word-sentence') {
    for (const e of entries) {
      groupStarts.push(cards.length);
      cards.push({ kind: 'entry', entry: e });
      for (const ex of e.examples) {
        cards.push({ kind: 'example', example: ex, source: e });
      }
    }
  } else {
    // sentence: skip entries with no examples; group = all examples per entry.
    for (const e of entries) {
      if (e.examples.length === 0) continue;
      groupStarts.push(cards.length);
      for (const ex of e.examples) {
        cards.push({ kind: 'example', example: ex, source: e });
      }
    }
  }

  return { cards, groupStarts };
}

function buildPlaySeq(
  cards: Card[],
  groupStarts: number[],
  groupOrder: number[]
): number[] {
  const seq: number[] = new Array(cards.length);
  let writeIdx = 0;
  for (const g of groupOrder) {
    const start = groupStarts[g];
    const end = g + 1 < groupStarts.length ? groupStarts[g + 1] : cards.length;
    for (let i = start; i < end; i++) {
      seq[writeIdx++] = i;
    }
  }
  return seq;
}

function identityGroupOrder(n: number): number[] {
  const o = new Array<number>(n);
  for (let i = 0; i < n; i++) o[i] = i;
  return o;
}

function shuffledGroupOrder(n: number): number[] {
  const o = identityGroupOrder(n);
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}

// ---------- persistence ----------

interface PersistedState {
  cursor: number;
  speed: number;
  shuffle: boolean;
  autoAdvance: boolean;
  mode: CardMode;
  groupOrder: number[];
}

function persistKey(listId: ListId | null): string | null {
  return listId ? `player:${listId}` : null;
}

function persist(state: PlayerState) {
  const k = persistKey(state.listId);
  if (!browser || !k) return;
  try {
    // Reconstruct groupOrder from playSeq: walk playSeq, note the group of each
    // card the first time we see one (group of card i = index in groupStarts
    // such that groupStarts[group] <= i < groupStarts[group+1]).
    const groupOrder = computeGroupOrder(state.playSeq, state.groupStarts);
    const data: PersistedState = {
      cursor: state.cursor,
      speed: state.speed,
      shuffle: state.shuffle,
      autoAdvance: state.autoAdvance,
      mode: state.mode,
      groupOrder
    };
    sessionStorage.setItem(k, JSON.stringify(data));
  } catch {
    // sessionStorage may be unavailable; not fatal.
  }
}

function computeGroupOrder(playSeq: number[], groupStarts: number[]): number[] {
  if (playSeq.length === 0) return [];
  const seen = new Set<number>();
  const order: number[] = [];
  for (const cardIdx of playSeq) {
    // Binary-search group: groupStarts is sorted ascending.
    let lo = 0,
      hi = groupStarts.length - 1,
      g = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (groupStarts[mid] <= cardIdx) {
        g = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (!seen.has(g)) {
      seen.add(g);
      order.push(g);
    }
  }
  return order;
}

function restore(listId: ListId): Partial<PersistedState> | null {
  if (!browser) return null;
  try {
    const raw = sessionStorage.getItem(`player:${listId}`);
    return raw ? (JSON.parse(raw) as Partial<PersistedState>) : null;
  } catch {
    return null;
  }
}

// ---------- audio ----------

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('pause', () => {
      player.update((s) => ({ ...s, isPlaying: false }));
    });
    // 音檔載入失敗(404、網路斷線、檔案損壞) — 對齊 audioFile=null 的處理路徑:
    // 短暫停留後讓 onEnded 處理(autoAdvance 開啟時自動跳下一張、關閉時停止)。
    // 沒這條的話遇到單檔失敗會卡在當前 cursor,需要使用者手動操作才能繼續。
    audio.addEventListener('error', () => {
      clearAdvanceTimer();
      advanceTimer = setTimeout(() => onEnded(), 500);
    });
  }
  return audio;
}

function clearAdvanceTimer() {
  if (advanceTimer) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }
}

function urlForCard(c: Card): string | null {
  if (c.kind === 'entry') {
    return entryAudioUrl(c.entry.id, c.entry.audio_file);
  }
  return exampleAudioUrl(c.example.entry_id, c.example.audio_file);
}

function currentCard(s: PlayerState): Card | null {
  if (s.playSeq.length === 0) return null;
  const idx = s.playSeq[s.cursor];
  return s.cards[idx] ?? null;
}

function urlAt(s: PlayerState, cursor: number): string | null {
  if (cursor < 0 || cursor >= s.playSeq.length) return null;
  const c = s.cards[s.playSeq[cursor]];
  return c ? urlForCard(c) : null;
}

function preloadNext(s: PlayerState) {
  const url = urlAt(s, s.cursor + 1);
  if (!url || url === preloadedUrl) return;
  preloadEl = new Audio();
  preloadEl.preload = 'auto';
  preloadEl.src = url;
  preloadedUrl = url;
}

function onEnded() {
  const s = get(player);
  if (!s.autoAdvance) {
    player.update((cur) => ({ ...cur, isPlaying: false }));
    return;
  }
  if (s.cursor >= s.playSeq.length - 1) {
    player.update((cur) => ({ ...cur, isPlaying: false }));
    return;
  }
  player.update((cur) => ({ ...cur, cursor: cur.cursor + 1 }));
  persist(get(player));
  void playCurrent();
}

async function playCurrent() {
  clearAdvanceTimer();
  const s = get(player);
  const c = currentCard(s);
  if (!c) return;
  const url = urlForCard(c);
  if (!url) {
    player.update((cur) => ({ ...cur, isPlaying: true }));
    advanceTimer = setTimeout(() => onEnded(), 1500);
    return;
  }
  const a = ensureAudio();
  const absolute = new URL(url, location.origin).href;
  if (a.src !== absolute) {
    a.src = url;
  }
  a.playbackRate = s.speed;
  try {
    await a.play();
    player.update((cur) => ({ ...cur, isPlaying: true }));
  } catch {
    player.update((cur) => ({ ...cur, isPlaying: false }));
  }
  preloadNext(get(player));
}

// ---------- wake lock (keep screen on during auto-play) ----------
//
// Hold a screen wake lock iff (isPlaying && autoAdvance) — that is the
// "auto-play" mode where the user expects to put the phone down and listen
// continuously without touching it. The lock is released as soon as either
// playback stops or auto-advance is turned off.
//
// Manual power-button → page becomes hidden → browser auto-releases the lock
// per W3C spec. We don't try to fight that: the user explicitly asked for
// current "manual screen-off stops playback" behavior to remain unchanged.
// When the page returns to foreground while still in auto-play state we
// re-request (the released sentinel isn't automatically renewed).

let wakeLock: WakeLockSentinel | null = null;

async function acquireWakeLock() {
  if (!browser || !('wakeLock' in navigator) || wakeLock) return;
  if (document.visibilityState !== 'visible') return;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    wakeLock = sentinel;
    sentinel.addEventListener('release', () => {
      // Browser may auto-release on tab hide / battery saver — clear our ref
      // so the next acquire attempt will re-request rather than no-op.
      if (wakeLock === sentinel) wakeLock = null;
    });
  } catch {
    // Battery saver / permission denied / page not visible — silently ignore.
  }
}

async function releaseWakeLock() {
  const sentinel = wakeLock;
  wakeLock = null;
  if (sentinel) {
    try {
      await sentinel.release();
    } catch {
      // Already released by browser — fine.
    }
  }
}

if (browser) {
  // Mirror auto-play state into wake lock. Subscribe fires synchronously on
  // register with current state (blank → no-op), then on every player update.
  player.subscribe((s) => {
    if (s.isPlaying && s.autoAdvance) void acquireWakeLock();
    else void releaseWakeLock();
  });
  // When app returns to foreground, the previously-released lock isn't
  // auto-renewed — re-request if we're still in auto-play mode.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const s = get(player);
    if (s.isPlaying && s.autoAdvance && !wakeLock) void acquireWakeLock();
  });
}

// ---------- public API ----------

export function loadList(listId: ListId, entries: EntryWithMeanings[]) {
  const cur = get(player);
  if (cur.listId === listId && cur.entries.length === entries.length) {
    // Same list reload — keep player state in place.
    return;
  }
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  clearAdvanceTimer();
  preloadEl = null;
  preloadedUrl = null;

  const saved = restore(listId);
  const mode: CardMode = saved?.mode && MODES.includes(saved.mode) ? saved.mode : 'word';
  const { cards, groupStarts } = rebuildCards(entries, mode);

  // Restore group order if it matches the new group count; otherwise identity.
  let groupOrder: number[];
  if (
    saved?.groupOrder &&
    saved.groupOrder.length === groupStarts.length &&
    saved.groupOrder.every((g) => Number.isInteger(g) && g >= 0 && g < groupStarts.length)
  ) {
    groupOrder = saved.groupOrder;
  } else {
    groupOrder = identityGroupOrder(groupStarts.length);
  }
  const playSeq = buildPlaySeq(cards, groupStarts, groupOrder);

  player.set({
    listId,
    entries,
    mode,
    cards,
    groupStarts,
    playSeq,
    cursor: Math.min(Math.max(saved?.cursor ?? 0, 0), Math.max(0, playSeq.length - 1)),
    isPlaying: false,
    speed: saved?.speed ?? 1.0,
    shuffle: Boolean(saved?.shuffle),
    autoAdvance: Boolean(saved?.autoAdvance)
  });
}

export function setMode(mode: CardMode) {
  player.update((s) => {
    if (s.mode === mode) return s;
    const { cards, groupStarts } = rebuildCards(s.entries, mode);
    const groupOrder = s.shuffle
      ? shuffledGroupOrder(groupStarts.length)
      : identityGroupOrder(groupStarts.length);
    const playSeq = buildPlaySeq(cards, groupStarts, groupOrder);
    return {
      ...s,
      mode,
      cards,
      groupStarts,
      playSeq,
      cursor: 0
    };
  });
  persist(get(player));
  if (get(player).isPlaying) void playCurrent();
}

export function play() {
  void playCurrent();
}

export function pause() {
  audio?.pause();
  clearAdvanceTimer();
  player.update((s) => ({ ...s, isPlaying: false }));
}

export function toggle() {
  const s = get(player);
  if (s.isPlaying) pause();
  else play();
}

export function next() {
  const s = get(player);
  if (s.cursor >= s.playSeq.length - 1) return;
  player.update((cur) => ({ ...cur, cursor: cur.cursor + 1 }));
  persist(get(player));
  if (get(player).isPlaying) void playCurrent();
}

export function prev() {
  const s = get(player);
  if (s.cursor <= 0) return;
  player.update((cur) => ({ ...cur, cursor: cur.cursor - 1 }));
  persist(get(player));
  if (get(player).isPlaying) void playCurrent();
}

export function gotoIndex(playCursor: number) {
  player.update((s) => ({
    ...s,
    cursor: Math.max(0, Math.min(playCursor, Math.max(0, s.playSeq.length - 1)))
  }));
  persist(get(player));
  void playCurrent();
}

export function cycleSpeed() {
  player.update((s) => {
    const idx = SPEED_CYCLE.indexOf(s.speed as (typeof SPEED_CYCLE)[number]);
    const nextSpeed = SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length];
    if (audio) audio.playbackRate = nextSpeed;
    return { ...s, speed: nextSpeed };
  });
  persist(get(player));
}

export function toggleShuffle() {
  // Cursor jumps to top on either flip. Group-aware: shuffle moves entire
  // groups, never breaks an entry+examples bundle apart.
  player.update((s) => {
    const willShuffle = !s.shuffle;
    const groupOrder = willShuffle
      ? shuffledGroupOrder(s.groupStarts.length)
      : identityGroupOrder(s.groupStarts.length);
    const playSeq = buildPlaySeq(s.cards, s.groupStarts, groupOrder);
    return { ...s, playSeq, cursor: 0, shuffle: willShuffle };
  });
  persist(get(player));
}

export function toggleAutoAdvance() {
  player.update((s) => ({ ...s, autoAdvance: !s.autoAdvance }));
  persist(get(player));
}

/**
 * Remove an entry (and any of its example cards) from the loaded list.
 * Caller is responsible for deleting it from Dexie. Rebuilds cards/playSeq
 * from scratch in current mode; cursor resets to 0 for simplicity.
 */
export function removeFromPlayer(entryId: number) {
  player.update((s) => {
    const newEntries = s.entries.filter((e) => e.id !== entryId);
    if (newEntries.length === s.entries.length) return s; // not found
    const { cards, groupStarts } = rebuildCards(newEntries, s.mode);
    const groupOrder = s.shuffle
      ? shuffledGroupOrder(groupStarts.length)
      : identityGroupOrder(groupStarts.length);
    const playSeq = buildPlaySeq(cards, groupStarts, groupOrder);
    return {
      ...s,
      entries: newEntries,
      cards,
      groupStarts,
      playSeq,
      cursor: 0
    };
  });
  persist(get(player));
}

