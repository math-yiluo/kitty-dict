/**
 * Unified list service — abstracts over user-created lists (Dexie/IndexedDB)
 * and built-in lists (SQLite). Consumers use a single `ListId` and don't need
 * to know where the data lives.
 *
 * ListId format:
 *   "user:<n>"      → entry in Dexie `lists` table, id = n
 *   "cat:<s>"       → all entries WHERE entry_categories.category = s
 *   "great700:<n>"  → entries in great700_entries WHERE list_idx = n (1..7)
 */

import { queryAll, queryOne } from './db';
import { userDb } from './userdb';
import type { DictList, Entry, Example, ListId } from './types';

export interface EntryWithMeanings extends Entry {
  meanings: { meaning_id: number; pos: string | null; definition: string }[];
  /** All example sentences for this entry, sorted by (meaning_id, seq). */
  examples: Example[];
}

interface ParsedId {
  kind: 'user' | 'cat' | 'great700';
  key: string;
}

export function parseListId(id: string): ParsedId {
  const colon = id.indexOf(':');
  if (colon < 0) throw new Error(`Bad list id: ${id}`);
  const kind = id.slice(0, colon);
  if (kind !== 'user' && kind !== 'cat' && kind !== 'great700') {
    throw new Error(`Bad list id kind: ${kind}`);
  }
  return { kind, key: id.slice(colon + 1) };
}

/**
 * Format a great700 list_idx into its display name, e.g. 1 → "001–100".
 * Centralised so the manifest, the UI, and listsContaining() agree.
 */
function great700Name(listIdx: number): string {
  const start = (listIdx - 1) * 100 + 1;
  const end = listIdx * 100;
  return `${String(start).padStart(3, '0')}–${end}`;
}

// ---------- Listings ----------

export async function listUserLists(): Promise<DictList[]> {
  const all = await userDb().lists.orderBy('updatedAt').reverse().toArray();
  const result: DictList[] = [];
  for (const l of all) {
    if (l.id === undefined) continue;
    const count = await userDb().listEntries.where('listId').equals(l.id).count();
    result.push({ id: `user:${l.id}`, name: l.name, builtin: false, count });
  }
  return result;
}

export async function listCategories(): Promise<DictList[]> {
  const rows = await queryAll<{ category: string; n: number }>(
    'SELECT category, n FROM category_summary ORDER BY n DESC'
  );
  return rows.map((r) => ({
    id: `cat:${r.category}` as ListId,
    name: r.category,
    builtin: true,
    count: r.n
  }));
}

/**
 * The seven hard-coded 教育部 700 字 lists (001–100 … 601–700).
 * Pulled from `great700_summary`; ordered by list_idx so the UI grid renders
 * them in PDF order rather than by count.
 */
export async function listGreat700(): Promise<DictList[]> {
  const rows = await queryAll<{ list_idx: number; n: number }>(
    'SELECT list_idx, n FROM great700_summary ORDER BY list_idx'
  );
  return rows.map((r) => ({
    id: `great700:${r.list_idx}` as ListId,
    name: great700Name(r.list_idx),
    builtin: true,
    count: r.n
  }));
}

// ---------- Single list ----------

export async function getList(id: ListId): Promise<DictList | null> {
  const { kind, key } = parseListId(id);
  if (kind === 'user') {
    const numId = Number(key);
    const row = await userDb().lists.get(numId);
    if (!row) return null;
    const count = await userDb().listEntries.where('listId').equals(numId).count();
    return { id, name: row.name, builtin: false, count };
  }
  if (kind === 'great700') {
    const listIdx = Number(key);
    if (!Number.isInteger(listIdx) || listIdx < 1 || listIdx > 7) return null;
    const r = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM great700_entries WHERE list_idx = ?',
      [listIdx]
    );
    if (!r || r.n === 0) return null;
    return { id, name: great700Name(listIdx), builtin: true, count: r.n };
  }
  // kind === 'cat'
  const r = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM entry_categories WHERE category = ?',
    [key]
  );
  if (!r || r.n === 0) return null;
  return { id, name: key, builtin: true, count: r.n };
}

