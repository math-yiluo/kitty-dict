/**
 * Backup/restore for user-created word lists, plus list-level pick on export
 * and import.
 *
 *   exportBackup(filterIds?)     — build a Backup object (optionally only the
 *                                  selected user-list IDs)
 *   downloadBackup(filterIds?)   — platform-aware output:
 *                                    web    → <a download> blob
 *                                    native → Filesystem.writeFile + Share.share
 *   parseBackup(text)            — parse + validate JSON string → Backup
 *                                  (lets UI preview names before committing)
 *   applyBackup(backup, names?)  — write a parsed Backup into Dexie, optionally
 *                                  only the lists whose name is in `names`
 *   importBackup(text)           — compat: parseBackup + applyBackup all
 */

import { userDb, type UserList, type UserListEntry } from './userdb';

export const BACKUP_VERSION = 1 as const;

export interface ListBackup {
  name: string;
  createdAt: number;
  updatedAt: number;
  entryIds: number[];
}

export interface Backup {
  version: typeof BACKUP_VERSION;
  exportedAt: string; // ISO timestamp
  lists: ListBackup[];
}

// ----- Export -----

/**
 * Build the Backup object. If `filterIds` is provided, only user lists whose
 * Dexie `id` is in that set are included; otherwise all user lists are.
 */
export async function exportBackup(filterIds?: number[]): Promise<Backup> {
  let lists = await userDb().lists.toArray();
  if (filterIds) {
    const allow = new Set(filterIds);
    lists = lists.filter((l) => l.id !== undefined && allow.has(l.id));
  }
  const out: ListBackup[] = [];
  for (const l of lists) {
    const entries = await userDb()
      .listEntries.where('listId')
      .equals(l.id!)
      .sortBy('addedAt');
    out.push({
      name: l.name,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      entryIds: entries.map((e) => e.entryId)
    });
  }
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    lists: out
  };
}

function makeFilename(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `kitty-dict-backup-${stamp}.json`;
}

async function buildBackupBlob(
  filterIds?: number[]
): Promise<{ blob: Blob; filename: string }> {
  const backup = await exportBackup(filterIds);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json'
  });
  return { blob, filename: makeFilename() };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onloadend = () => res((r.result as string).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function downloadBackupWeb(filterIds?: number[]): Promise<void> {
  const { blob, filename } = await buildBackupBlob(filterIds);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke a tick so the download has time to register the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Android (Capacitor WebView) cannot rely on `<a download>` — the WebView
 * either ignores the attribute or renders the JSON inline. So on native we
 * write the file to Documents/ via Filesystem, then hand the file URI to
 * the system share sheet (Drive / Files / Mail / Messages / …).
 */
async function shareBackupNative(filterIds?: number[]): Promise<void> {
  const { blob, filename } = await buildBackupBlob(filterIds);
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const base64 = await blobToBase64(blob);
  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Documents,
    recursive: true
  });
  // `files: [uri]` (not `url:`) so Android treats this as a FILE share —
  // the system share sheet then shows apps that can save / receive a JSON
  // attachment (Drive, Files, Mail, …). With `url:` the OS would treat the
  // payload as a URL string, restricting the sheet to browsers / chat apps
  // with no save option visible — see the matching comment in handlePrint
  // for the PDF export path.
  await Share.share({
    title: filename.replace(/\.json$/, ''),
    files: [written.uri],
    dialogTitle: '匯出 / 分享 JSON'
  });
}

/**
 * Public entry point for "export JSON". Dispatches to the right output channel
 * for the current platform.
 *   - Web: blob → <a download> → browser saves to Downloads/
 *   - Native (Capacitor): Filesystem.writeFile + Share.share → user picks destination
 */
export async function downloadBackup(filterIds?: number[]): Promise<void> {
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    await shareBackupNative(filterIds);
  } else {
    await downloadBackupWeb(filterIds);
  }
}

// ----- Import -----

export interface ImportResult {
  imported: number;
  renamed: number; // lists that already existed and got a (N) suffix
}

function isBackup(v: unknown): v is Backup {
  if (!v || typeof v !== 'object') return false;
  const b = v as Backup;
  return (
    b.version === BACKUP_VERSION && Array.isArray(b.lists) && typeof b.exportedAt === 'string'
  );
}

/**
 * Parse + validate a backup JSON string without applying it. Lets the UI show
 * a preview (list names) and let the user pick which lists to import.
 * Throws on malformed JSON or wrong shape/version.
 */
export function parseBackup(text: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('檔案不是有效的 JSON');
  }
  if (!isBackup(parsed)) {
    throw new Error('檔案格式不對或版本不相容');
  }
  return parsed;
}

/**
 * Write a (pre-parsed) Backup into Dexie. If `selectedNames` is given, only
 * lists whose `name` is in that set are imported; otherwise all are imported.
 * Lists whose name collides with an existing local list are renamed with a
 * " (N)" suffix.
 */
export async function applyBackup(
  backup: Backup,
  selectedNames?: Set<string>
): Promise<ImportResult> {
  const existing = await userDb().lists.toArray();
  const existingNames = new Set(existing.map((l) => l.name));

  const sourceLists = selectedNames
    ? backup.lists.filter((l) => selectedNames.has(l.name))
    : backup.lists;

  let imported = 0;
  let renamed = 0;

  for (const l of sourceLists) {
    let name = l.name;
    if (existingNames.has(name)) {
      let i = 2;
      while (existingNames.has(`${l.name} (${i})`)) i++;
      name = `${l.name} (${i})`;
      renamed++;
    }
    existingNames.add(name);

    const newId = await userDb().lists.add({
      name,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt
    } satisfies UserList);

    const toInsert: UserListEntry[] = l.entryIds.map((eid, i) => ({
      listId: newId as number,
      entryId: eid,
      addedAt: l.createdAt + i // preserve relative order
    }));
    if (toInsert.length) await userDb().listEntries.bulkAdd(toInsert);
    imported++;
  }

  return { imported, renamed };
}

/**
 * Compat: parse + apply all lists in one call. Kept for callers that don't
 * need the picker step.
 */
export async function importBackup(text: string): Promise<ImportResult> {
  return applyBackup(parseBackup(text));
}
