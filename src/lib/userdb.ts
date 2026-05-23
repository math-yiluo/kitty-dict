/**
 * IndexedDB persistence for user-created lists, via Dexie.
 * Built-in (category-derived) lists are NOT stored here — they live in SQLite.
 */

import Dexie, { type Table } from 'dexie';

export interface UserList {
  id?: number;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserListEntry {
  id?: number;
  listId: number;
  entryId: number;
  addedAt: number;
}

class UserDB extends Dexie {
  lists!: Table<UserList, number>;
  listEntries!: Table<UserListEntry, number>;

  constructor() {
    super('NaiveDict');

    // v1: original schema with a non-unique compound index on [listId+entryId].
    // Application code (addToUserList) checked existence before insert, but
    // there was no DB-level invariant — race conditions or buggy code paths
    // could in theory create duplicates.
    this.version(1).stores({
      lists: '++id, name, createdAt, updatedAt',
      listEntries: '++id, listId, entryId, addedAt, [listId+entryId]'
    });

    // v2: promote [listId+entryId] to a UNIQUE compound index so the DB itself
    // rejects duplicate (list, entry) pairs. The upgrade step first dedupes
    // any legacy duplicates (keeps the earliest addedAt) so the unique index
    // can be created without conflict.
    this.version(2)
      .stores({
        lists: '++id, name, createdAt, updatedAt',
        listEntries: '++id, listId, entryId, addedAt, &[listId+entryId]'
      })
      .upgrade(async (tx) => {
        const table = tx.table<UserListEntry, number>('listEntries');
        const all = await table.toArray();
        all.sort((a, b) => a.addedAt - b.addedAt); // earliest first → kept
        const seen = new Set<string>();
        const toDelete: number[] = [];
        for (const row of all) {
          const key = `${row.listId}:${row.entryId}`;
          if (seen.has(key)) {
            if (row.id !== undefined) toDelete.push(row.id);
          } else {
            seen.add(key);
          }
        }
        if (toDelete.length) {
          await table.bulkDelete(toDelete);
        }
      });
  }
}

let _db: UserDB | null = null;
export function userDb(): UserDB {
  if (!_db) _db = new UserDB();
  return _db;
}