export async function getListEntries(id: ListId): Promise<EntryWithMeanings[]> {
  const { kind, key } = parseListId(id);
  let entries: Entry[];

  if (kind === 'cat') {
    entries = await queryAll<Entry>(
      `SELECT e.id, e.type, e.hanji, e.loma, e.category, e.audio_file, e.loma_norm
         FROM entries e JOIN entry_categories c ON c.entry_id = e.id
         WHERE c.category = ?
         ORDER BY e.loma_norm ASC, e.id ASC`,
      [key]
    );
  } else if (kind === 'great700') {
    // Preserve PDF order: ORDER BY g.seq, NOT by loma. Same entry could
    // appear twice (Section C cases like 「下」#063 #064 → same entry_id),
    // and that's intentional — the list mirrors the PDF 700 字表 row-by-row.
    entries = await queryAll<Entry>(
      `SELECT e.id, e.type, e.hanji, e.loma, e.category, e.audio_file, e.loma_norm
         FROM entries e JOIN great700_entries g ON g.entry_id = e.id
         WHERE g.list_idx = ?
         ORDER BY g.seq ASC`,
      [Number(key)]
    );
  } else {
    const numId = Number(key);
    const links = await userDb().listEntries.where('listId').equals(numId).sortBy('addedAt');
    if (links.length === 0) return [];
    const ids = links.map((l) => l.entryId);
    const placeholders = ids.map(() => '?').join(',');
    const rows = await queryAll<Entry>(
      `SELECT id, type, hanji, loma, category, audio_file, loma_norm
         FROM entries WHERE id IN (${placeholders})`,
      ids
    );
    const byId = new Map(rows.map((e) => [e.id, e]));
    entries = ids.map((eid) => byId.get(eid)).filter((x): x is Entry => Boolean(x));
  }

  if (entries.length === 0) return [];

  // Batch-fetch meanings for the entries we just collected.
  const ids = entries.map((e) => e.id);
  const placeholders = ids.map(() => '?').join(',');
  const meanings = await queryAll<{
    entry_id: number;
    meaning_id: number;
    pos: string | null;
    definition: string;
  }>(
    `SELECT entry_id, meaning_id, pos, definition FROM meanings
       WHERE entry_id IN (${placeholders})
       ORDER BY entry_id, meaning_id`,
    ids
  );

  const meaningsByEntry = new Map<
    number,
    { meaning_id: number; pos: string | null; definition: string }[]
  >();
  for (const m of meanings) {
    const arr = meaningsByEntry.get(m.entry_id) ?? [];
    arr.push({ meaning_id: m.meaning_id, pos: m.pos, definition: m.definition });
    meaningsByEntry.set(m.entry_id, arr);
  }

  // Batch-fetch examples in 500-id chunks (sqlite-wasm prepared statements get
  // sluggish past a few hundred bind params).
  const examplesByEntry = new Map<number, Example[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const ph = chunk.map(() => '?').join(',');
    const rows = await queryAll<Example>(
      `SELECT entry_id, meaning_id, seq, hanji, loma, mandarin, audio_file
         FROM examples WHERE entry_id IN (${ph})
         ORDER BY entry_id, meaning_id, seq`,
      chunk
    );
    for (const ex of rows) {
      const arr = examplesByEntry.get(ex.entry_id) ?? [];
      arr.push(ex);
      examplesByEntry.set(ex.entry_id, arr);
    }
  }

  return entries.map((e) => ({
    ...e,
    meanings: meaningsByEntry.get(e.id) ?? [],
    examples: examplesByEntry.get(e.id) ?? []
  }));
}

// ---------- Mutations (user only) ----------

/**
 * Maximum length (in Unicode code points) for user-created list names.
 * Counted via `[...name].length` so Plane-2 CJK chars (𪜶 等) count as 1,
 * not 2 like `.length` would. Enforced server-side; the UI inputs also
 * carry `maxlength` for instant feedback.
 */
export const MAX_LIST_NAME_LEN = 15;

function validateListName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('表單名稱不可空白');
  if ([...trimmed].length > MAX_LIST_NAME_LEN) {
    throw new Error(`表單名稱不可超過 ${MAX_LIST_NAME_LEN} 字`);
  }
  return trimmed;
}

export async function createUserList(name: string): Promise<ListId> {
  const trimmed = validateListName(name);
  const now = Date.now();
  const id = await userDb().lists.add({ name: trimmed, createdAt: now, updatedAt: now });
  return `user:${id}`;
}

export async function renameUserList(id: ListId, name: string): Promise<void> {
  const { kind, key } = parseListId(id);
  if (kind !== 'user') throw new Error('Cannot rename built-in list');
  const trimmed = validateListName(name);
  await userDb().lists.update(Number(key), { name: trimmed, updatedAt: Date.now() });
}

