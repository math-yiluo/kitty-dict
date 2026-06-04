"""
build_db.py — preprocess kautian.ods into the dictionary SQLite database.

Reads the OpenDocument spreadsheet using only the Python standard library
(zipfile + xml.etree), so no odfpy / pandas dependency is required.

Run from project root:
    python scripts/build_db.py

Produces:
    static/dict/dictionary.db  (SQLite with FTS5 indexes)
"""

import json
import re
import sqlite3
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ODS_PATH = ROOT / "data" / "kautian.ods"
GREAT700_PATH = ROOT / "data" / "great700.json"
OUT_PATH = ROOT / "static" / "dict" / "dictionary.db"

NS_TABLE = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
NS_TEXT = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
NS_OFFICE = "{urn:oasis:names:tc:opendocument:xmlns:office:1.0}"


def strip_diacritics(s: str) -> str:
    if not s:
        return ""
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    ).lower()


# MoE embeds display annotations inside the searchable text: 【替】 (substitute
# char) suffixed to 漢字, and 【白】/【文】/【俗】 (vernacular/literary/colloquial
# reading) prefixed to 羅馬字. These pollute search (break exact/prefix match,
# leak into the FTS tokenizer). We keep the originals for display but ALSO store
# annotation-free *_s columns to match against. Mirror of stripAnnotations() in
# src/lib/search.ts and scripts/migrate_search_clean.py — keep the three in sync.
_ANNOT_RE = re.compile(r"【[^】]*】")


def strip_annotations(s: str) -> str:
    if not s:
        return ""
    return _ANNOT_RE.sub("", s).replace("【", "").replace("】", "").strip()


CATEGORY_ALIASES = {
    # The MOE .ods column lists "相關用語" as an opaque sub-node that becomes
    # context-free once flattened; rename it to something the user can act on.
    "相關用語": "身分及職業——相關用語",
}
# Junk labels that aren't useful as user-facing categories.
CATEGORY_DROP = {"全部"}


def split_categories(raw: str) -> list[str]:
    """Split on ',' / '，' but keep '、' (which is part of compound category names).
    Entries with no usable category get an empty list — they simply do not
    appear under any category list. ("未分類" used to bucket them; per user
    feedback we now drop that virtual category entirely.)"""
    if not raw or not raw.strip():
        return []
    out: list[str] = []
    for p in re.split(r"[，,]", raw):
        p = p.strip()
        if not p or p in CATEGORY_DROP:
            continue
        out.append(CATEGORY_ALIASES.get(p, p))
    return out


def cell_text(cell) -> str:
    pieces = []
    for p in cell.iter(f"{NS_TEXT}p"):
        for t in p.itertext():
            if t:
                pieces.append(t)
        pieces.append("\n")
    text = "".join(pieces).rstrip("\n")
    if text:
        return text
    # Numeric / formula cells store data in office:value (no <text:p>).
    val = cell.get(f"{NS_OFFICE}value")
    if val:
        # Normalize "1.0" → "1" for integer-valued floats.
        try:
            f = float(val)
            if f.is_integer():
                return str(int(f))
        except ValueError:
            pass
        return val
    return ""


def expand_row(row) -> list[str]:
    raw_cells = row.findall(f"{NS_TABLE}table-cell")
    out: list[str] = []
    for i, c in enumerate(raw_cells):
        rep = int(c.get(f"{NS_TABLE}number-columns-repeated", "1"))
        text = cell_text(c)
        if i == len(raw_cells) - 1 and not text and rep > 1:
            rep = 1
        if rep > 1000:
            rep = 1
        for _ in range(rep):
            out.append(text)
    return out


def read_sheet(root, sheet_name: str) -> list[list[str]]:
    for tbl in root.iter(f"{NS_TABLE}table"):
        if tbl.get(f"{NS_TABLE}name") == sheet_name:
            return [expand_row(r) for r in tbl.findall(f"{NS_TABLE}table-row")]
    return []


def col_index(headers: list[str], name: str) -> int | None:
    try:
        return headers.index(name)
    except ValueError:
        return None


def get(cells: list[str], idx: int | None) -> str:
    if idx is None or idx >= len(cells):
        return ""
    return cells[idx].strip()


