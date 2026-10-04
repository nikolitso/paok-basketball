"""League-wide team stats and averages for the EuroCup and the Greek League -> data/league.json.

Run after update_eurocup.py and update_gbl.py:  python scripts/league.py
Every played game in each competition is downloaded once and cached in data/league_cache/.
"""
import json
import os
import re
from datetime import datetime, timedelta, timezone

import update_eurocup as ec
import update_gbl as gbl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(DATA, "league_cache")
KEYS = ("pts", "fg2m", "fg2a", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "tov", "blk", "pf", "pir")


def cached(key, build):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{key}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    value = build()
    if value:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False)
    return value


def side(name, total, players):
    return {"team": name, "total": {k: int(total.get(k, 0) or 0) for k in KEYS},
            "sec": sum(int(p.get("sec") or 0) for p in players)}


# ---------- EuroCup ----------

def eurocup_games():
    out = []
    games = [g for g in ec.get("/games")["data"] if g["played"]]
    for g in games:
        def build(g=g):
            raw = ec.get(f"/games/{g['gameCode']}/stats")
            sides = []
            for key in ("local", "road"):
                players = [ec.norm_player_stats(p) for p in raw[key]["players"]]
                sides.append(side(ec.club_name(g[key]["club"]), ec.norm_totals(raw[key]["total"]), players))
            return {"group": g["group"]["name"], "sides": sides}
        out.append(cached(f"U_{g['gameCode']}", build))
    return out


# ---------- Greek League (ESAKE) ----------

def gbl_games():
    with open(os.path.join(DATA, "gbl.json"), encoding="utf-8") as f:
        sched = json.load(f)["games"]
    now = datetime.now(timezone.utc)
    rounds = sorted({int(g["round"].split()[-1]) for g in sched if g["comp"] == "GBL" and g["date"] and g["date"].endswith("Z")
                     and datetime.fromisoformat(g["date"].replace("Z", "+00:00")) < now - timedelta(hours=2)})
    out = []
    for r in rounds:
        page = gbl.fetch(f"EsakeResults?idchampionship={gbl.CHAMPIONSHIP}&idseason=00000001&series={r:02d}")
        for gid in dict.fromkeys(re.findall(r"idgame=([0-9A-F]+)&mode=3", page.split("esake-news-box")[0])):
            path = os.path.join(CACHE, f"GBL_{gid}.json")
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    out.append(json.load(f))
                continue
            g = gbl.parse_game(gid)
            if not (g["hs"] or g["as"]) or len(g["teams"]) < 2:
                continue  # not played yet
            game = {"group": "", "sides": [side(gbl.team_name(t["name"]), t["total"], t["players"]) for t in g["teams"]]}
            out.append(cached(f"GBL_{gid}", lambda game=game: game))
    return out


# ---------- aggregation ----------

def poss_of(t):
    return t["fg2a"] + t["fg3a"] - t["oreb"] + t["tov"] + 0.44 * t["fta"]


def summarize(rows):
    """rows: list of (own total, opp total, game minutes, won). Returns per-game stats and rates."""
    n = len(rows)
    tot = lambda i, k: sum(r[i][k] for r in rows)
    poss = sum((poss_of(r[0]) + poss_of(r[1])) / 2 for r in rows)
    mins = sum(r[2] for r in rows)
    fga, fgm = tot(0, "fg2a") + tot(0, "fg3a"), tot(0, "fg2m") + tot(0, "fg3m")
    pct = lambda m, a: round(100 * m / a, 1) if a else None
    s = {k: round(tot(0, k) / n, 1) for k in KEYS}
    s.update({
        "gp": n, "w": sum(1 for r in rows if r[3]), "allowed": round(tot(1, "pts") / n, 1),
        "fgp": pct(fgm, fga), "fg2p": pct(tot(0, "fg2m"), tot(0, "fg2a")), "fg3p": pct(tot(0, "fg3m"), tot(0, "fg3a")),
        "ftp": pct(tot(0, "ftm"), tot(0, "fta")),
        "opp_fgp": pct(tot(1, "fg2m") + tot(1, "fg3m"), tot(1, "fg2a") + tot(1, "fg3a")),
        "poss": round(poss / n, 1), "pace": round(poss * 40 / mins, 1) if mins else None,
        "ortg": round(100 * tot(0, "pts") / poss, 1), "drtg": round(100 * tot(1, "pts") / poss, 1),
        "efg": pct(fgm + 0.5 * tot(0, "fg3m"), fga), "ts": pct(tot(0, "pts"), 2 * (fga + 0.44 * tot(0, "fta"))),
        "tovPct": round(100 * tot(0, "tov") / poss, 1), "orebPct": pct(tot(0, "oreb"), tot(0, "oreb") + tot(1, "dreb")),
        "ftr": pct(tot(0, "ftm"), fga), "astPct": pct(tot(0, "ast"), fgm),
    })
    s["l"] = n - s["w"]
    s["net"] = round(s["ortg"] - s["drtg"], 1)
    return s


def build(games):
    per_team, groups, all_rows, group_rows = {}, {}, [], {}
    for g in games:
        a, b = g["sides"]
        minutes = max(40, round(max(a["sec"], b["sec"]) / 300 / 5) * 5)
        for me, other in ((a, b), (b, a)):
            row = (me["total"], other["total"], minutes, me["total"]["pts"] > other["total"]["pts"])
            per_team.setdefault(me["team"], []).append(row)
            all_rows.append(row)
            if g["group"]:
                groups[me["team"]] = g["group"]
                group_rows.setdefault(g["group"], []).append(row)
    teams = []
    for name, rows in per_team.items():
        t = summarize(rows)
        t["team"] = name
        t["paok"] = "PAOK" in name.upper()
        if name in groups:
            t["group"] = groups[name]
        teams.append(t)
    teams.sort(key=lambda t: (-t["net"], t["team"]))
    return {"games": len(games), "teams": teams, "avg": summarize(all_rows) if all_rows else None,
            # per-group averages (EuroCup): every team-game played in that group
            "groupAvg": {grp: summarize(rows) for grp, rows in group_rows.items()}}


def main():
    out = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "comps": {}}
    for comp, fetch in (("EuroCup", eurocup_games), ("GBL", gbl_games)):
        try:
            games = fetch()
            out["comps"][comp] = build(games)
            print(f"{comp}: {len(games)} games, {len(out['comps'][comp]['teams'])} teams")
        except Exception as e:
            print(f"{comp}: league stats unavailable ({e})")
    with open(os.path.join(DATA, "league.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
