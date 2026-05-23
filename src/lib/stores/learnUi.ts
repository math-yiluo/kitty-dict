/**
 * In-memory UI state for the /learn route. Lives at module scope so the
 * selected tab and scroll position survive client-side navigation (clicking
 * into a list → pressing back lands the user on the same tab, scrolled to
 * the same place).
 *
 * Not persisted to localStorage — refreshing the page resets to defaults.
 */

import { writable } from 'svelte/store';

export type LearnTab = 'user' | 'cat' | 'great700' | 'random';

export const learnTab = writable<LearnTab>('user');

/** Scroll position (in px) of the inner /learn scroll container, per tab. */
export const learnScroll = writable<Record<LearnTab, number>>({
  user: 0,
  cat: 0,
  great700: 0,
  random: 0
});
