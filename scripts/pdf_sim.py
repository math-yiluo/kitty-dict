"""Simulate PDF layout for great700 list 001-100 — focus on entries 1..4 (仔 is entry 4).

The runtime page-break algorithm in src/routes/learn/[listId]/+page.svelte:

    let pageTopOffset = 0;
    for (const u of units) {
      const unitTop = u.offsetTop;
      const unitBottom = unitTop + u.offsetHeight;
      const relBottom = unitBottom - pageTopOffset;
      if (relBottom > PAGE_INNER_HEIGHT_PX && unitTop > pageTopOffset) {
        insertBreakBefore(u);
        pageTopOffset = u.offsetTop;
      }
    }

We model unit heights from the HTML template in buildPrintHtml().
Container width = 718px (pageSize.inner.width = 190mm @ 96 DPI).
PAGE_INNER_HEIGHT_PX = 1046 (A4 297mm - 2*10mm margin).

Each unit is one of:
  - "head"     單元一: hanji + loma + first meaning (under entry head)
  - "meaning"  單元二: subsequent meaning
  - "example"  單元三: example sentence

container font-size: 14px, line-height: 1.4 → so 1em ≈ 14px, 1pt ≈ 1.333px.
"""
import sqlite3
import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, 'utf-8')

PT = 1.333  # 1pt = 1.333px @ 96 DPI
CONTAINER_W = 718
PAGE_INNER = 1046

# ------------------------ font-metric helpers ------------------------

# Rough heuristics — chars per line at given font-size in 718px container.
# Hanji is wide (~1em), latin is narrow (~0.5em).

