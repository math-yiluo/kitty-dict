"""
Generate a self-contained cross-validation audit prompt for an external LLM.

Includes:
  - Section A: all 27 manually-curated mappings (the original audit set)
  - Section B: 8 auto-A mappings where MULTIPLE dict candidates satisfied the
               hanji+loma filter (script picked the first; was that right?)
  - Section C: 6 PDF-row pairs that share (hanji, loma) and ended up mapped to
               the SAME entry_id — known PDF-vs-dict granularity issue, flagged
               for transparency
  - Section D: random sample of 10 auto-A items whose chosen dict entry has a
               tag (e.g. 【替】/【白】/【文】) so the LLM can verify the
               tag-stripping logic
"""
from __future__ import annotations

import io
import json
import random
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST = REPO_ROOT / "data" / "great700.json"
DB_PATH = REPO_ROOT / "static" / "dict" / "dictionary.db"
OUTPUT = REPO_ROOT / "data" / "audit_prompt.md"

TAG_RE = re.compile(r"【[^】]*】")
def norm_hanji(h): return TAG_RE.sub("", h or "").strip()
def norm_loma_set(l):
    if not l: return set()
    return {p.strip() for p in TAG_RE.sub("", l).split("/") if p.strip()}

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    all_dict = cur.execute("SELECT id, hanji, loma FROM entries").fetchall()
    id_to_row = {r[0]: r for r in all_dict}
    by_nh = defaultdict(list)
    for rid, h, l in all_dict:
        by_nh[norm_hanji(h)].append((rid, h, l))

    def get_meanings(eid):
        return cur.execute("SELECT pos, definition FROM meanings WHERE entry_id = ? ORDER BY meaning_id", (eid,)).fetchall()
    def get_first_example(eid):
        return cur.execute("SELECT hanji, loma, mandarin FROM examples WHERE entry_id = ? ORDER BY meaning_id, seq LIMIT 1", (eid,)).fetchone()

    def render_entry(eid, indent="  "):
        row = id_to_row.get(eid)
        if not row:
            return [f"{indent}- ⚠️ entry_id={eid} 不在字典裡"]
        rid, h, l = row
        out = [
            f"{indent}- **entry id={eid}**",
            f"{indent}  - hanji: `{h}`",
            f"{indent}  - loma:  `{l}`",
        ]
        ms = get_meanings(eid)
        if ms:
            out.append(f"{indent}  - 義項:")
            for pos, defn in ms[:3]:
                ps = f"**[{pos}]** " if pos else ""
                d = (defn or "").replace("\n", " ")[:120]
                out.append(f"{indent}    - {ps}{d}")
            if len(ms) > 3:
                out.append(f"{indent}    - (還有 {len(ms)-3} 個義項)")
        ex = get_first_example(eid)
        if ex:
            mand = (ex[2] or "").replace("\n", " ")[:50]
            out.append(f"{indent}  - 例句: {ex[0]} （{ex[1]}）— {mand}")
        return out

    all_items = [it for L in data["lists"] for it in L["items"]]
    auto_items = [it for it in all_items if it["source"].startswith("auto")]
    manual_items = sorted([it for it in all_items if it["source"] == "manual"], key=lambda x: x["pdf_num"])

    # Build sections
    out = []

    out += [
        "# Cross-validation audit: 教育部 700 字推薦用字 → 字典 entry_id mapping",
        "",
        "## 任務背景",
        "",
        "我（提問者）正在開發一個臺灣台語學習 app，資料底層是教育部「臺灣台語常用詞辭典」（kautian.ods, 共 29,607 個詞條，每個詞條有 hanji 漢字、loma 羅馬字、義項定義、例句等欄位）。",
        "",
        "另外教育部還公布了一份「臺灣台語推薦用字 700 字表」PDF — 從台語中挑選 700 個高頻常用字，並指定每個字的標準寫法（建議用字）+ 標準發音（音讀）。",
        "",
        "我的目標是把這 700 個 PDF 詞條全部 map 到字典裡對應的 entry_id，以便在 app 內做成 7 張「偉大的 700 字」內置表單。",
        "",
        "## 字典欄位格式",
        "",
        "字典的 hanji / loma 欄位帶有元資料標記，請注意：",
        "",
        "- `【替】` = 該字是「替代用字」（教育部選的代用漢字，可能非本字）",
        "- `【白】` = 白話音讀法",
        "- `【文】` = 文讀音讀法",
        "- loma 字段常見格式 `形式A/形式B` 表示**多種讀音合並儲存**在同一 entry 裡（不是兩個 entry）",
        "",
        "匹配時規則：tag 應該被剝除後比對；loma 多形式按 `/` 拆成集合，PDF loma 跟字典 loma 集合有交集即視為符合。",
        "",
        "## 我的 pipeline 簡述",
        "",
        "1. 從 PDF 提取 700 條 (pdf_num, pdf_hanji, pdf_loma)",
        "2. **A 類自動匹配**：normalised hanji 完全相符 + loma 集合有交集 → 自動 take。673 條走此路徑。",
        "3. **手動指定**：A 類失敗的 27 條（hanji 不在字典、多候選無 loma 對應、純粹字典沒收等），由我（人類）逐條挑選 entry_id。",
        "4. 最終產出 `great700.json` 內含 700 PDF row → 701 entry_id（#59 一對二）",
        "",
        "## 你的任務",
        "",
        "請對下面 **4 個 section** 的 mapping 評估合理性：",
        "",
        "- **Section A**：27 條手動 mapping（高風險，最需要審）",
        "- **Section B**：8 條 auto-A 多候選 mapping — 腳本自動取了第一個 satisfying entry，請判斷選對沒",
        "- **Section C**：6 對 PDF row 共用同一 entry_id — 已知 PDF 粒度 > 字典粒度，僅供告知，無需 verdict",
        "- **Section D**：10 個 auto-A 帶 tag（【替】/【白】/【文】）抽樣，請檢查 tag 處理邏輯是否合理",
        "",
        "**評估標準**：",
        "- ✓ Reasonable — mapping 合理",
        "- ⚠ Questionable — 可能有更好選擇，說明原因",
        "- ✗ Wrong — mapping 不對，建議該怎麼選",
        "",
        "**請特別關注**：",
        "- Section A 中 4 個字典完全沒收的（029 茉莉、105 現出、202 咳啾、573 杜蚓）— 我選了「最接近的相關詞條」做代用",
        "- Section B 中「【替】vs 無 tag」的選擇 — 兩者都能匹配時哪個更對",
        "- #59 一條 PDF map 到兩個 entry_id 是刻意設計（兩個同義詞條一起呈現）",
        "",
        "---",
        "",
        "## Section A — 27 條手動 mapping",
        "",
    ]

    for it in manual_items:
        out.append(f"### #{it['pdf_num']:03d}　{it['pdf_hanji']}　/　{it['pdf_loma']}")
        out.append("")
        out.append(f"- **指定 entry_id**: `{it['entry_ids']}`")
        out.append("")
        for de in it["dict_entries"]:
            out += render_entry(de["id"])
        out.append("")

    # === Section B: auto-A multi-candidate ===
    out += [
        "---",
        "",
        "## Section B — 8 條 auto-A 多候選 mapping（腳本取第一個 satisfying entry）",
        "",
        "對每條，腳本看到字典裡有多個 entry 的 (normalised hanji, loma 集合) 都跟 PDF 對得上，按掃描順序取了第一個。請判斷選對沒。",
        "",
    ]
    multi_cand_cases = []
    for it in auto_items:
        pdf_lomas = norm_loma_set(it["pdf_loma"])
        candidates = [r for r in by_nh.get(norm_hanji(it["pdf_hanji"]), []) if norm_loma_set(r[2]) & pdf_lomas]
        if len(candidates) > 1:
            multi_cand_cases.append((it, candidates))

    for it, cands in multi_cand_cases:
        chosen = it["entry_ids"][0]
        out.append(f"### #{it['pdf_num']:03d}　{it['pdf_hanji']}　/　{it['pdf_loma']}")
        out.append("")
        out.append(f"- **腳本選**: entry_id=`{chosen}`")
        out.append(f"- **所有 satisfying candidates** (共 {len(cands)} 個):")
        out.append("")
        for rid, h, l in cands:
            mark = " ← chosen" if rid == chosen else ""
            out.append(f"  **entry id={rid}{mark}**")
            out.append(f"  - hanji: `{h}`, loma: `{l}`")
            ms = get_meanings(rid)
            if ms:
                for pos, defn in ms[:2]:
                    ps = f"[{pos}] " if pos else ""
                    d = (defn or "").replace("\n", " ")[:100]
                    out.append(f"  - {ps}{d}")
            out.append("")
        out.append("")

    # === Section C: PDF rows sharing same (hanji, loma) ===
    out += [
        "---",
        "",
        "## Section C — 6 對 PDF row 共用同一 entry_id（已知粒度限制，僅供告知）",
        "",
        "教育部 700 字表裡有 6 對 PDF 編號是「同字同音但收錄為兩個編號」（PDF 第 5 欄『對應華語』不同 → 表示兩個編號代表同字的兩個義項）。但字典裡這個字音組合通常只有一個 entry 容納所有義項 → 我的 manifest 中兩個 PDF row 都映射到同一 entry_id（list 內該 entry 出現兩次）。",
        "",
        "**這不需要 verdict**，只是讓你了解為何 entry 數 ≠ PDF row 數時是這個原因（除了 #59 一對二）。",
        "",
    ]
    seen_pairs = defaultdict(list)
    for it in all_items:
        seen_pairs[(it["pdf_hanji"], it["pdf_loma"])].append(it)
    shared = {k: v for k, v in seen_pairs.items() if len(v) > 1}
    for (h, l), items in shared.items():
        eids = items[0]["entry_ids"][0]
        nums = ", ".join(f"#{it['pdf_num']:03d}" for it in items)
        out.append(f"- **{h}** / **{l}** → entry_id=`{eids}` — 由 {nums} 共用")

    # === Section D: random sample of tagged auto-A ===
    out += [
        "",
        "---",
        "",
        "## Section D — 10 個帶 tag 的 auto-A 抽樣（檢查 tag 處理邏輯）",
        "",
        "字典裡 154 個 auto-A 條目的 chosen entry hanji 帶 `【替】/【白】/【文】` 等 tag。這 154 個大部分情境是「字典只有 tag 版本可用」（沒有不帶 tag 的同字 entry）。請抽樣 10 個確認 tag 處理邏輯合理（即：剝 tag 後跟 PDF 對得上）。",
        "",
    ]
    tagged = []
    for it in auto_items:
        eid = it["entry_ids"][0]
        h = id_to_row.get(eid, (None, "", ""))[1]
        if "【" in h:
            tagged.append((it, eid, h))
    random.seed(42)
    sample = random.sample(tagged, min(10, len(tagged)))
    sample.sort(key=lambda x: x[0]["pdf_num"])
    for it, eid, dh in sample:
        out.append(f"### #{it['pdf_num']:03d}　PDF: {it['pdf_hanji']} / {it['pdf_loma']}")
        out.append("")
        out.append(f"- **腳本選**: entry_id=`{eid}` (hanji=`{dh}`)")
        out += render_entry(eid)
        out.append("")

    # === Expected output ===
    out += [
        "---",
        "",
        "## 期望輸出格式",
        "",
        "對每個 section 給一個 markdown 表格：",
        "",
        "```",
        "## Section A verdicts",
        "| PDF # | Verdict | 理由（如非 ✓） |",
        "|------:|--------:|---------------|",
        "| 029   | ⚠       | 字典「茉莉花」是植物名… |",
        "| ...   | ...     | ... |",
        "```",
        "",
        "Section C 跳過（已知限制，無需 verdict）。",
        "",
        "**最後給一個整體總結**：",
        "- Section A：x 條 ✓、y 條 ⚠、z 條 ✗",
        "- Section B：x 條 ✓、y 條 ⚠、z 條 ✗",
        "- Section D：x 條 ✓、y 條 ⚠、z 條 ✗",
        "- Top-3 最需要重新檢視的條目",
    ]

    OUTPUT.write_text("\n".join(out), encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    print(f"  chars: {sum(len(l)+1 for l in out)}")
    print(f"  lines: {len(out)}")
    print(f"  Section A: 27 items")
    print(f"  Section B: {len(multi_cand_cases)} items")
    print(f"  Section C: {len(shared)} pairs")
    print(f"  Section D: {len(sample)} sampled items")

if __name__ == "__main__":
    main()