export async function deleteUserList(id: ListId): Promise<void> {
  const { kind, key } = parseListId(id);
  if (kind !== 'user') throw new Error('Cannot delete built-in list');
  const numId = Number(key);
  await userDb().transaction('rw', userDb().lists, userDb().listEntries, async () => {
    await userDb().listEntries.where('listId').equals(numId).delete();
    await userDb().lists.delete(numId);
  });
}

export async function addToUserList(id: ListId, entryId: number): Promise<void> {
  const { kind, key } = parseListId(id);
  if (kind !== 'user') throw new Error('Cannot edit built-in list');
  const numId = Number(key);
  // Wrap existence-check + insert + bump in a single transaction so two
  // concurrent calls can't both pass the check and create duplicates. As of
  // userdb v2 the `&[listId+entryId]` unique index would catch this too, but
  // belt-and-braces — and we get atomic updatedAt bumping for free.
  await userDb().transaction('rw', userDb().lists, userDb().listEntries, async () => {
    const existing = await userDb()
      .listEntries.where('[listId+entryId]')
      .equals([numId, entryId])
      .first();
    if (existing) return;
    await userDb().listEntries.add({ listId: numId, entryId, addedAt: Date.now() });
    await userDb().lists.update(numId, { updatedAt: Date.now() });
  });
}

export async function removeFromUserList(id: ListId, entryId: number): Promise<void> {
  const { kind, key } = parseListId(id);
  if (kind !== 'user') throw new Error('Cannot edit built-in list');
  const numId = Number(key);
  // Bump updatedAt alongside the delete (mirrors addToUserList) so the list
  // sorts to the top of listUserLists() after a removal, and so any
  // updatedAt-based staleness logic stays correct. Wrapped in a transaction
  // for atomicity.
  await userDb().transaction('rw', userDb().lists, userDb().listEntries, async () => {
    await userDb().listEntries.where('[listId+entryId]').equals([numId, entryId]).delete();
    await userDb().lists.update(numId, { updatedAt: Date.now() });
  });
}

/**
 * Cheap fetch of just the ordered entry-id sequence for a USER list, for
 * cache-staleness detection (SWR revalidation on /learn/[listId]). One
 * indexed Dexie query — far cheaper than getListEntries (which also pulls
 * meanings + examples). Returns [] for non-user (built-in, immutable) lists;
 * callers should skip revalidation for those entirely.
 */
export async function getUserListEntryIds(id: ListId): Promise<number[]> {
  const { kind, key } = parseListId(id);
  if (kind !== 'user') return [];
  const numId = Number(key);
  const links = await userDb().listEntries.where('listId').equals(numId).sortBy('addedAt');
  return links.map((l) => l.entryId);
}

export async function listsContaining(entryId: number): Promise<DictList[]> {
  const userLinks = await userDb().listEntries.where('entryId').equals(entryId).toArray();
  const userListIds = [...new Set(userLinks.map((l) => l.listId))];
  const userRows = await Promise.all(userListIds.map((uid) => userDb().lists.get(uid)));
  const userLists: DictList[] = userRows
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({ id: `user:${r.id}` as ListId, name: r.name, builtin: false, count: 0 }));

  const cats = await queryAll<{ category: string }>(
    'SELECT category FROM entry_categories WHERE entry_id = ? ORDER BY category',
    [entryId]
  );
  const catLists: DictList[] = cats.map((c) => ({
    id: `cat:${c.category}` as ListId,
    name: c.category,
    builtin: true,
    count: 0
  }));

  // The same entry can appear in multiple great700 lists (Section C cases:
  // PDF #063 + #064 both → 「下」 same entry_id, both rows of list 1).
  // Use DISTINCT to dedup so the detail page chip set doesn't show "001–100"
  // twice for that entry.
  const great700Rows = await queryAll<{ list_idx: number }>(
    'SELECT DISTINCT list_idx FROM great700_entries WHERE entry_id = ? ORDER BY list_idx',
    [entryId]
  );
  const great700Lists: DictList[] = great700Rows.map((r) => ({
    id: `great700:${r.list_idx}` as ListId,
    name: great700Name(r.list_idx),
    builtin: true,
    count: 0
  }));

  return [...userLists, ...catLists, ...great700Lists];
}
