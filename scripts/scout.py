"""Scouting report + match-day projections for PAOK's next game in each competition.

Run after update_eurocup.py and update_gbl.py:  python scripts/scout.py
Writes data/scout.json. Opponent box scores are cached in data/scout_cache/.

Who's out on match day comes from (first that applies):
  1. data/lineups.json, e.g. {"EuroCup:32": {"paok_out": ["Calathes"], "opp_out": ["Smith"]}}
     (surnames are enough), filled in on match day;
  2. the official game roster in the EuroCup feed, when published before tip-off;
  3. otherwise everyone who has played this season is assumed available.
"""
import json
import math
import os
import re
from datetime import datetime, timedelta, timezone

import update_eurocup as ec
import update_gbl as gbl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(DATA, "scout_cache")

LEAGUE_AVG = {"EuroCup": 82.0, "GBL": 80.0}  # fallback points per team per game when league.json is missing
LEAGUE = {}  # filled in main() from data/league.json: comp -> league-average stats (pace, ortg, ...)
PRIOR_GAMES = 3      # how strongly early-season numbers are pulled toward the league average
HOME_EDGE = 1.5      # points added to the home team (and taken from the away team)
SPREAD_SD = 11.0     # typical spread of final margins around the projection


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


def cached(key, build):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{key}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    value = build()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=1)
    return value


def surname(name):
    return name.lower().replace("-", " ").split()[-1]


# ---------- aggregation ----------

def aggregate(boxes):
    """boxes: [{"players": [...], "team": {...}, "opp": {...}, "won": bool}] from one team's point of view."""
    n = len(boxes)
    if not n:
        return None, []
    tot = lambda side, k: sum(b[side].get(k, 0) for b in boxes)
    fg = lambda side: (tot(side, "fg2m") + tot(side, "fg3m"), tot(side, "fg2a") + tot(side, "fg3a"))
    pct = lambda m, a: round(100 * m / a, 1) if a else None
    w = sum(1 for b in boxes if b["won"])
    team = {
        "gp": n, "w": w, "l": n - w,
        "pts": round(tot("team", "pts") / n, 1), "allowed": round(tot("opp", "pts") / n, 1),
        "fgp": pct(*fg("team")), "fg3p": pct(tot("team", "fg3m"), tot("team", "fg3a")),
        "fg3a": round(tot("team", "fg3a") / n, 1), "ftp": pct(tot("team", "ftm"), tot("team", "fta")),
        "reb": round(tot("team", "reb") / n, 1), "oreb": round(tot("team", "oreb") / n, 1),
        "ast": round(tot("team", "ast") / n, 1), "tov": round(tot("team", "tov") / n, 1),
        "stl": round(tot("team", "stl") / n, 1), "pir": round(tot("team", "pir") / n, 1),
        "opp_fgp": pct(*fg("opp")), "opp_fg3p": pct(tot("opp", "fg3m"), tot("opp", "fg3a")),
    }
    # possessions (standard estimate, averaged over both teams), pace per 40 minutes, ratings per 100 possessions
    poss_of = lambda t: t["fg2a"] + t["fg3a"] - t["oreb"] + t["tov"] + 0.44 * t["fta"]
    poss = sum((poss_of(b["team"]) + poss_of(b["opp"])) / 2 for b in boxes)
    minutes = sum(max(40, round(sum(p.get("sec") or 0 for p in b["players"]) / 300 / 5) * 5) for b in boxes)
    if poss:
        team.update({"poss": round(poss / n, 1), "pace": round(poss * 40 / minutes, 1),
                     "ortg": round(100 * tot("team", "pts") / poss, 1), "drtg": round(100 * tot("opp", "pts") / poss, 1)})
    players = {}
    for b in boxes:
        for p in b["players"]:
            if not p.get("sec"):
                continue
            t = players.setdefault(surname(p["name"]), {"name": p["name"], "no": p.get("no", ""), "gp": 0, "sec": 0,
                                                        "pm": 0, "pmg": 0,
                                                        **{k: 0 for k in ("pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "pir", "pf",
                                                                          "fg2m", "fg2a", "fg3m", "fg3a", "ftm", "fta")}})
            t["gp"] += 1
            for k in list(t):
                if k not in ("name", "no", "gp", "pm", "pmg"):
                    t[k] += p.get(k, 0) or 0
            if p.get("pm") is not None:  # plus/minus isn't in every source
                t["pm"] += p["pm"]
                t["pmg"] += 1
    out = []
    for t in players.values():
        g = t["gp"]
        out.append({
            "name": t["name"], "no": t["no"], "gp": g, "min": round(t["sec"] / 60 / g, 1),
            "pts": round(t["pts"] / g, 1), "reb": round(t["reb"] / g, 1), "ast": round(t["ast"] / g, 1),
            "stl": round(t["stl"] / g, 1), "blk": round(t["blk"] / g, 1), "tov": round(t["tov"] / g, 1),
            "pir": round(t["pir"] / g, 1), "fg3m": round(t["fg3m"] / g, 1), "fg3a": t["fg3a"],
            "fg3p": pct(t["fg3m"], t["fg3a"]), "fgp": pct(t["fg2m"] + t["fg3m"], t["fg2a"] + t["fg3a"]),
            "fta": round(t["fta"] / g, 1), "dreb": round(t["dreb"] / g, 1), "pf": round(t["pf"] / g, 1),
            "pm": round(t["pm"] / t["pmg"], 1) if t["pmg"] else None,
            # per-minute rates for projections
            "_rate": {k: t[k] / (t["sec"] / 60) for k in ("pts", "reb", "ast", "pir")} if t["sec"] else {},
        })
    out.sort(key=lambda p: (-p["pir"], -p["pts"]))
    return team, out


