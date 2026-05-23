/**
 * Map an entry / example record to its mp3 URL on disk.
 *
 * The dev server (vite.config.ts) serves the data/sutiau-mp3 + data/leku-mp3
 * folders under /audio/sutiau/{folder}/{file} and /audio/leku/{folder}/{file}.
 * In production the same routes must be served by whatever hosts the build/
 * directory (or via a CDN); the URL structure is otherwise identical.
 *
 * Folder bucketing rule (verified against the source data):
 *   folder = floor(entry_id / 1000)
 */

const AUDIO_BASE = '/audio';

function bucket(entryId: number): number {
  return Math.floor(entryId / 1000);
}

/** URL for an entry's word recording, or null when the entry has no audio. */
export function entryAudioUrl(entryId: number, audioFile: string | null): string | null {
  if (!audioFile) return null;
  return `${AUDIO_BASE}/sutiau/${bucket(entryId)}/${encodeURIComponent(audioFile)}.mp3`;
}

/** URL for an example sentence's recording, or null. */
export function exampleAudioUrl(entryId: number, audioFile: string | null): string | null {
  if (!audioFile) return null;
  return `${AUDIO_BASE}/leku/${bucket(entryId)}/${encodeURIComponent(audioFile)}.mp3`;
}
