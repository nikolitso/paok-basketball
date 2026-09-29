"""Add a non-league game (Super Cup, Greek Cup, playoffs...) from its esake.gr link.

Usage:
  python scripts/add_game.py "https://www.esake.gr/el/action/EsakegameView?idgame=04920552&mode=3" --comp "Greek Super Cup" --round "Final"
Then run scripts/update_gbl.py (the GitHub Action does this automatically).
Regular-season league games are picked up automatically and don't need this.
"""
import argparse
import json
import os
import re

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

ap = argparse.ArgumentParser()
ap.add_argument("url")
ap.add_argument("--comp", required=True, help='e.g. "Greek Super Cup", "Greek Cup", "GBL Playoffs"')
ap.add_argument("--round", default="", help='e.g. "Semi-final", "Final", "Quarter-final G1"')
ap.add_argument("--neutral", action="store_true", help="played at a neutral venue")
a = ap.parse_args()

m = re.search(r"idgame=([0-9A-Fa-f]+)", a.url)
if not m:
    raise SystemExit("Could not find idgame=... in that URL")
path = os.path.join(DATA, "extra_games.json")
games = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else []
games = [g for g in games if g["id"] != m.group(1).upper()]
games.append({"id": m.group(1).upper(), "comp": a.comp, "round": a.round, "neutral": a.neutral})
with open(path, "w", encoding="utf-8") as f:
    json.dump(games, f, ensure_ascii=False, indent=1)
print(f"Added {m.group(1)} ({a.comp} {a.round}). Now run: python scripts/update_gbl.py")