def parse_int(s: str) -> int | None:
    s = (s or "").strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        try:
            return int(float(s))
        except ValueError:
            return None


SCHEMA = """
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;

CREATE TABLE entries (
    id INTEGER PRIMARY KEY,
    type TEXT,
    hanji TEXT NOT NULL,
    loma TEXT NOT NULL,
    category TEXT,
    audio_file TEXT,
    loma_norm TEXT NOT NULL,
    -- Annotation-stripped twins of hanji / loma / loma_norm, used for search
    -- matching (see strip_annotations). Originals stay for display.
    hanji_s TEXT NOT NULL,
    loma_s TEXT NOT NULL,
    loma_norm_s TEXT NOT NULL
);

CREATE TABLE meanings (
    entry_id INTEGER NOT NULL,
    meaning_id INTEGER NOT NULL,
    pos TEXT,
    definition TEXT NOT NULL,
    PRIMARY KEY (entry_id, meaning_id)
);

CREATE TABLE examples (
    entry_id INTEGER NOT NULL,
    meaning_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    hanji TEXT NOT NULL,
    loma TEXT NOT NULL,
    mandarin TEXT,
    audio_file TEXT,
    PRIMARY KEY (entry_id, meaning_id, seq)
);

CREATE TABLE alt_pronunciations (
    entry_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    hanji TEXT,
    loma TEXT
);

CREATE TABLE entry_categories (
    entry_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (entry_id, category)
);

-- 偉大的 700 字 (Great 700 characters): seven built-in lists materialised from
-- data/great700.json. Each row links one slot (list_idx, seq) to a dictionary
-- entry. PDF row 59 maps to TWO entries (蝶仔 + 尾蝶), so list 1 may exceed 100.
--
-- UNIQUE(list_idx, entry_id) enforces the no-duplicates-per-list invariant
-- (same constraint that entry_categories.PRIMARY_KEY and Dexie's
-- [listId+entryId] compound index guarantee for cat: and user: lists).
-- The build script also dedups at the manifest layer; this is belt-and-braces.
CREATE TABLE great700_entries (
    list_idx INTEGER NOT NULL,        -- 1..7
    seq INTEGER NOT NULL,             -- 1..N within each list (display order)
    pdf_num INTEGER NOT NULL,         -- original PDF row number 1..700
    pdf_hanji TEXT NOT NULL,          -- original PDF 「建議用字」 string
    entry_id INTEGER NOT NULL,
    PRIMARY KEY (list_idx, seq),
    UNIQUE (list_idx, entry_id),
    FOREIGN KEY (entry_id) REFERENCES entries(id)
);
"""

POST_SCHEMA = """
CREATE INDEX idx_entry_categories_cat ON entry_categories(category, entry_id);
CREATE INDEX idx_meanings_entry ON meanings(entry_id);
CREATE INDEX idx_examples_entry ON examples(entry_id);
CREATE INDEX idx_entries_hanji ON entries(hanji);
CREATE INDEX idx_entries_loma ON entries(loma);
CREATE INDEX idx_entries_loma_norm ON entries(loma_norm);
CREATE INDEX idx_entries_hanji_s ON entries(hanji_s);
CREATE INDEX idx_entries_loma_s ON entries(loma_s);
CREATE INDEX idx_entries_loma_norm_s ON entries(loma_norm_s);

CREATE VIEW category_summary AS
    SELECT category, COUNT(*) AS n
    FROM entry_categories
    GROUP BY category;

CREATE INDEX idx_great700_by_entry ON great700_entries(entry_id);

CREATE VIEW great700_summary AS
    SELECT list_idx, COUNT(*) AS n
    FROM great700_entries
    GROUP BY list_idx;

-- FTS indexes the annotation-stripped *_s columns so MoE's 【白】/【文】/【俗】/
-- 【替】 markers don't leak into the tokenizer (otherwise the unicode61
-- tokenizer splits 仔【替】 into a bare 替 token and searching 替 wrongly hits
-- it). Matches the *_s columns search.ts queries.
CREATE VIRTUAL TABLE entries_fts USING fts5(
    hanji_s, loma_s, loma_norm_s,
    content='entries', content_rowid='id',
    prefix='1 2 3',
    tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO entries_fts (rowid, hanji_s, loma_s, loma_norm_s)
    SELECT id, hanji_s, loma_s, loma_norm_s FROM entries;

CREATE VIRTUAL TABLE meanings_fts USING fts5(
    definition,
    entry_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO meanings_fts (definition, entry_id)
    SELECT definition, entry_id FROM meanings;

CREATE VIRTUAL TABLE examples_fts USING fts5(
    hanji, loma, mandarin,
    entry_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO examples_fts (hanji, loma, mandarin, entry_id)
    SELECT hanji, loma, COALESCE(mandarin, ''), entry_id FROM examples;
"""


