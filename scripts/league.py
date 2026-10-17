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
        for block in page.split("esake-news-box")[0].split('class="esake-program-game"')[1:]:
            ids = re.findall(r"idgame=([0-9A-F]+)&mode=3", block)
            info = re.findall(r'esake-program-game-info[^>]*>(?:<img[^>]*>)?([^<]*)<', block)
            if not ids or not info or not gbl.finished(gbl.parse_date(info[0])):
                continue  # not started, or still being played
            gid = ids[0]
            path = os.path.join(CACHE, f"GBL_{gid}.json")
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    out.append(json.load(f))
                continue
            try:
                g = gbl.parse_game(gid)
            except Exception as e:
                print("GBL game not readable yet:", gid, e)
                continue
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
        "par3": pct(tot(0, "fg3a"), fga),  # share of shots that are threes
        "fgm": round(fgm / n, 1), "fga": round(fga / n, 1),
    })
    # defensive four factors: what opponents managed against this team
    ofga, ofgm = tot(1, "fg2a") + tot(1, "fg3a"), tot(1, "fg2m") + tot(1, "fg3m")
    s.update({
        "opp_efg": pct(ofgm + 0.5 * tot(1, "fg3m"), ofga),
        "forcedTov": round(100 * tot(1, "tov") / poss, 1),
        "drebPct": pct(tot(0, "dreb"), tot(0, "dreb") + tot(1, "oreb")),
        "opp_ftr": pct(tot(1, "ftm"), ofga),
    })
    s["l"] = n - s["w"]
    s["net"] = round(s["ortg"] - s["drtg"], 1)
    return s


HOME_EDGE = 1.5   # points per 100 possessions a home team scores more (and allows fewer)
ADJ_PRIOR = 0.5   # games' worth of league-average performance, keeps the adjustment stable early on


def adjust(games):
    """Schedule-adjusted offensive/defensive ratings: each game's rating corrected for how good that opponent's
    defence/attack is (and for home court), solved for all teams at once. The first side of a game is the home team."""
    rows = []  # (team, opp, ortg in that game, drtg in that game, home)
    for g in games:
        a, b = g["sides"]
        poss = (poss_of(a["total"]) + poss_of(b["total"])) / 2
        if not poss:
            continue
        pa, pb = 100 * a["total"]["pts"] / poss, 100 * b["total"]["pts"] / poss
        rows += [(a["team"], b["team"], pa, pb, True), (b["team"], a["team"], pb, pa, False)]
    if not rows:
        return {}
    lg = sum(r[2] for r in rows) / len(rows)
    teams = {r[0] for r in rows}
    off, de = {t: lg for t in teams}, {t: lg for t in teams}
    for _ in range(200):
        new_o, new_d = {}, {}
        for t in teams:
            mine = [r for r in rows if r[0] == t]
            h = lambda home: HOME_EDGE if home else -HOME_EDGE
            # scored against a defence that usually allows de[opp]: worth (lg - de[opp]) more than it looks
            so = sum(o + (lg - de[opp]) - h(home) for _, opp, o, _, home in mine)
            sd = sum(d + (lg - off[opp]) + h(home) for _, opp, _, d, home in mine)
            n = len(mine)
            new_o[t] = (so + ADJ_PRIOR * lg) / (n + ADJ_PRIOR)
            new_d[t] = (sd + ADJ_PRIOR * lg) / (n + ADJ_PRIOR)
        mo, md = sum(new_o.values()) / len(teams), sum(new_d.values()) / len(teams)
        off = {t: 0.5 * off[t] + 0.5 * (new_o[t] - mo + lg) for t in teams}
        de = {t: 0.5 * de[t] + 0.5 * (new_d[t] - md + lg) for t in teams}
    out = {}
    for t in teams:
        opps = [r[1] for r in rows if r[0] == t]
        out[t] = {"adjOrtg": round(off[t], 1), "adjDrtg": round(de[t], 1), "adjNet": round(off[t] - de[t], 1),
                  # schedule strength: average adjusted net rating of the opponents faced (higher = harder)
                  "sos": round(sum(off[o] - de[o] for o in opps) / len(opps), 1)}
    return out


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
    adj = adjust(games)
    for t in teams:
        t.update(adj.get(t["team"], {}))
    teams.sort(key=lambda t: (-t["net"], t["team"]))
    return {"games": len(games), "teams": teams, "avg": summarize(all_rows) if all_rows else None,
            # per-group averages (EuroCup): every team-game played in that group
            "groupAvg": {grp: summarize(rows) for grp, rows in group_rows.items()}}


def only_comps():
    """Competitions named on the command line (e.g. `python scripts/x.py EuroCup`); none = all."""
    import sys
    return set(sys.argv[1:]) or {"EuroCup", "GBL"}


def main():
    wanted = only_comps()
    out = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "comps": {}}
    path = os.path.join(DATA, "league.json")
    if os.path.exists(path):  # competitions not updated this time keep their last numbers
        with open(path, encoding="utf-8") as f:
            out["comps"] = json.load(f).get("comps", {})
    for comp, fetch in (("EuroCup", eurocup_games), ("GBL", gbl_games)):
        if comp not in wanted:
            continue
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
