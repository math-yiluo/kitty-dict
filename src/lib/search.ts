/**
 * Six-tier ranked search across the dictionary.
 *
 * Priority (lower rank = better match, surfaced first):
 *   1. Exact match on 漢字 OR 羅馬字 with FULL tone marks
 *      (so `thau2` → `tháu` puts the tone-2 word above other tones).
 *   2. Exact match on 羅馬字 with diacritics stripped
 *      (fallback when the user didn't type tones, or got the tone wrong).
 *   3. Prefix match on the entry's 漢字 / 羅馬字
 *   4. Substring / token match in the entry's hanji+loma (entries_fts)
 *   5. Substring / token match in meaning definitions (meanings_fts)
 *   6. Substring / token match in example sentences (examples_fts)
 *
 * Romanization queries are matched in two passes (raw + diacritic-stripped)
 * so users can type "tsit" and still hit "tsi̍t". An explicit tone like
 * `tsit8` rises above its tone-fuzzy siblings because of the 1-vs-2 split.
 */

import { queryAll } from './db';
import type { SearchHit } from './types';

// Any char outside of "letter" / "number" is treated as a separator before we
// hand the query to FTS5. FTS5's query grammar reserves a lot of punctuation
// (`-` = NOT, `*` = prefix, `"` = phrase, `:` = column, `()` = grouping, `.`
// inside tokens etc.); the safest policy is to strip ALL of it rather than try
// to enumerate. Romanization hyphens (khi-hū / tsi̍t-poo) thus become spaces
// and the query becomes `khi* hū*` (implicit AND) — which is what we want,
// because the unicode61 tokenizer would have indexed those syllables as
// separate tokens anyway.
const NON_WORD = /[^\p{L}\p{N}]+/gu;

// Tone-number → combining-mark table for Taiwanese Romanization (台羅 / TL).
// 1 (陰平 本調) and 4 (陰入 本調) carry no mark. 6 / 9 are rare in modern TL
// but included for completeness so the converter never silently drops digits.
const TONE_MARKS: Record<string, string> = {
  '1': '',
  '2': '́', // ́  acute             tóng
  '3': '̀', // ̀  grave             tòng
  '4': '',
  '5': '̂', // ̂  circumflex        tông
  '6': '̌', // ̌  caron
  '7': '̄', // ̄  macron            tōng
  '8': '̍', // ̍  vertical line     to̍k
  '9': '̋'  // ̋  double acute
};

function placeToneMark(syllable: string, mark: string): string {
  if (!mark) return syllable;
  // Placement priority for TL: a > first-o-of-"oo" > e > o > i > u
  // (case-insensitive). Mark is inserted immediately after the chosen vowel.
  const lower = syllable.toLowerCase();
  let pos = lower.indexOf('a');
  if (pos < 0) {
    const oo = lower.indexOf('oo');
    if (oo >= 0) pos = oo;
  }
  if (pos < 0) {
    for (const v of ['e', 'o', 'i', 'u']) {
      pos = lower.indexOf(v);
      if (pos >= 0) break;
    }
  }
  if (pos < 0) return syllable; // no vowel in syllable, leave unchanged
  return syllable.slice(0, pos + 1) + mark + syllable.slice(pos + 1);
}

/**
 * Rewrite tone-number notation (tong5 → tông, tok8 → to̍k) to the marked form
 * so users who can't easily type the combining marks can still search.
 * NFC-normalised at the end so precomposed letters (ô / ō / ó / ò) match the
 * dictionary's storage form; tone-8 (vertical line above) has no precomposed
 * counterpart and stays in decomposed form, which is exactly how the DB stores
 * it too.
 */
