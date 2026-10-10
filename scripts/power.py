"""Power ratings and season projections for the Greek League and PAOK's EuroCup group -> data/power.json.

Run after league.py:  python scripts/power.py

- Adjusted net rating: points per 100 possessions better than opponents, corrected for opponent strength and
  home court (iterative "simple rating system" on per-100-possession margins).
- Expected W-L: Pythagorean expectation from points scored/allowed (exponent 14, the usual basketball value).
- Luck: actual wins minus expected wins.
- Schedule strength: average adjusted rating of opponents already played / still to play.
- Projections: the remaining schedule is simulated many times with each team's rating (pulled toward average
  early in the season), giving projected wins, play-off, first-place and relegation chances.
"""
import json
import math
import os
import random
import re
from datetime import datetime, timezone

import update_eurocup as ec
import update_gbl as gbl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(DATA, "league_cache")

HOME_EDGE = 3.0      # points per 100 possessions for the home team
PRIOR_GAMES = 4      # last season's rating counts like this many games of this season
PRIOR_KEEP = 0.5     # share of last season's margin carried over (rosters change over the summer)
NEW_TEAM_PRIOR = -8  # Greek League teams without last-season data (promoted): slightly below average
LAST_GBL = "44B80BEB"   # Stoiximan GBL 2025-26
LAST_EUROCUP = "U2025"
GAME_SD = 11.5       # spread of single-game margins (points) around the expectation
SIMS = 10000
PYTHAG = 14.0


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


def poss_of(t):
    return t["fg2a"] + t["fg3a"] - t["oreb"] + t["tov"] + 0.44 * t["fta"]


# ---------- played games (home team first) ----------

def played_games(prefix, group=None):
    out = []
    for fn in os.listdir(CACHE):
        if not fn.startswith(prefix):
            continue
        with open(os.path.join(CACHE, fn), encoding="utf-8") as f:
            g = json.load(f)
        if group and g.get("group") != group:
            continue
        h, a = g["sides"]
        poss = (poss_of(h["total"]) + poss_of(a["total"])) / 2
        out.append({"home": h["team"], "away": a["team"], "hp": h["total"]["pts"], "ap": a["total"]["pts"], "poss": poss})
    return out


# ---------- remaining schedules ----------

def gbl_remaining():
    """Unplayed regular-season fixtures for every team, from the round-by-round results pages."""
    path = os.path.join(CACHE, "gbl_schedule.json")
    sched = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            sched = json.load(f)
    for r in range(1, gbl.ROUNDS + 1):
        key = f"{r:02d}"
        if key in sched and all(g["played"] for g in sched[key]):
            continue  # finished round: nothing can change
        page = gbl.fetch(f"EsakeResults?idchampionship={gbl.CHAMPIONSHIP}&idseason=00000001&series={key}")
        games = []
        for block in page.split('class="esake-program-game"')[1:]:
            block = block.split("esake-news-box")[0]
            score_box = block.split("esake-program-game-final-score row", 1)[-1].split("esake-program-game-hidden-row")[0]
            cols = [c.split(">", 1)[-1] for c in re.split(r'<div class="col-lg-\d', score_box)[1:4]]  # drop the tag's own attributes (they contain digits)
            if len(cols) < 3:
                continue
            home, score, away = [" ".join(gbl.cells(c)).replace("\xa0", " ").strip(' ">') for c in cols]
            info = re.findall(r'esake-program-game-info[^>]*>(?:<img[^>]*>)?([^<]*)<', block)
            done = gbl.finished(gbl.parse_date(info[0])) if info else False
            games.append({"home": gbl.team_name(home), "away": gbl.team_name(away),
                          "played": len(re.findall(r"\d+", score)) == 2 and done})
        sched[key] = games
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sched, f, ensure_ascii=False)
    # each home/away pairing happens once a season; a moved game can be listed under two rounds
    played = {(g["home"], g["away"]) for games in sched.values() for g in games if g["played"]}
    left = {(g["home"], g["away"]) for games in sched.values() for g in games if not g["played"]}
    return sorted(left - played)