def impact(players, team_gp):
    """Top opponents by PIR with short tags explaining why they matter."""
    if not players:
        return []
    regulars = [p for p in players if p["gp"] >= max(1, team_gp // 2)] or players
    leaders = {
        "Top scorer": max(regulars, key=lambda p: p["pts"])["name"],
        "Rebounder": max(regulars, key=lambda p: p["reb"])["name"],
        "Playmaker": max(regulars, key=lambda p: p["ast"])["name"],
    }
    top = []
    for p in regulars[:5]:
        tags = [t for t, who in leaders.items() if who == p["name"]]
        if p["fg3m"] >= 1.5 and (p["fg3p"] or 0) >= 35:
            tags.append("3-pt threat")
        if p["fta"] >= 4:
            tags.append("Gets to the line")
        if p["stl"] + p["blk"] >= 2:
            tags.append("Disruptor")
        top.append({k: v for k, v in p.items() if not k.startswith("_")} | {"tags": tags})
    return top


# ---------- projections ----------

def project_side(players, out_names, team_stats, opp_stats, comp, home):
    out = {surname(n) for n in out_names}
    avail = [p for p in players if surname(p["name"]) not in out and p["_rate"]]
    missing = [p["name"] for p in players if surname(p["name"]) in out]
    if not avail:
        return None
    # expected minutes: season average, rescaled so the team plays 200, nobody above 38
    # minutes per *team* game, so someone who played 1 of 4 games isn't counted as a regular
    mins = {p["name"]: p["min"] * p["gp"] / team_stats["gp"] for p in avail}
    for _ in range(5):
        scale = 200 / sum(mins.values())
        mins = {k: min(38.0, v * scale) for k, v in mins.items()}
    lineup_pts = sum(p["_rate"]["pts"] * mins[p["name"]] for p in avail)
    lg = LEAGUE.get(comp) or {}
    lg_pace, lg_ortg = lg.get("pace") or 74.0, lg.get("ortg") or 108.0
    # early-season numbers are pulled toward the league average (PRIOR_GAMES worth of league-average games)
    reg = lambda x, gp, base: (gp * x + PRIOR_GAMES * base) / (gp + PRIOR_GAMES) if x is not None else base
    pace = reg(team_stats.get("pace"), team_stats["gp"], lg_pace) * reg(opp_stats.get("pace"), opp_stats["gp"], lg_pace) / lg_pace
    ortg = reg(team_stats.get("ortg"), team_stats["gp"], lg_ortg)
    opp_drtg = reg(opp_stats.get("drtg"), opp_stats["gp"], lg_ortg)
    # missing players: scale the attack by how much of the usual scoring is still available
    full = team_stats.get("pts") or lineup_pts
    availability = max(0.8, min(1.05, lineup_pts / full)) if full else 1
    points_per_100 = ortg * opp_drtg / lg_ortg * availability
    score = pace * points_per_100 / 100 + (HOME_EDGE if home else -HOME_EDGE)
    k = score / lineup_pts if lineup_pts else 1
    rows = []
    for p in avail:
        m = mins[p["name"]]
        rows.append({
            "name": p["name"], "no": p["no"], "min": round(m),
            "pts": round(p["_rate"]["pts"] * m * k, 1), "reb": round(p["_rate"]["reb"] * m, 1),
            "ast": round(p["_rate"]["ast"] * m, 1), "pir": round(p["_rate"]["pir"] * m, 1),
        })
    rows.sort(key=lambda r: -r["pir"])
    return {"score": round(score, 1), "players": rows, "missing": missing, "pace": round(pace, 1)}


def win_prob(margin):
    return round(100 * 0.5 * (1 + math.erf(margin / (SPREAD_SD * math.sqrt(2)))))


# ---------- data per competition ----------

def eurocup_side_box(game, club):
    raw = ec.get(f"/games/{game['gameCode']}/stats")
    is_local = game["local"]["club"]["code"] == club
    us, them = (raw["local"], raw["road"]) if is_local else (raw["road"], raw["local"])
    me, other = (game["local"], game["road"]) if is_local else (game["road"], game["local"])
    return {"players": [ec.norm_player_stats(p) for p in us["players"]], "team": ec.norm_totals(us["total"]),
            "opp": ec.norm_totals(them["total"]), "won": me["score"] > other["score"]}


def eurocup_scout(next_game, paok_boxes):
    games = ec.get("/games")["data"]
    g = next(x for x in games if x["gameCode"] == next_game["code"])
    opp = g["road"] if g["local"]["club"]["code"] == ec.CLUB else g["local"]
    code = opp["club"]["code"]
    opp_games = [x for x in games if x["played"] and code in (x["local"]["club"]["code"], x["road"]["club"]["code"])]
    boxes = [cached(f"U_{x['gameCode']}_{code}", lambda x=x: eurocup_side_box(x, code)) for x in opp_games]
    # official game roster, if the clubs have submitted it before tip-off
    dressed = None
    try:
        raw = ec.get(f"/games/{next_game['code']}/stats")
        sides = {raw["local"].get("players") and g["local"]["club"]["code"]: raw["local"],
                 raw["road"].get("players") and g["road"]["club"]["code"]: raw["road"]}
        if raw["local"]["players"] and raw["road"]["players"]:
            dressed = {c: [ec.title_name(p["player"]["person"]["name"]) for p in s["players"]] for c, s in sides.items() if c}
    except Exception:
        pass
    bios = []
    for x in ec.get(f"/clubs/{code}/people"):
        if x["type"] == "J" and x.get("active"):
            per = x["person"]
            bios.append({"no": x["dorsal"], "name": ec.title_name(per["name"]), "pos": x.get("positionName") or "",
                         "nat": (per.get("country") or {}).get("code", ""), "height": per.get("height") or None,
                         "born": (per.get("birthDate") or "")[:10]})
    return boxes, opp["club"]["editorialName"].strip(), dressed and (dressed.get(ec.CLUB), dressed.get(code)), bios


def esake_team_ids():
    page = gbl.fetch(f"EsakeResults?idchampionship={gbl.CHAMPIONSHIP}")
    select = page.split('id="idteam"', 1)[1].split("</select>", 1)[0]
    return {gbl.team_name(name): tid for tid, name in re.findall(r'<option value="([0-9A-F]+)"\s*>([^<]+)<', select)}


def gbl_scout(next_game, gbl_data):
    opp = next_game["opp"]
    tid = esake_team_ids().get(opp)
    if not tid:
        return [], opp, None, []
    now = datetime.now(timezone.utc)
    done_rounds = [int(x["round"].split()[-1]) for x in gbl_data["games"]
                   if x["comp"] == "GBL" and x["date"] and x["date"].endswith("Z")
                   and datetime.fromisoformat(x["date"].replace("Z", "+00:00")) < now - timedelta(hours=3)]
    boxes = []
    for r in sorted(set(done_rounds)):
        page = gbl.fetch(f"EsakeResults?idchampionship={gbl.CHAMPIONSHIP}&idteam={tid}&idseason=00000001&series={r:02d}")
        block = page.split("esake-news-box")[0]
        ids = re.findall(r"idgame=([0-9A-F]+)&mode=3", block)
        info = re.findall(r'esake-program-game-info[^>]*>(?:<img[^>]*>)?([^<]*)<', block)
        if not ids or not info or not gbl.finished(gbl.parse_date(info[0])):
            continue  # this team's game in that round isn't over yet (or was moved)
        try:
            g = cached(f"GBL_{ids[0]}", lambda gid=ids[0]: gbl.parse_game(gid))
        except Exception as e:
            print("opponent game not readable yet:", ids[0], e)
            continue
        if not (g["hs"] or g["as"]):
            os.remove(os.path.join(CACHE, f"GBL_{ids[0]}.json"))  # not played yet; look again next run
            continue
        mine = next((t for t in g["teams"] if gbl.team_name(t["name"]) == opp), None)
        other = next((t for t in g["teams"] if t is not mine), None)
        if not mine:
            continue
        is_home = gbl.team_name(g["home"]) == opp
        won = (g["hs"] > g["as"]) == is_home
        boxes.append({"players": mine["players"], "team": mine["total"], "opp": other["total"], "won": won})
    try:
        bios = gbl.roster(tid)
    except Exception as e:
        print("opponent roster unavailable:", e)
        bios = []
    return boxes, opp, None, bios


# ---------- main ----------

def main():
    ecd, gbld = load("eurocup.json"), load("gbl.json")
    if os.path.exists(os.path.join(DATA, "league.json")):
        for c, v in load("league.json")["comps"].items():
            if not v.get("avg"):
                continue
            # EuroCup: baseline is PAOK's group (its own games), like the comparisons on the site
            group = next((t.get("group") for t in v["teams"] if t.get("paok")), None)
            LEAGUE[c] = (v.get("groupAvg") or {}).get(group) or v["avg"]
    lineups_path = os.path.join(DATA, "lineups.json")
    lineups = load("lineups.json") if os.path.exists(lineups_path) else {}
    now = datetime.now(timezone.utc)
    reports = []
    for comp, data in (("EuroCup", ecd), ("GBL", gbld)):
        upcoming = [g for g in data["games"] if g["comp"] == comp and not g["played"] and g["date"]
                    and datetime.fromisoformat(g["date"].replace("Z", "+00:00") if g["date"].endswith("Z") else g["date"] + "+00:00")
                    > now - timedelta(hours=3)]
        if not upcoming:
            continue
        nxt = upcoming[0]
        paok_boxes = [{"players": g["box"]["players"], "team": g["box"]["team"], "opp": g["box"]["opp"], "won": g["us"] > g["them"]}
                      for g in data["games"] if g["comp"] == comp and g["played"] and g.get("box")]
        try:
            if comp == "EuroCup":
                opp_boxes, opp_name, dressed, opp_bios = eurocup_scout(nxt, paok_boxes)
            else:
                opp_boxes, opp_name, dressed, opp_bios = gbl_scout(nxt, gbld)
        except Exception as e:
            print(f"{comp}: scouting failed ({e})")
            continue
        paok_team, paok_players = aggregate(paok_boxes)
        opp_team, opp_players = aggregate(opp_boxes)
        report = {
            "comp": comp, "code": nxt["code"], "date": nxt["date"], "round": nxt["round"], "home": nxt["home"],
            "opp": nxt["opp"], "venue": nxt["venue"], "url": nxt.get("url"),
            "paokTeam": paok_team, "oppTeam": opp_team, "league": LEAGUE.get(comp),
            "impact": impact(opp_players, opp_team["gp"]) if opp_team else [],
            "paokImpact": impact(paok_players, paok_team["gp"]) if paok_team else [],
            # full opponent player list + registered roster, for the Player Profiles page
            "oppPlayers": [{k: v for k, v in p.items() if not k.startswith("_")} for p in opp_players],
            "oppRoster": opp_bios,
        }
        # match-day projections
        key = f"{comp}:{nxt['code']}"
        lu = lineups.get(key, {})
        paok_out, opp_out, source = lu.get("paok_out", []), lu.get("opp_out", []), "manual" if lu else None
        if not lu and dressed and dressed[0] and dressed[1]:
            dressed_paok = {surname(n) for n in dressed[0]}
            dressed_opp = {surname(n) for n in dressed[1]}
            paok_out = [p["name"] for p in paok_players if surname(p["name"]) not in dressed_paok]
            opp_out = [p["name"] for p in opp_players if surname(p["name"]) not in dressed_opp]
            source = "official"
        if paok_team and opp_team:
            # PAOK's strength: every game this season (all competitions), but only players registered for this one
            all_boxes = [{"players": g["box"]["players"], "team": g["box"]["team"], "opp": g["box"]["opp"], "won": g["us"] > g["them"]}
                         for d in (ecd, gbld) for g in d["games"] if g["played"] and g.get("box")]
            season_team, season_players = aggregate(all_boxes)
            registered = {surname(p["name"]) for p in data["roster"]}
            season_players = [p for p in season_players if surname(p["name"]) in registered]
            us = project_side(season_players, paok_out, season_team, opp_team, comp, nxt["home"])
            them = project_side(opp_players, opp_out, opp_team, season_team, comp, not nxt["home"])
            if us and them:
                report["projection"] = {
                    "paok": us, "opp": them, "winProb": win_prob(us["score"] - them["score"]), "pace": us["pace"],
                    "lineupSource": source or "assumed", "note": lu.get("note", ""),
                }
        reports.append(report)
        print(f"{comp}: scouted {opp_name} ({len(opp_boxes)} games), PAOK {len(paok_boxes)} games"
              + (f", projection {report['projection']['paok']['score']}-{report['projection']['opp']['score']}" if "projection" in report else ""))

    with open(os.path.join(DATA, "scout.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "reports": reports}, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
