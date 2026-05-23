/**
 * SQLite-backed dictionary loaded on the client via the official
 * @sqlite.org/sqlite-wasm package (FTS5 included).
 *
 * The .db file is fetched once, deserialized into an in-memory database
 * (no OPFS — keeps things simple and works without COOP/COEP headers),
 * then queried via the oo1 API.
 */

import { browser } from '$app/environment';
import sqlite3InitModule, {
  type Database,
  type Sqlite3Static
} from '@sqlite.org/sqlite-wasm';

import type * as SqlJs from '@sqlite.org/sqlite-wasm';

const DB_URL = '/dict/dictionary.db';

let _sqlite3Promise: Promise<Sqlite3Static> | null = null;
let _dbPromise: Promise<Database> | null = null;

function getSqlite3(): Promise<Sqlite3Static> {
  if (!_sqlite3Promise) {
    // sqlite3InitModule's TS signature is `()` but the runtime accepts an options object;
    // we silence the type check rather than redeclare the module.
    const init = sqlite3InitModule as unknown as (
      opts: { print: (msg: string) => void; printErr: (msg: string) => void }
    ) => Promise<SqlJs.Sqlite3Static>;
    _sqlite3Promise = init({
      print: () => {},
      printErr: (msg: string) => console.error('[sqlite]', msg)
    });
  }
  return _sqlite3Promise;
}

export function getDb(): Promise<Database> {
  if (!browser) {
    return Promise.reject(new Error('SQLite is browser-only'));
  }
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const sqlite3 = await getSqlite3();
      const buf = await fetch(DB_URL).then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch ${DB_URL}: ${r.status}`);
        return r.arrayBuffer();
      });
      const bytes = new Uint8Array(buf);
      const db = new sqlite3.oo1.DB();
      // Push the file bytes into the in-memory DB.
      const ptr = sqlite3.wasm.allocFromTypedArray(bytes);
      const rc = sqlite3.capi.sqlite3_deserialize(
        db.pointer!,
        'main',
        ptr,
        bytes.byteLength,
        bytes.byteLength,
        // Free the alloc'd buffer when the DB closes; mark read-only so the
        // engine doesn't try to mutate a static dictionary.
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_READONLY
      );
      if (rc) {
        throw new Error(`sqlite3_deserialize failed (rc=${rc})`);
      }
      return db;
    })();
  }
  return _dbPromise;
}

export async function queryAll<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  const db = await getDb();
  const rows = db.exec({
    sql,
    bind: params,
    rowMode: 'object',
    returnValue: 'resultRows'
  });
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T | null> {
  const rows = await queryAll<T>(sql, params);
  return rows[0] ?? null;
}
