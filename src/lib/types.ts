// Core domain types matching the SQLite schema produced by scripts/build_db.py.

export interface Entry {
  id: number;
  type: string | null;
  hanji: string;
  loma: string;
  category: string | null;
  audio_file: string | null;
  loma_norm: string;
}

export interface Meaning {
  entry_id: number;
  meaning_id: number;
  pos: string | null;
  definition: string;
}

export interface Example {
  entry_id: number;
  meaning_id: number;
  seq: number;
  hanji: string;
  loma: string;
  mandarin: string | null;
  audio_file: string | null;
}

export interface AltPronunciation {
  entry_id: number;
  kind: 'alt' | 'coalesce' | 'colloquial';
  hanji: string | null;
  loma: string | null;
}

// Composite shape used in detail pages
export interface EntryDetail {
  entry: Entry;
  meanings: Meaning[];
  examples: Example[];
  alt: AltPronunciation[];
  categories: string[];
}

// Search result shape used by the search page.
export interface SearchHit {
  entry: Entry;
  rank: number; // 1 = exact, 2 = prefix, 3 = entry fts, 4 = meaning, 5 = example
  // First meaning preview for ResultList. Optional, populated when available.
  preview?: string;
}

// Unified list identifier across user-created (Dexie) and built-in lists (SQLite).
//   user:N      — Dexie-backed user lists
//   cat:STR     — built-in category lists (entry_categories table)
//   great700:N  — built-in 教育部 700 字推薦用字 lists (great700_entries table), N = 1..7
export type ListId = `user:${number}` | `cat:${string}` | `great700:${number}`;

// Three viewing modes for /learn/[listId]:
//   word          — only entry cards (default; legacy behaviour)
//   word-sentence — each entry's card is followed by its example cards
//   sentence      — only example cards, grouped by source entry
export type CardMode = 'word' | 'word-sentence' | 'sentence';

export interface DictList {
  id: ListId;
  name: string;
  builtin: boolean;
  count: number;
}
