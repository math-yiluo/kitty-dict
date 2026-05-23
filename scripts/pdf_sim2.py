"""Dump actual definitions + examples for entries 1..4 to see real text lengths."""
import sqlite3, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, 'utf-8')

DB = r'C:\CS projects\kitty_dict\static\dict\dictionary.db'
MANIFEST = r'C:\CS projects\kitty_dict\data\great700.json'

d = json.load(open(MANIFEST, encoding='utf-8'))
items = d['lists'][0]['items']
entry_ids = []
for it in items[:6]:
    for eid in it['entry_ids']:
        entry_ids.append(eid)

print(f'Entries: {entry_ids}')

c = sqlite3.connect(DB)
for i, eid in enumerate(entry_ids):
    row = c.execute('SELECT id, hanji, loma FROM entries WHERE id=?', (eid,)).fetchone()
    if not row: continue
    print(f"\n=== E{i+1}: id={row[0]}  hanji={row[1]}  loma={row[2]} ===")
    meanings = list(c.execute(
        'SELECT meaning_id, pos, definition FROM meanings WHERE entry_id=? ORDER BY meaning_id', (eid,)))
    examples = list(c.execute(
        'SELECT meaning_id, seq, hanji, loma, mandarin FROM examples WHERE entry_id=? ORDER BY meaning_id, seq', (eid,)))
    print(f"  {len(meanings)} meanings, {len(examples)} examples")
    for m in meanings:
        print(f"  m{m[0]} pos={m[1]} def-len={len(m[2])}  '{m[2][:80]}{'...' if len(m[2])>80 else ''}'")
    for ex in examples:
        mand_len = len(ex[4]) if ex[4] else 0
        print(f"  m{ex[0]}.ex{ex[1]}  hanji({len(ex[2])}+loma({len(ex[3])})={len(ex[2])+1+len(ex[3])}  mand({mand_len})  '{ex[2]}' / '{ex[4][:50] if ex[4] else None}'")
