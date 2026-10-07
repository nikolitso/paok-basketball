"""Add PAOK players' plus/minus to a game from a play-by-play export (Excel, as downloaded from
FIBA LiveStats / ESAKE), for games whose box score doesn't include +/- (e.g. ESAKE pages).

Usage:
  python scripts/import_pbp.py <play-by-play.xlsx> <esake game id>
  python scripts/update_gbl.py

The sheet needs columns: Time, Score, <home team>, <away team>, Game Actions. Each event sits in its team's column;
"entered the court" / "left the court" rows give the lineups and the Score column ("home-away") changes on baskets.
The +/- is written into the cached box score (data/gbl_box/<id>.json); a copy of the sheet is kept in data/pbp/.
"""
import io
import json
import os
import re
import shutil
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def surname(name):
    return name.lower().replace("-", " ").split()[-1]


def player_of(text):
    """'(33) Nick CALATHES entered the court' -> 'calathes'."""
    m = re.match(r"\(\d+\)\s+(.+?)\s+(entered|left) the court", text.strip())
    return surname(m.group(1)) if m else None


def plus_minus(path):
    ws = openpyxl.load_workbook(io.BytesIO(open(path, "rb").read()), data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    header = [str(h or "") for h in rows[0]]
    paok_col = next(i for i, h in enumerate(header) if "PAOK" in h.upper())
    team_cols = [i for i, h in enumerate(header) if h and h not in ("Time", "Score", "Game Actions")]
    paok_first = team_cols.index(paok_col) == 0  # score is "first team - second team"
    on, pm, last = set(), {}, (0, 0)
    for r in rows[1:]:
        text = r[paok_col]
        if text:
            who = player_of(str(text))
            if who and "entered the court" in text:
                on.add(who)
                pm.setdefault(who, 0)
            elif who and "left the court" in text:
                on.discard(who)
        if r[1]:
            a, b = (int(x) for x in str(r[1]).split("-"))
            us, them = (a, b) if paok_first else (b, a)
            delta = (us - last[0]) - (them - last[1])
            for p in on:
                pm[p] += delta
            last = (us, them)
    return pm, last


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    path, gid = sys.argv[1], sys.argv[2].upper()
    pm, final = plus_minus(path)
    box_path = os.path.join(ROOT, "data", "gbl_box", f"{gid}.json")
    with open(box_path, encoding="utf-8") as f:
        box = json.load(f)
    if (box["team"]["pts"], box["opp"]["pts"]) != final:
        raise SystemExit(f"Score mismatch: sheet ends {final}, box score {box['team']['pts']}-{box['opp']['pts']}")
    matched = 0
    for p in box["players"]:
        if surname(p["name"]) in pm:
            p["pm"] = pm[surname(p["name"])]
            matched += 1
        elif p.get("sec"):
            print("no +/- found for", p["name"])
    with open(box_path, "w", encoding="utf-8") as f:
        json.dump(box, f, ensure_ascii=False, indent=1)
    os.makedirs(os.path.join(ROOT, "data", "pbp"), exist_ok=True)
    shutil.copy(path, os.path.join(ROOT, "data", "pbp", f"{gid}.xlsx"))
    margin = final[0] - final[1]
    print(f"{gid}: +/- for {matched} players, final {final[0]}-{final[1]}; "
          f"check: sum of +/- = {sum(pm.values())} (should be 5 x {margin} = {5 * margin})")
    for name, v in sorted(pm.items(), key=lambda kv: -kv[1]):
        print(f"  {name:15s} {v:+d}")


if __name__ == "__main__":
    main()
