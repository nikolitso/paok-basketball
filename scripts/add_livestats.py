"""Link a FIBA LiveStats box score to its Greek League game, so the result shows up
before ESAKE posts it.

Usage:
  python scripts/add_livestats.py https://fibalivestats.dcd.shared.geniussports.com/u/ESAKE/2902681/bs.html
Then run scripts/update_gbl.py (the GitHub Action does this automatically).
"""
import json
import os
import re
import sys
import urllib.request

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

m = re.search(r"/(\d{5,})/", sys.argv[1] + "/") if len(sys.argv) > 1 else None
if not m:
    raise SystemExit("Usage: python scripts/add_livestats.py <fibalivestats link>")
fls_id = m.group(1)

url = f"https://fibalivestats.dcd.shared.geniussports.com/data/{fls_id}/data.json"
with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
    d = json.load(r)
names = [d["tm"][k]["name"] for k in ("1", "2")]
if not any("PAOK" in n.upper() for n in names):
    raise SystemExit(f"Not a PAOK game: {names}")
opp_name = next(n for n in names if "PAOK" not in n.upper()).lower()

with open(os.path.join(DATA, "gbl.json"), encoding="utf-8") as f:
    games = [g for g in json.load(f)["games"] if g["comp"] == "GBL"]
matches = [g for g in games if g["opp"].lower().split()[0] in opp_name]
if not matches:
    raise SystemExit(f"No Greek League game found against {opp_name}")
# the earliest one not yet played (or the last one, if both meetings are done)
game = next((g for g in matches if not g["played"]), matches[-1])

path = os.path.join(DATA, "livestats.json")
links = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
links[game["code"]] = fls_id
with open(path, "w", encoding="utf-8") as f:
    json.dump(links, f, indent=1)
print(f"Linked LiveStats {fls_id} to {game['round']} vs {game['opp']} ({names[0]} {d['tm']['1']['score']}-{d['tm']['2']['score']} {names[1]})")
