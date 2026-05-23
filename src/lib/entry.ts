import { queryAll, queryOne } from './db';
import type { AltPronunciation, Entry, EntryDetail, Example, Meaning } from './types';

export async function getEntry(id: number): Promise<EntryDetail | null> {
  const entry = await queryOne<Entry>(
    'SELECT id, type, hanji, loma, category, audio_file, loma_norm FROM entries WHERE id = ?',
    [id]
  );
  if (!entry) return null;

  const meanings = await queryAll<Meaning>(
    'SELECT entry_id, meaning_id, pos, definition FROM meanings WHERE entry_id = ? ORDER BY meaning_id ASC',
    [id]
  );

  const examples = await queryAll<Example>(
    'SELECT entry_id, meaning_id, seq, hanji, loma, mandarin, audio_file FROM examples WHERE entry_id = ? ORDER BY meaning_id, seq',
    [id]
  );

  const alt = await queryAll<AltPronunciation>(
    'SELECT entry_id, kind, hanji, loma FROM alt_pronunciations WHERE entry_id = ?',
    [id]
  );

  const cats = await queryAll<{ category: string }>(
    'SELECT category FROM entry_categories WHERE entry_id = ? ORDER BY category',
    [id]
  );

  return {
    entry,
    meanings,
    examples,
    alt,
    categories: cats.map((c) => c.category)
  };
}