def eurocup_remaining(group):
    out = []
    for g in ec.get("/games")["data"]:
        if g["played"] or g["group"]["name"] != group or g["phaseType"]["code"] != "RS":
            continue
        out.append((ec.club_name(g["local"]["club"]), ec.club_name(g["road"]["club"])))
    return out


# ---------- last season (starting point) ----------

def gbl_prior():
    """Last regular season's point margin per game -> per 100 possessions, partly carried over."""
    c = gbl.cells(gbl.fetch(f"EsakeRanking?idchampionship={LAST_GBL}&series=26"))
    k = c.index("ΔΙΑΦΟΡΑ ΠΟΝΤΩΝ") + 1
    out = {}
    while k + 9 < len(c) and c[k].isdigit():
        gp = int(c[k + 3]) if c[k + 3].isdigit() else 0
        diff = gbl.num(c[k + 9])
        if gp:
            out[gbl.team_name(c[k + 1])] = PRIOR_KEEP * (diff / gp) * 100 / 74
        k += 10
    return out


def eurocup_prior():
    out = {}
    try:
        groups = ec.API.format(season=LAST_EUROCUP)
        req = ec.urllib.request.Request(groups + "/rounds/18/standings", headers={"User-Agent": "paok-basketball-site"})
        with ec.urllib.request.urlopen(req, timeout=30) as r:
            for g in json.load(r):
                for st in g["standings"]:
                    d = st["data"]
                    if d["gamesPlayed"]:
                        diff = (d["pointsFavour"] - d["pointsAgainst"]) / d["gamesPlayed"]
                        out[ec.club_name(st["club"])] = PRIOR_KEEP * diff * 100 / 74
    except Exception as e:
        print("EuroCup last season unavailable:", e)
    return out


# ---------- ratings ----------

def ratings(games, teams, prior=None, weight=1.0):
    """Opponent- and home-adjusted net rating per 100 possessions.
    Each team's rating = (its adjusted game margins + weight x prior) / (games + weight), solved iteratively;
    weight keeps early-season ratings stable (with prior=None they're pulled toward average)."""
    prior = prior or {}
    r = {t: prior.get(t, 0.0) for t in teams}
    for _ in range(300):
        new = {}
        for t in teams:
            total, n = weight * prior.get(t, 0.0), weight
            for g in games:
                if t not in (g["home"], g["away"]):
                    continue
                home = g["home"] == t
                margin = (g["hp"] - g["ap"]) if home else (g["ap"] - g["hp"])
                opp = g["away"] if home else g["home"]
                total += 100 * margin / g["poss"] - (HOME_EDGE if home else -HOME_EDGE) + r.get(opp, 0.0)
                n += 1
            new[t] = total / n
        r = {t: 0.5 * r[t] + 0.5 * new[t] for t in teams}  # damped, so lightly connected schedules converge
    return r


def win_prob(r_home, r_away, poss):
    exp_margin = (r_home - r_away + HOME_EDGE) * poss / 100
    return 0.5 * (1 + math.erf(exp_margin / (GAME_SD * math.sqrt(2))))


# ---------- projections ----------

