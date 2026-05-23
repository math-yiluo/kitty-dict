"""Simulate with PESSIMISTIC heights — maybe real rendered heights are larger
than my model. Try a 1.5x and 2x multiplier to see what would push 仔 off page 1."""
import sqlite3, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, 'utf-8')

PT = 1.333
CONTAINER_W = 718
PAGE_INNER = 1046

DB = r'C:\CS projects\kitty_dict\static\dict\dictionary.db'
MANIFEST = r'C:\CS projects\kitty_dict\data\great700.json'

d = json.load(open(MANIFEST, encoding='utf-8'))
items = d['lists'][0]['items']
entry_ids = [eid for it in items for eid in it['entry_ids']]

c = sqlite3.connect(DB)

def fetch_entry(eid):
    row = c.execute('SELECT hanji, loma FROM entries WHERE id=?', (eid,)).fetchone()
    if not row: return None
    m = list(c.execute('SELECT meaning_id, pos, definition FROM meanings WHERE entry_id=? ORDER BY meaning_id', (eid,)))
    e = list(c.execute('SELECT meaning_id, seq, hanji, loma, mandarin FROM examples WHERE entry_id=? ORDER BY meaning_id, seq', (eid,)))
    return dict(hanji=row[0], loma=row[1], meanings=m, examples=e)

def head_h(hanji, loma, def_text, mult):
    h = 0
    h += (16 * PT * 1.2) * mult  # hanji line
    h += (10 * PT * 1.4) * mult  # loma line
    if def_text:
        h += 3 * PT * mult
        def_fs = 14
        # CJK pure: width per char ≈ 14
        chars_per_line = max(1, int((CONTAINER_W - 29) / 14))
        n_lines = max(1, (len(def_text) + chars_per_line - 1) // chars_per_line)
        h += (def_fs * 1.4 * mult) * n_lines
    return h

def meaning_h(def_text, mult):
    h = 3 * PT * mult
    chars_per_line = max(1, int((CONTAINER_W - 29) / 14))
    n_lines = max(1, (len(def_text) + chars_per_line - 1) // chars_per_line)
    h += (14 * 1.4 * mult) * n_lines
    return h

def example_h(hanji, loma, mand, mult):
    h = 2 * PT * mult
    chars_per_line = max(1, int((CONTAINER_W - 48) / (9.5 * PT)))
    combined_len = len(hanji) + 1 + len(loma)
    n_lines = max(1, (combined_len + chars_per_line - 1) // chars_per_line)
    h += (9.5 * PT * 1.4 * mult) * n_lines
    if mand:
        n_mand = max(1, (len(mand) + chars_per_line - 1) // chars_per_line)
        h += (9 * PT * 1.4 * mult) * n_mand
    return h

def simulate_entries(ids, mult):
    # Header
    y = 0
    y += (20 * PT * 1.4 * mult)  # h1, line-height inherited 1.4
    y += 4 * PT * mult           # h1 margin-bottom
    y += (9 * PT * 1.4 * mult)   # count
    y += 12 * PT * mult          # count margin-bottom
    print(f"[mult={mult}] header ends at y={y:.1f}")

    units = []
    for i, eid in enumerate(ids):
        e = fetch_entry(eid)
        if not e: continue
        gap = 0 if i == 0 else (10 * PT * mult)
        y += gap

        # 單元一
        first_m = e['meanings'][0] if e['meanings'] else None
        h = head_h(e['hanji'], e['loma'], first_m[2] if first_m else None, mult)
        units.append((y, h, 'head', f"E{i+1} {e['hanji']} {e['loma']}"))
        y += h

        # First-meaning examples
        if first_m:
            first_mid = first_m[0]
            for ex in e['examples']:
                if ex[0] != first_mid: continue
                h = example_h(ex[2], ex[3], ex[4], mult)
                units.append((y, h, 'example', f"E{i+1}.m{first_mid}.ex{ex[1]} {ex[2][:15]}"))
                y += h

        # 單元二
        for idx, m in enumerate(e['meanings'][1:]):
            h = meaning_h(m[2], mult)
            units.append((y, h, 'meaning', f"E{i+1}.m{m[0]} #{idx+2}"))
            y += h
            for ex in e['examples']:
                if ex[0] != m[0]: continue
                h = example_h(ex[2], ex[3], ex[4], mult)
                units.append((y, h, 'example', f"E{i+1}.m{m[0]}.ex{ex[1]} {ex[2][:15]}"))
                y += h

    return units

def apply_breaks(units, page_h=PAGE_INNER):
    page_top = 0.0
    breaks = []
    page_assign = []
    page_no = 1
    for i, (top, h, lbl, src) in enumerate(units):
        rel_bottom = (top + h) - page_top
        if rel_bottom > page_h and top > page_top:
            blank = page_h - (top - page_top)
            breaks.append((page_no, i, top, blank, lbl, src))
            page_top = top
            page_no += 1
        page_assign.append((page_no, top - page_top, h, lbl, src))
    return breaks, page_assign

# Try multipliers
eids_subset = entry_ids[:8]
print(f'Testing with entries {eids_subset}')
print()

for mult in [1.0, 1.3, 1.6, 2.0, 2.4]:
    print(f'=== Multiplier {mult}x ===')
    units = simulate_entries(eids_subset, mult)
    breaks, _ = apply_breaks(units)
    # find where E4 (仔) lands
    e4_unit = next((i for i, (t,h,lbl,src) in enumerate(units) if src.startswith('E4 ')), None)
    if e4_unit is None:
        print('  E4 not found')
        continue
    top, h, lbl, src = units[e4_unit]
    # figure E4 page
    page = 1
    page_top = 0
    for (pn, idx, t, blk, _, _) in breaks:
        if idx <= e4_unit:
            page = pn + 1
            page_top = t
    rel_y_on_page = top - page_top
    print(f'  E4 head: abs_y={top:.0f} h={h:.0f}  → page {page} at relY={rel_y_on_page:.0f}')
    if breaks:
        # Was there a break right before E4?
        break_just_before_e4 = next((b for b in breaks if b[1] == e4_unit), None)
        if break_just_before_e4:
            pn, idx, t, blk, lbl, src = break_just_before_e4
            print(f'  ★ Break inserted RIGHT BEFORE E4 (仔). Blank-bottom on prev page = {blk:.0f}px')
        else:
            # any breaks?
            for (pn, idx, t, blk, _, src) in breaks:
                print(f'    break #{pn-0} before unit#{idx} (blank={blk:.0f}px) "{src}"')
    print()
