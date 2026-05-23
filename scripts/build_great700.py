"""
Build the great700.json manifest by reconciling the 教育部 700 字推薦用字 PDF
against the existing dictionary.

Pipeline:
  1. Parse the 700-字表 PDF and extract (pdf_num, hanji, loma) for all 700 rows
     from the 「建議用字」 / 「音讀」 columns.
  2. Try to auto-resolve each PDF row to an `entries.id` using normalised hanji
     + loma matching against the dictionary. This handles ~673 rows cleanly.
  3. For the ~27 rows that don't auto-resolve unambiguously, use a hard-coded
     manual mapping table (curated by the dictionary author after reviewing the
     audit output — see plan file).
  4. Verify every entry_id exists in `entries`.
  5. Write the merged result to `data/great700.json`.

The output JSON drives `scripts/build_db.py`, which populates the
`great700_entries` SQL table.
"""
from __future__ import annotations

import io
import json
import re
import sqlite3
import sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.stderr.write("Missing dependency: pip install pdfplumber\n")
    raise

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = Path(
    r"C:\OneDrive - National University of Singapore\Desktop\方言\閩\散在的閩南語學習\700.pdf"
)
DB_PATH = REPO_ROOT / "static" / "dict" / "dictionary.db"
OUTPUT_PATH = REPO_ROOT / "data" / "great700.json"