def project(comp, games, remaining, teams, record, points_fn, cut, relegate, prior, new_team_below_avg=True):
    adj = ratings(games, teams)  # this season only
    prior = {t: prior.get(t, NEW_TEAM_PRIOR if new_team_below_avg else 0.0) for t in teams}
    shrunk = ratings(games, teams, prior, PRIOR_GAMES)  # power rating: this season + last season's starting point
    avg_poss = sum(g["poss"] for g in games) / len(games) if games else 74.0
    probs = [(h, a, win_prob(shrunk[h], shrunk[a], avg_poss)) for h, a in remaining]
    n = len(teams)
    wins_sum = {t: 0 for t in teams}
    pos_count = {t: [0] * n for t in teams}
    rng = random.Random(2026)
    for _ in range(SIMS):
        w = {t: record[t][0] for t in teams}
        l = {t: record[t][1] for t in teams}
        for h, a, p in probs:
            if rng.random() < p:
                w[h] += 1; l[a] += 1
            else:
                w[a] += 1; l[h] += 1
        order = sorted(teams, key=lambda t: (points_fn(t, w[t], l[t]), shrunk[t] + rng.random() * 1e-6), reverse=True)
        for i, t in enumerate(order):
            pos_count[t][i] += 1
            wins_sum[t] += w[t]
    out = []
    for t in teams:
        tg = [g for g in games if t in (g["home"], g["away"])]
        pf = sum(g["hp"] if g["home"] == t else g["ap"] for g in tg)
        pa = sum(g["ap"] if g["home"] == t else g["hp"] for g in tg)
        poss = sum(g["poss"] for g in tg)
        exp_pct = pf ** PYTHAG / (pf ** PYTHAG + pa ** PYTHAG) if pf + pa else 0.5
        opp_played = [g["away"] if g["home"] == t else g["home"] for g in tg]
        opp_left = [a if h == t else h for h, a in remaining if t in (h, a)]
        games_total = record[t][0] + record[t][1] + len(opp_left)
        proj_w = wins_sum[t] / SIMS
        out.append({
            "team": t, "paok": "PAOK" in t.upper(), "gp": len(tg), "w": record[t][0], "l": record[t][1],
            "power": round(shrunk[t], 1), "adjNet": round(adj[t], 1), "prior": round(prior[t], 1),
            "net": round(100 * (pf - pa) / poss, 1) if poss else None,
            "expW": round(exp_pct * len(tg), 1), "luck": round(record[t][0] - exp_pct * len(tg), 1),
            "sosPlayed": round(sum(shrunk[o] for o in opp_played) / len(opp_played), 1) if opp_played else None,
            "sosLeft": round(sum(shrunk[o] for o in opp_left) / len(opp_left), 1) if opp_left else None,
            "projW": round(proj_w, 1), "projL": round(games_total - proj_w, 1),
            "pPlayoffs": round(100 * sum(pos_count[t][:cut]) / SIMS, 1),
            "pFirst": round(100 * pos_count[t][0] / SIMS, 1),
            "pRelegation": round(100 * pos_count[t][-1] / SIMS, 1) if relegate else None,
            "positions": [round(100 * c / SIMS, 1) for c in pos_count[t]],
        })
    out.sort(key=lambda x: -x["power"])
    for i, t in enumerate(out):
        t["rank"] = i + 1
    return {"teams": out, "playoffSpots": cut, "relegation": relegate, "gamesPlayed": len(games), "gamesLeft": len(remaining)}


def main():
    out = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "comps": {}}

    # Greek League: 2 points a win, 1 a loss, minus any deductions; top 8 to the play-offs, last place relegated
    gbld = load("gbl.json")
    teams = [s["team"] for s in gbld["standings"]]
    record = {s["team"]: (s["w"], s["l"]) for s in gbld["standings"]}
    deduction = {s["team"]: 2 * s["w"] + s["l"] - s["pts"] for s in gbld["standings"]}
    games = played_games("GBL_")
    remaining = gbl_remaining()
    teams_in = set(teams) | {t for g in games for t in (g["home"], g["away"])} | {t for p in remaining for t in p}
    for t in teams_in - set(teams):
        print("GBL: unknown team name", t)
    out["comps"]["GBL"] = project("GBL", games, remaining, teams, record,
                                  lambda t, w, l: 2 * w + l - deduction.get(t, 0), cut=8, relegate=True,
                                  prior=gbl_prior())

    # EuroCup: PAOK's group; ranked by wins; top 4 to the play-offs
    ecd = load("eurocup.json")
    group = ecd.get("group")
    teams = [s["team"] for s in ecd["standings"]]
    record = {s["team"]: (s["w"], s["l"]) for s in ecd["standings"]}
    games = played_games("U_", group)
    out["comps"]["EuroCup"] = project("EuroCup", games, eurocup_remaining(group), teams, record,
                                      lambda t, w, l: w, cut=4, relegate=False, prior=eurocup_prior(),
                                      new_team_below_avg=False)  # new EuroCup teams come from other leagues, not from below
    out["comps"]["EuroCup"]["group"] = group

    with open(os.path.join(DATA, "power.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    for c, v in out["comps"].items():
        print(c, v["gamesPlayed"], "played,", v["gamesLeft"], "left;",
              [(t["team"], t["power"], t["projW"], t["pPlayoffs"]) for t in v["teams"][:4]])


if __name__ == "__main__":
    main()