function convertToneNumbers(s: string): string {
  return s
    .replace(/([a-zA-Z]+)([1-9])/g, (_, syl: string, num: string) =>
      placeToneMark(syl, TONE_MARKS[num] ?? '')
    )
    .normalize('NFC');
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Strip MoE display annotations that the source embeds inside the searchable
// text: 【替】 (substitute-char marker, suffixed to 漢字) and 【白】/【文】/【俗】
// (vernacular / literary / colloquial reading markers, prefixed to 羅馬字).
// The DB now carries annotation-free hanji_s/loma_s/loma_norm_s columns we
// match against (see scripts/migrate_search_clean.py + build_db.py); we apply
// the SAME cleaning to the QUERY so a pasted/typed 【…】 (or a lone 【) doesn't
// leak into the comparison — e.g. searching just "【" yields nothing instead
// of prefix-matching every annotated row.
const ANNOTATION = /【[^】]*】/g;
function stripAnnotations(s: string): string {
  return s.replace(ANNOTATION, '').replace(/[【】]/g, '');
}

function makePrefixFtsQuery(raw: string): string {
  const cleaned = raw.replace(NON_WORD, ' ').trim();
  if (!cleaned) return '';
  return cleaned
    .split(/\s+/)
    .map((t) => `${t}*`)
    .join(' ');
}

export interface SearchRow {
  id: number;
  hanji: string;
  loma: string;
  audio_file: string | null;
  loma_norm: string;
  rank: number;
  preview: string | null;
}

export async function search(rawQuery: string, limit = 30): Promise<SearchHit[]> {
  // Drop any 【…】 display annotation from the query first (see stripAnnotations),
  // THEN translate tone-number notation (e.g. `tong5` → `tông`) so the rest of
  // the pipeline sees the same form the cleaned DB columns store. A query that
  // is nothing but annotation (e.g. "【") collapses to empty → no results.
  const q = convertToneNumbers(stripAnnotations(rawQuery.trim()));
  if (!q) return [];
  const qNorm = stripDiacritics(q);
  const fts = makePrefixFtsQuery(q);
  const ftsNorm = makePrefixFtsQuery(qNorm);

  // If the FTS query is empty (only operators), fall back to a no-op pattern.
  const ftsSafe = fts || '__noop__';
  const ftsNormSafe = ftsNorm || '__noop__';

  const sql = `
    WITH ranked AS (
      -- All exact/prefix tiers match the annotation-stripped *_s columns so
      -- MoE's 【白】/【文】/【俗】/【替】 markers don't break or pollute matching
      -- (e.g. 芳 with loma 【白】phang must still exact-match 'phang'). The
      -- SELECT below returns the ORIGINAL hanji/loma for display.
      --
      -- Rank 1: exact tone-aware match. Keeping loma_norm_s OUT of this tier is
      -- what makes 'thau2' (→ tháu) surface tone-2 above other tones — if it
      -- were OR'd in here, all toneN entries would tie at rank 1.
      SELECT id, 1 AS rank FROM entries
      WHERE hanji_s = ?1 OR loma_s = ?1

      UNION ALL
      -- Rank 2: exact match after stripping diacritics — the tone-fuzzy
      -- fallback. Catches 'thau' (no tone) and 'thau1' for any toneN entry,
      -- but loses to rank 1 when the user typed an explicit, correct tone.
      SELECT id, 2 AS rank FROM entries
      WHERE loma_norm_s = ?2

      UNION ALL
      -- Rank 3: prefix match
      SELECT id, 3 AS rank FROM entries
      WHERE (hanji_s LIKE ?1 || '%' OR loma_s LIKE ?1 || '%' OR loma_norm_s LIKE ?2 || '%')

      UNION ALL
      -- Rank 4: entry FTS (hanji / loma / loma_norm)
      SELECT rowid AS id, 4 AS rank FROM entries_fts
      WHERE entries_fts MATCH ?3

      UNION ALL
      -- Rank 5: meanings FTS
      SELECT entry_id AS id, 5 AS rank FROM meanings_fts
      WHERE meanings_fts MATCH ?3

      UNION ALL
      -- Rank 6: example FTS
      SELECT entry_id AS id, 6 AS rank FROM examples_fts
      WHERE examples_fts MATCH ?3
    )
    SELECT
      e.id, e.hanji, e.loma, e.audio_file, e.loma_norm,
      MIN(r.rank) AS rank,
      (SELECT definition FROM meanings WHERE entry_id = e.id ORDER BY meaning_id LIMIT 1) AS preview
    FROM ranked r JOIN entries e ON e.id = r.id
    GROUP BY e.id
    ORDER BY rank ASC, length(e.hanji) ASC, e.id ASC
    LIMIT ?4;
  `;

  // sql.js' prepared statement bind doesn't support named ?n parameters across UNION ALL
  // when the same number appears multiple times; we pass positional binds that map 1-to-1
  // with the ?n placeholders. (sql.js maps ?1, ?2, ... by position.)
  const rows = await queryAll<SearchRow>(sql, [q, qNorm, ftsSafe, limit]);

  // Soft fallback: if the diacritic-stripped FTS form would have hit something the
  // raw FTS missed, merge it in by running a second pass. Avoids a more complex SQL.
  if (ftsNormSafe !== ftsSafe) {
    const rows2 = await queryAll<SearchRow>(sql, [q, qNorm, ftsNormSafe, limit]);
    const seen = new Set(rows.map((r) => r.id));
    for (const r of rows2) {
      if (!seen.has(r.id)) {
        rows.push(r);
        seen.add(r.id);
      }
    }
    rows.sort((a, b) => a.rank - b.rank || a.hanji.length - b.hanji.length || a.id - b.id);
    rows.splice(limit);
  }

  return rows.map((r) => ({
    entry: {
      id: r.id,
      type: null,
      hanji: r.hanji,
      loma: r.loma,
      category: null,
      audio_file: r.audio_file,
      loma_norm: r.loma_norm
    },
    rank: r.rank,
    preview: r.preview ?? undefined
  }));
}
