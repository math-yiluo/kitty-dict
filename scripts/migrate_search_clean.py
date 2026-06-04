"""
Migration: add annotation-stripped search columns to `entries` and rebuild
the entries FTS index on them.

WHY
---
The MoE source embeds display annotations directly inside the searchable
text fields:

  * hanji:  a 【替】 suffix marking a substitute/borrowed character
            (e.g. 仔【替】, 一【替】) — 998 rows.
  * loma / loma_norm:  a 【白】/【文】/【俗】 prefix marking the
            vernacular / literary / colloquial reading
            (e.g. 【白】phang, 【文】hong) — ~2050 rows.

Because these live in the indexed columns, they pollute search three ways:
  1. Searching `phang` ranks 芳 (loma 【白】phang) last — the annotation
     breaks the exact/prefix match so it only survives via FTS.
  2. Typing the bracket `【` prefix-matches every annotated row.
  3. Searching `替` matches 仔【替】 etc. because the FTS unicode61 tokenizer
     splits 【替】 into a bare 替 token.

FIX
---
Keep the original columns for DISPLAY, but add cleaned twins
(hanji_s / loma_s / loma_norm_s) with every 【...】 removed, and rebuild
`entries_fts` to index the cleaned columns. search.ts matches against the
_s columns; results still render the original (annotated) hanji/loma.

Examples carry no 【 and meanings' 【X】 are legitimate cross-references
("釋義參見【母】bó 條"), so their FTS tables are left untouched.

Idempotent: safe to re-run. Mirrors the logic baked into build_db.py so a
full rebuild produces the same schema.
"""

import re
import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "static" / "dict" / "dictionary.db"

# Strip any 【...】 annotation, then any stray half-bracket, then trim ends.
_ANNOT = re.compile(r"【[^】]*】")


def clean(s: str) -> str:
    if s is None:
        return s
    return _ANNOT.sub("", s).replace("【", "").replace("】", "").strip()


def column_exists(cur, table: str, col: str) -> bool:
    cur.execute(f"PRAGMA table_info({table})")
    return any(row[1] == col for row in cur.fetchall())


def main() -> int:
    if not DB.exists():
        print(f"DB not found: {DB}", file=sys.stderr)
        return 1

    con = sqlite3.connect(str(DB))
    cur = con.cursor()

    # 1. Add cleaned search columns (idempotent).
    for col in ("hanji_s", "loma_s", "loma_norm_s"):
        if not column_exists(cur, "entries", col):
            cur.execute(f"ALTER TABLE entries ADD COLUMN {col} TEXT")

    # 2. Populate them from the originals.
    rows = cur.execute("SELECT id, hanji, loma, loma_norm FROM entries").fetchall()
    updated = 0
    changed = 0
    for eid, hanji, loma, loma_norm in rows:
        hs, ls, lns = clean(hanji), clean(loma), clean(loma_norm)
        if hs != hanji or ls != loma or lns != loma_norm:
            changed += 1
        cur.execute(
            "UPDATE entries SET hanji_s=?, loma_s=?, loma_norm_s=? WHERE id=?",
            (hs, ls, lns, eid),
        )
        updated += 1

    # 3. Indexes for the exact/prefix match tiers (rank 1-3 in search.ts).
    cur.execute("CREATE INDEX IF NOT EXISTS idx_entries_hanji_s ON entries(hanji_s)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_entries_loma_s ON entries(loma_s)")
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_entries_loma_norm_s ON entries(loma_norm_s)"
    )

    # 4. Rebuild the entries FTS on the CLEANED columns. Dropping the virtual
    #    table removes its shadow tables; recreate as external-content over the
    #    _s columns and repopulate.
    cur.execute("DROP TABLE IF EXISTS entries_fts")
    cur.execute(
        """
        CREATE VIRTUAL TABLE entries_fts USING fts5(
            hanji_s, loma_s, loma_norm_s,
            content='entries', content_rowid='id',
            prefix='1 2 3',
            tokenize='unicode61 remove_diacritics 2'
        )
        """
    )
    cur.execute(
        "INSERT INTO entries_fts (rowid, hanji_s, loma_s, loma_norm_s) "
        "SELECT id, hanji_s, loma_s, loma_norm_s FROM entries"
    )

    con.commit()
    cur.execute("VACUUM")
    con.commit()
    con.close()
    print(f"OK: {updated} rows processed, {changed} had annotations stripped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