def hanji_lines(text: str, fs_px: float, *, pad_left_px: float = 0) -> int:
    """How many wrapped lines does `text` take? Each hanji ~ fs_px wide."""
    w = CONTAINER_W - pad_left_px
    chars_per_line = max(1, int(w / fs_px))
    return max(1, (len(text) + chars_per_line - 1) // chars_per_line)

def mixed_lines(text: str, fs_px: float, *, pad_left_px: float = 0) -> int:
    """Mixed hanji + latin (for definitions). Approx avg char width = 0.7 * fs."""
    w = CONTAINER_W - pad_left_px
    avg_char = fs_px * 0.7
    chars_per_line = max(1, int(w / avg_char))
    return max(1, (len(text) + chars_per_line - 1) // chars_per_line)

def loma_lines(text: str, fs_px: float, *, pad_left_px: float = 0) -> int:
    w = CONTAINER_W - pad_left_px
    chars_per_line = max(1, int(w / (fs_px * 0.55)))
    return max(1, (len(text) + chars_per_line - 1) // chars_per_line)

# ------------------------ unit height models ------------------------

def head_unit_h(hanji: str, loma: str, meaning_def: str | None,
                meaning_pos: str | None, entry_gap_pt: float) -> float:
    """單元一 = entry head (hanji 16pt + loma 10pt) + first meaning (default 14px)."""
    h = entry_gap_pt * PT  # margin-top
    # Inner two-column block: index col + words col
    # words col includes hanji (16pt * 1.2) + loma (10pt * 1.2 default? — uses div default ~1.2)
    hanji_fs = 16 * PT
    hanji_lh = hanji_fs * 1.2  # line-height:1.2 on hanji div
    h += hanji_lh * hanji_lines(hanji, hanji_fs, pad_left_px=18 * PT + 6 * PT)
    loma_fs = 10 * PT
    loma_lh = loma_fs * 1.4  # falls through to container line-height:1.4
    h += loma_lh * loma_lines(loma, loma_fs, pad_left_px=18 * PT + 6 * PT)
    if meaning_def is not None:
        # margin:3pt 0 0 22pt — top margin 3pt
        h += 3 * PT
        # font-size: container default 14px, line-height 1.4
        def_fs = 14
        def_lh = def_fs * 1.4
        # left indent 22pt
        h += def_lh * mixed_lines(meaning_def, def_fs, pad_left_px=22 * PT)
    return h

def later_meaning_h(meaning_def: str) -> float:
    """單元二 = subsequent meaning, margin:3pt 0 0 22pt, font 14px."""
    h = 3 * PT  # margin-top
    def_fs = 14
    def_lh = def_fs * 1.4
    h += def_lh * mixed_lines(meaning_def, def_fs, pad_left_px=22 * PT)
    return h

def example_h(hanji: str, loma: str, mandarin: str | None) -> float:
    """單元三 = example, margin:2pt 0 0 36pt, font 9.5pt."""
    h = 2 * PT  # margin-top
    line_fs_px = 9.5 * PT  # ≈ 12.66px
    line_lh = line_fs_px * 1.4
    # First line: hanji + loma inline, same div, so wraps together
    # Mixed approx; left pad 36pt
    combined = hanji + ' ' + loma
    h += line_lh * mixed_lines(combined, line_fs_px, pad_left_px=36 * PT)
    if mandarin:
        mand_fs = 9 * PT
        mand_lh = mand_fs * 1.4
        h += mand_lh * mixed_lines(mandarin, mand_fs, pad_left_px=36 * PT)
    return h

# ------------------------ build sequence ------------------------

def simulate(db_path: str, entry_ids: list[int]):
    c = sqlite3.connect(db_path)

    # Fetch entries with meanings + examples (preserving JSON manifest order)
    entries = []
    for eid in entry_ids:
        row = c.execute('SELECT id, hanji, loma FROM entries WHERE id=?', (eid,)).fetchone()
        if not row:
            print(f'!! entry {eid} not found')
            continue
        meanings = list(c.execute(
            'SELECT meaning_id, pos, definition FROM meanings WHERE entry_id=? ORDER BY meaning_id', (eid,)
        ))
        examples = list(c.execute(
            'SELECT meaning_id, seq, hanji, loma, mandarin FROM examples WHERE entry_id=? ORDER BY meaning_id, seq', (eid,)
        ))
        entries.append(dict(id=row[0], hanji=row[1], loma=row[2], meanings=meanings, examples=examples))

    # Header: h1 (20pt bold) + count div (9pt, margin 12pt)
    cursor_y = 0.0
    # h1
    h1_lh = 20 * PT * 1.2
    cursor_y += h1_lh
    cursor_y += 4 * PT  # h1 margin-bottom
    # count div
    count_lh = 9 * PT * 1.4
    cursor_y += count_lh
    cursor_y += 12 * PT  # count margin-bottom

    print(f'Header: y={cursor_y:.1f}px')

    units = []  # list of (start_y, height, label, source_text)

    for i, e in enumerate(entries):
        entry_gap = 0 if i == 0 else 10
        first_m = e['meanings'][0] if e['meanings'] else None
        rest_m = e['meanings'][1:] if e['meanings'] else []

        # 單元一
        first_def = first_m[2] if first_m else None
        first_pos = first_m[1] if first_m else None
        h = head_unit_h(e['hanji'], e['loma'], first_def, first_pos, entry_gap)
        units.append((cursor_y, h, 'head', f"E{i+1} {e['hanji']} {e['loma']}"))
        cursor_y += h

        # 單元三 (first meaning examples)
        if first_m:
            first_mid = first_m[0]
            for ex in e['examples']:
                if ex[0] != first_mid:
                    continue
                h = example_h(ex[2], ex[3], ex[4])
                units.append((cursor_y, h, 'example',
                              f"E{i+1}.m{first_mid}.ex{ex[1]} {ex[2][:20]}"))
                cursor_y += h

        # 單元二 + their examples
        for idx, m in enumerate(rest_m):
            h = later_meaning_h(m[2])
            units.append((cursor_y, h, 'meaning', f"E{i+1}.m{m[0]} #{idx+2}"))
            cursor_y += h
            for ex in e['examples']:
                if ex[0] != m[0]:
                    continue
                h = example_h(ex[2], ex[3], ex[4])
                units.append((cursor_y, h, 'example',
                              f"E{i+1}.m{m[0]}.ex{ex[1]} {ex[2][:20]}"))
                cursor_y += h

    return units

def find_breaks(units, *, page_h=PAGE_INNER):
    """Apply runtime page-break algorithm. Returns list of (page_top_offset, break_at_unit_idx, blank_bottom_px)."""
    page_top = 0.0
    breaks = []
    for i, (top, h, label, src) in enumerate(units):
        rel_bottom = (top + h) - page_top
        if rel_bottom > page_h and top > page_top:
            blank_bottom = page_h - (top - page_top)
            breaks.append((page_top, i, blank_bottom, top, label, src))
            page_top = top
    return breaks

if __name__ == '__main__':
    DB = r'C:\CS projects\kitty_dict\static\dict\dictionary.db'
    MANIFEST = r'C:\CS projects\kitty_dict\data\great700.json'
    d = json.load(open(MANIFEST, encoding='utf-8'))
    items = d['lists'][0]['items']
    # ALL entries in list 001-100
    entry_ids = []
    for it in items:
        for eid in it['entry_ids']:
            entry_ids.append(eid)

    # Just first 6 entries (enough to see 仔 (entry 4) and a couple after)
    eids_subset = entry_ids[:6]
    print(f'Simulating entries {eids_subset}')
    units = simulate(DB, eids_subset)

    print()
    print(f'{"#":>3} {"top":>7} {"h":>7} {"bot":>7}  type      source')
    print('-' * 80)
    for i, (top, h, label, src) in enumerate(units):
        print(f'{i:>3} {top:>7.1f} {h:>7.1f} {top+h:>7.1f}  {label:9} {src}')

    print()
    breaks = find_breaks(units)
    print(f'{len(breaks)} page-breaks predicted')
    for (pt, idx, blank, top, label, src) in breaks:
        print(f'  break before unit #{idx} ({label}) @ y={top:.1f}; '
              f'pageTop was {pt:.1f}; blank-bottom={blank:.1f}px; '
              f'"{src}"')

    # Also dump where each unit lands by PDF page
    print()
    print('=== Per-unit page assignment ===')
    page_top = 0.0
    page_no = 1
    break_idxs = {b[1] for b in breaks}
    for i, (top, h, label, src) in enumerate(units):
        if i in break_idxs:
            page_no += 1
            # find this break in `breaks` list to retrieve new pageTop
            for b in breaks:
                if b[1] == i:
                    page_top = b[3]  # top of unit becomes new page-top
                    break
        rel = top - page_top
        print(f'  unit#{i:3d} page={page_no} relY={rel:>7.1f} h={h:>6.1f}  {label:9} {src}')