def main() -> int:
    if not ODS_PATH.exists():
        print(f"ERROR: {ODS_PATH} not found", file=sys.stderr)
        return 1

    print(f"Reading: {ODS_PATH}")
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if OUT_PATH.exists():
        OUT_PATH.unlink()

    with zipfile.ZipFile(ODS_PATH) as z:
        with z.open("content.xml") as f:
            tree = ET.parse(f)
    root = tree.getroot()

    conn = sqlite3.connect(str(OUT_PATH))
    conn.executescript(SCHEMA)

    # --- 詞目 (entries) ---
    print("Loading 詞目 (entries) ...")
    rows = read_sheet(root, "詞目")
    headers = rows[0]
    c_id = col_index(headers, "詞目id")
    c_type = col_index(headers, "詞目類型")
    c_hanji = col_index(headers, "漢字")
    c_loma = col_index(headers, "羅馬字")
    c_cat = col_index(headers, "分類")
    c_audio = col_index(headers, "羅馬字音檔檔名")
    n_entries = 0
    n_cat_links = 0
    for r in rows[1:]:
        eid = parse_int(get(r, c_id))
        hanji = get(r, c_hanji)
        loma = get(r, c_loma)
        if eid is None or not hanji or not loma:
            continue
        type_ = get(r, c_type) or None
        category = get(r, c_cat) or None
        audio = get(r, c_audio) or None
        loma_norm = strip_diacritics(loma)
        conn.execute(
            "INSERT OR IGNORE INTO entries "
            "(id, type, hanji, loma, category, audio_file, loma_norm, hanji_s, loma_s, loma_norm_s) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                eid, type_, hanji, loma, category, audio, loma_norm,
                strip_annotations(hanji),
                strip_annotations(loma),
                strip_annotations(loma_norm),
            ),
        )
        for cat in split_categories(category or ""):
            conn.execute(
                "INSERT OR IGNORE INTO entry_categories (entry_id, category) VALUES (?, ?)",
                (eid, cat),
            )
            n_cat_links += 1
        n_entries += 1
    print(f"  inserted {n_entries} entries, {n_cat_links} category links")

    # --- 義項 (meanings) ---
    print("Loading 義項 (meanings) ...")
    rows = read_sheet(root, "義項")
    headers = rows[0]
    c_eid = col_index(headers, "詞目id")
    c_mid = col_index(headers, "義項id")
    c_pos = col_index(headers, "詞性")
    c_def = col_index(headers, "解說")
    n_meanings = 0
    for r in rows[1:]:
        eid = parse_int(get(r, c_eid))
        mid = parse_int(get(r, c_mid))
        defi = get(r, c_def)
        if eid is None or mid is None or not defi:
            continue
        pos = get(r, c_pos) or None
        try:
            conn.execute(
                "INSERT INTO meanings (entry_id, meaning_id, pos, definition) VALUES (?,?,?,?)",
                (eid, mid, pos, defi),
            )
            n_meanings += 1
        except sqlite3.IntegrityError:
            pass
    print(f"  inserted {n_meanings} meanings")

    # --- 例句 (examples) ---
    print("Loading 例句 (examples) ...")
    rows = read_sheet(root, "例句")
    headers = rows[0]
    c_eid = col_index(headers, "詞目id")
    c_mid = col_index(headers, "義項id")
    c_seq = col_index(headers, "例句順序")
    c_hanji = col_index(headers, "漢字")
    c_loma = col_index(headers, "羅馬字")
    c_mand = col_index(headers, "華語")
    c_audio = col_index(headers, "音檔檔名")
    n_examples = 0
    for r in rows[1:]:
        eid = parse_int(get(r, c_eid))
        mid = parse_int(get(r, c_mid))
        seq = parse_int(get(r, c_seq))
        hanji = get(r, c_hanji)
        loma = get(r, c_loma)
        if eid is None or mid is None or seq is None or not hanji or not loma:
            continue
        mandarin = get(r, c_mand) or None
        audio = get(r, c_audio) or None
        try:
            conn.execute(
                "INSERT INTO examples (entry_id, meaning_id, seq, hanji, loma, mandarin, audio_file) "
                "VALUES (?,?,?,?,?,?,?)",
                (eid, mid, seq, hanji, loma, mandarin, audio),
            )
            n_examples += 1
        except sqlite3.IntegrityError:
            pass
    print(f"  inserted {n_examples} examples")

    # --- 又唸作 / 合音唸作 / 俗唸作 ---
    for sheet_name, kind in [
        ("又唸作", "alt"),
        ("合音唸作", "coalesce"),
        ("俗唸作", "colloquial"),
    ]:
        rows = read_sheet(root, sheet_name)
        if not rows:
            print(f"  (no rows in {sheet_name})")
            continue
        headers = rows[0]
        c_eid = col_index(headers, "詞目id")
        c_hanji = col_index(headers, "漢字")
        c_loma = col_index(headers, "羅馬字")
        if c_eid is None:
            continue
        n = 0
        for r in rows[1:]:
            eid = parse_int(get(r, c_eid))
            if eid is None:
                continue
            hanji = get(r, c_hanji) or None
            loma = get(r, c_loma) or None
            if not hanji and not loma:
                continue
            conn.execute(
                "INSERT INTO alt_pronunciations (entry_id, kind, hanji, loma) VALUES (?,?,?,?)",
                (eid, kind, hanji, loma),
            )
            n += 1
        print(f"  inserted {n} from {sheet_name} ({kind})")

    # --- 偉大的 700 字 (great700_entries) ---
    # Optional: skip if the manifest hasn't been generated yet (CI-only builds
    # before someone runs scripts/build_great700.py).
    if GREAT700_PATH.exists():
        print(f"Loading 偉大的 700 字 from {GREAT700_PATH.name} ...")
        with open(GREAT700_PATH, "r", encoding="utf-8") as f:
            g700 = json.load(f)
        n_g700 = 0
        for L in g700["lists"]:
            list_idx = L["list_idx"]
            seq = 1
            for item in L["items"]:
                pdf_num = item["pdf_num"]
                pdf_hanji = item["pdf_hanji"]
                # Each item may map to ONE or MORE entry_ids (e.g. #59 has 2).
                # Each entry_id gets its own (list_idx, seq) slot.
                for entry_id in item["entry_ids"]:
                    # INSERT OR IGNORE: if UNIQUE(list_idx, entry_id) collides
                    # (manifest somehow contained a duplicate), silently skip.
                    # The seq counter only advances on actual insert so the
                    # final seq column has no gaps. The manifest pipeline should
                    # have already deduped — this is the last-resort safety net.
                    cursor = conn.execute(
                        "INSERT OR IGNORE INTO great700_entries (list_idx, seq, pdf_num, pdf_hanji, entry_id) "
                        "VALUES (?,?,?,?,?)",
                        (list_idx, seq, pdf_num, pdf_hanji, entry_id),
                    )
                    if cursor.rowcount > 0:
                        seq += 1
                        n_g700 += 1
        print(f"  inserted {n_g700} great700_entries rows across 7 lists")
    else:
        print(f"  (skipped great700 — {GREAT700_PATH.name} not found; run scripts/build_great700.py first)")

    print("Building indexes, FTS5 tables & views ...")
    conn.executescript(POST_SCHEMA)

    conn.execute("ANALYZE")
    conn.commit()
    conn.close()

    # VACUUM has to run outside a transaction
    conn = sqlite3.connect(str(OUT_PATH))
    conn.execute("VACUUM")
    conn.close()

    size_mb = OUT_PATH.stat().st_size / 1_048_576
    print(f"Wrote {OUT_PATH} ({size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