# ---------------------------------------------------------------------------
# Manual mappings supplied by the dictionary author after reviewing the audit
# output. Each PDF number → list of entry_ids in dictionary.db.
#
# Most are 1-to-1, but #59 (尾蝶/蝶仔) maps to TWO entries because the PDF row
# documents two synonymous lexical items the author wants surfaced separately.
# ---------------------------------------------------------------------------
MANUAL_MAPPING: dict[int, list[int]] = {
    29:  [5479],            # 茉莉  ba̍k-nī
    46:  [7346],            # 敏豆（仔） bín-tāu(-á)
    59:  [11357, 3121],     # 尾蝶（仔）/（尾）蝶仔 — two entries
    71:  [13471],           # 𠢕  gâu
    105: [7575],            # 現出 hiàn-tshut
    115: [8897],            # 翕 hip  ← override auto-A (was 8896「照相」, corrected to 8897「悶熄」per PDF disambig)
    116: [8896],            # 翕 hip  ← explicit; pairs with #115 (照相 sense)
    131: [14109],           # 花眉（仔） hue-bî(-á)
    149: [13567],           # 𪜶  in
    172: [1382],            # 加 ka   ← override auto-A (was 1381「名詞前綴」, corrected to 1382「增益」)
    180: [1848],            # 甲 kah  ← override auto-A (was 1847「天干」, corrected to 1848「到」)
    186: [13507],           # 𥴊𥴊仔店 kám-á-tiàm
    202: [4045],            # 咳啾 kha-tshiùnn
    208: [10206],           # 較停（仔） khah-thîng(-á)
    220: [11589],           # 齒戳（仔） khí-thok(-á)
    262: [10907],           # 閣 koh  ← override auto-A (was 10906「樓閣」, corrected to 10907「又、再、還」)
    303: [4770],            # 咧 leh
    341: [12244],           # 糜 muê
    364: [4558],            # 爸 pa
    381: [13504],           # 𥰔𥰔仔 phín-á
    415: [8974],            # 菠薐仔（菜） pue-lîng-á(-tshài)
    457: [283],             # 小可（仔） sió-khuá(-á)
    460: [1474],            # 四秀（仔） sì-siù(-á)
    493: [7566],            # 淡薄（仔） tām-po̍h(-á)
    506: [13092],           # 癩 thái-ko
    511: [6362],            # 痛 thàng  ← override auto-A (was 16088「痛【白】thàng」, a content-less reference entry; 6362「疼痛 thiànn-thàng」carries the actual meanings)
    553: [13568],           # 𠕇𠕇 tīng
    573: [3245],            # 杜蚓 tōo-kún
    622: [13522],           # 𨑨𨑨迌 tshit-thô
    623: [1123],            # 手電（仔） tshiú-tiān(-á)
    630: [13511],           # 𤆬𤆬 tshuā
    670: [32],              # 一寡仔 tsi̍t-kuá-á
    688: [3369],            # 肚胿仔 (tuā-)tōo-kuai-á
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
TAG_RE = re.compile(r"【[^】]*】")  # 【替】, 【白】, 【文】 etc.


def clean_cell(s: str | None) -> str:
    """Strip whitespace + collapse internal whitespace from a PDF cell."""
    return re.sub(r"\s+", "", s or "").strip()


def norm_hanji(h: str) -> str:
    """Strip 【...】 tags so '峇【替】' compares equal to '峇'."""
    return TAG_RE.sub("", h or "").strip()


def norm_loma_set(l: str) -> set[str]:
    """
    Dictionary loma is sometimes a /-separated multi-form list and may carry
    【白】/【文】 prefixes; normalise to a set of bare loma strings.
    """
    if not l:
        return set()
    return {p.strip() for p in TAG_RE.sub("", l).split("/") if p.strip()}


def parse_pdf(pdf_path: Path) -> list[tuple[int, str, str]]:
    """Return list of (pdf_num, hanji, loma) for all 700 rows."""
    rows: list[tuple[int, str, str]] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for row in table:
                    if not row or len(row) < 3:
                        continue
                    num_cell = (row[0] or "").strip()
                    if not re.fullmatch(r"\d{1,3}", num_cell):
                        continue
                    num = int(num_cell)
                    if 1 <= num <= 700:
                        rows.append((num, clean_cell(row[1]), clean_cell(row[2])))
    return rows


def strip_bracket_variants(s: str) -> list[str]:
    """
    Produce candidate forms for matching when the PDF hanji contains brackets
    or slashes, e.g. '敏豆（仔）' → ['敏豆', '敏豆仔'].
    """
    out: set[str] = set()
    for p in s.split("/"):
        # Variant A: remove brackets but keep contents.
        with_inner = re.sub(r"[（）()]", "", p)
        if with_inner:
            out.add(with_inner)
        # Variant B: remove brackets AND their contents.
        no_inner = re.sub(r"（[^（）]*）|\([^()]*\)", "", p)
        no_inner = re.sub(r"[（）()]", "", no_inner)
        if no_inner:
            out.add(no_inner)
    return [x for x in out if x]


# ---------------------------------------------------------------------------
# Main resolution pipeline
# ---------------------------------------------------------------------------
def resolve_all(
    pdf_rows: list[tuple[int, str, str]],
    conn: sqlite3.Connection,
) -> tuple[list[dict], list[tuple[int, str, str, str]]]:
    """
    Return (resolved_items, issues).
    resolved_items: [{pdf_num, pdf_hanji, pdf_loma, entry_ids, source}]
    issues:        rows where resolution required manual override but the
                   override was missing.
    """
    cur = conn.cursor()
    all_rows = cur.execute("SELECT id, hanji, loma FROM entries").fetchall()
    by_norm_hanji: dict[str, list[tuple[int, str, str]]] = {}
    by_norm_loma: dict[str, list[tuple[int, str, str]]] = {}
    for rid, h, l in all_rows:
        by_norm_hanji.setdefault(norm_hanji(h), []).append((rid, h, l))
        for nl in norm_loma_set(l):
            by_norm_loma.setdefault(nl, []).append((rid, h, l))

    resolved: list[dict] = []
    issues: list[tuple[int, str, str, str]] = []

    for num, hanji, loma in pdf_rows:
        # Manual override always wins (it's curated by the author for the
        # ambiguous / missing rows from the audit phase).
        if num in MANUAL_MAPPING:
            resolved.append({
                "pdf_num": num,
                "pdf_hanji": hanji,
                "pdf_loma": loma,
                "entry_ids": MANUAL_MAPPING[num],
                "source": "manual",
            })
            continue

        pdf_lomas = norm_loma_set(loma)
        nh = norm_hanji(hanji)
        rows = by_norm_hanji.get(nh, [])

        # Path A — hanji exact, loma overlap. Unique row is also A.
        if rows:
            match = next(
                (r for r in rows if norm_loma_set(r[2]) & pdf_lomas), None
            )
            if match is not None:
                resolved.append({
                    "pdf_num": num,
                    "pdf_hanji": hanji,
                    "pdf_loma": loma,
                    "entry_ids": [match[0]],
                    "source": "auto-A",
                })
                continue
            if len(rows) == 1:
                # Single hanji match even without loma overlap — accept it.
                resolved.append({
                    "pdf_num": num,
                    "pdf_hanji": hanji,
                    "pdf_loma": loma,
                    "entry_ids": [rows[0][0]],
                    "source": "auto-A-hanji-unique",
                })
                continue
            # Multi-candidate without loma match — should have been in MANUAL.
            issues.append((num, hanji, loma, f"category B: {len(rows)} hanji candidates, no loma overlap"))
            continue

        # If we get here, hanji wasn't found exactly — categories C/D/E/F
        # are all supposed to be covered by MANUAL_MAPPING above.
        issues.append((num, hanji, loma, "needs manual mapping (C/D/E/F) but not in MANUAL_MAPPING"))

    return resolved, issues


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

    if not PDF_PATH.exists():
        sys.stderr.write(f"PDF not found: {PDF_PATH}\n")
        return 2
    if not DB_PATH.exists():
        sys.stderr.write(f"Dictionary DB not found: {DB_PATH}\n")
        return 2

    print(f"PDF: {PDF_PATH}")
    print(f"DB:  {DB_PATH}")
    print()

    print("→ Parsing PDF…")
    pdf_rows = parse_pdf(PDF_PATH)
    print(f"  extracted {len(pdf_rows)} rows")
    if len(pdf_rows) != 700:
        sys.stderr.write(f"Expected 700 PDF rows, got {len(pdf_rows)}\n")
        return 3

    print("→ Resolving against dictionary…")
    conn = sqlite3.connect(DB_PATH)
    resolved, issues = resolve_all(pdf_rows, conn)

    if issues:
        sys.stderr.write(f"\n{len(issues)} unresolved rows — fix MANUAL_MAPPING above:\n")
        for num, h, l, msg in issues:
            sys.stderr.write(f"  #{num:03d}  {h}  /  {l}   — {msg}\n")
        return 4

    # Sanity-check every entry_id actually exists.
    print("→ Verifying entry_ids exist in dictionary…")
    cur = conn.cursor()
    all_ids = {r[0] for r in cur.execute("SELECT id FROM entries").fetchall()}
    bad: list[tuple[int, int]] = []
    for item in resolved:
        for eid in item["entry_ids"]:
            if eid not in all_ids:
                bad.append((item["pdf_num"], eid))
    if bad:
        sys.stderr.write(f"\n{len(bad)} entry_ids don't exist in DB:\n")
        for pdf_num, eid in bad:
            sys.stderr.write(f"  #{pdf_num:03d} → entry_id={eid} not found\n")
        return 5
    print(f"  all {sum(len(i['entry_ids']) for i in resolved)} entry_ids verified")

    # Within each list (1..7), drop later occurrences of the same entry_id so
    # the list contains each dictionary entry at most once. Educational PDF
    # editors sometimes assign two consecutive numbers to the same 字音 to
    # document distinct 對應華語 meanings, but the dictionary collapses those
    # under a single entry — replaying the same flashcard twice in a row is
    # wasted reps. We keep the first occurrence in PDF order.
    print("→ Deduplicating within each list_idx…")
    seen_per_list: dict[int, set[int]] = {i: set() for i in range(1, 8)}
    deduped: list[dict] = []
    skipped: list[tuple[int, int]] = []
    for item in resolved:
        list_idx = ((item["pdf_num"] - 1) // 100) + 1
        kept_ids: list[int] = []
        for eid in item["entry_ids"]:
            if eid in seen_per_list[list_idx]:
                skipped.append((item["pdf_num"], eid))
            else:
                seen_per_list[list_idx].add(eid)
                kept_ids.append(eid)
        if kept_ids:
            new_item = {**item, "entry_ids": kept_ids}
            deduped.append(new_item)
        # else: entire item is duplicate, drop completely
    print(f"  Dropped {len(skipped)} duplicate slots ({len(resolved) - len(deduped)} PDF rows fully eliminated)")
    for pdf_num, eid in skipped:
        print(f"    #{pdf_num:03d}  entry_id={eid}  (already in list)")
    resolved = deduped

    # Enrich each resolved item with the dictionary hanji/loma it points to,
    # to make the manifest auditable by humans without re-opening the DB.
    id_to_info: dict[int, tuple[str, str]] = {
        r[0]: (r[1], r[2]) for r in cur.execute("SELECT id, hanji, loma FROM entries").fetchall()
    }
    for item in resolved:
        item["dict_entries"] = [
            {"id": eid, "hanji": id_to_info[eid][0], "loma": id_to_info[eid][1]}
            for eid in item["entry_ids"]
        ]

    # Group by list_idx (1..7) for clarity. Each list_idx contains the items
    # whose pdf_num falls in (list_idx-1)*100+1 .. list_idx*100.
    lists: list[dict] = []
    for list_idx in range(1, 8):
        start = (list_idx - 1) * 100 + 1
        end = list_idx * 100
        items_in_list = [r for r in resolved if start <= r["pdf_num"] <= end]
        items_in_list.sort(key=lambda x: x["pdf_num"])
        n_entries = sum(len(it["entry_ids"]) for it in items_in_list)
        lists.append({
            "list_idx": list_idx,
            "name": f"{start:03d}–{end:03d}",
            "pdf_num_range": [start, end],
            "pdf_row_count": len(items_in_list),
            "entry_count": n_entries,
            "items": items_in_list,
        })

    output = {
        "source": "教育部 臺灣台語推薦用字 700 字表",
        "source_pdf_filename": "700.pdf",
        "total_pdf_rows": len(resolved),
        "total_entries": sum(len(it["entry_ids"]) for it in resolved),
        "lists": lists,
        "stats": {
            "auto_resolved":   sum(1 for it in resolved if it["source"].startswith("auto-")),
            "manual_resolved": sum(1 for it in resolved if it["source"] == "manual"),
        },
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n✓ Wrote {OUTPUT_PATH}")
    print()
    print("Summary by list:")
    print(f"  {'List':<12} {'PDF rows':>10} {'Entries':>10}")
    for l in lists:
        flag = " ←" if l["pdf_row_count"] != l["entry_count"] else ""
        print(f"  {l['name']:<12} {l['pdf_row_count']:>10} {l['entry_count']:>10}{flag}")
    print()
    print(f"Auto-resolved: {output['stats']['auto_resolved']}")
    print(f"Manual:        {output['stats']['manual_resolved']}")
    print(f"TOTAL PDF rows: {output['total_pdf_rows']}")
    print(f"TOTAL entries:  {output['total_entries']}  (note: #59 maps to 2 entries)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
