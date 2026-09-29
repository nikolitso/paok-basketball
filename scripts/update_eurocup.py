"""Fetch PAOK's EuroCup data from the public Euroleague API into data/eurocup.json.

Run: python scripts/update_eurocup.py
Box scores of finished games are cached in data/eurocup_box/ so each is downloaded once.
"""
import json
import os
import urllib.request
from datetime import datetime, timezone

API = "https://api-live.euroleague.net/v2/competitions/U/seasons/{season}"
SEASON = "U2026"
CLUB = "PAO"  # PAOK's code in the EuroCup feed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
BOX_DIR = os.path.join(DATA, "eurocup_box")


def get(path):
    url = API.format(season=SEASON) + path
    req = urllib.request.Request(url, headers={"User-Agent": "paok-basketball-site"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def title_name(raw):
    """'CALATHES, NICK' -> 'Nick Calathes'."""
    if "," in raw:
        last, first = [p.strip() for p in raw.split(",", 1)]
        raw = f"{first} {last}"
    return " ".join(w.capitalize() if not w.isupper() or len(w) > 2 else w for w in raw.lower().split()).title()


def team_case(name):
    """'AEK BC' -> 'AEK BC', 'ALVARK TOKYO' -> 'Alvark Tokyo'."""
    keep = {"BC", "AEK", "PAOK", "KK", "BK", "CB", "ASVEL", "CSKA", "UNICS", "BCM", "USA"}
    return " ".join(w if w in keep else w.title() for w in name.split())


def club_name(club):
    name = club["editorialName"].strip()
    return name.title() if name.isupper() and len(name) > 4 else name


def norm_player_stats(p):
    s = p["stats"]
    return {
        "no": str(s.get("dorsal") or p["player"].get("dorsal") or ""),
        "name": title_name(p["player"]["person"]["name"]),
        "start": bool(s.get("startFive")),
        "sec": int(s["timePlayed"]),
        "pts": int(s["points"]),
        "fg2m": int(s["fieldGoalsMade2"]), "fg2a": int(s["fieldGoalsAttempted2"]),
        "fg3m": int(s["fieldGoalsMade3"]), "fg3a": int(s["fieldGoalsAttempted3"]),
        "ftm": int(s["freeThrowsMade"]), "fta": int(s["freeThrowsAttempted"]),
        "oreb": int(s["offensiveRebounds"]), "dreb": int(s["defensiveRebounds"]),
        "reb": int(s["totalRebounds"]), "ast": int(s["assistances"]),
        "stl": int(s["steals"]), "tov": int(s["turnovers"]),
        "blk": int(s["blocksFavour"]), "pf": int(s["foulsCommited"]),
        "pir": int(s["valuation"]), "pm": int(s["plusMinus"]),
    }


def norm_totals(t):
    return {
        "pts": int(t["points"]),
        "fg2m": int(t["fieldGoalsMade2"]), "fg2a": int(t["fieldGoalsAttempted2"]),
        "fg3m": int(t["fieldGoalsMade3"]), "fg3a": int(t["fieldGoalsAttempted3"]),
        "ftm": int(t["freeThrowsMade"]), "fta": int(t["freeThrowsAttempted"]),
        "oreb": int(t["offensiveRebounds"]), "dreb": int(t["defensiveRebounds"]),
        "reb": int(t["totalRebounds"]), "ast": int(t["assistances"]),
        "stl": int(t["steals"]), "tov": int(t["turnovers"]),
        "blk": int(t["blocksFavour"]), "pf": int(t["foulsCommited"]),
        "pir": int(t["valuation"]),
    }


def box_score(code, paok_home):
    os.makedirs(BOX_DIR, exist_ok=True)
    path = os.path.join(BOX_DIR, f"{code}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    raw = get(f"/games/{code}/stats")
    us, them = (raw["local"], raw["road"]) if paok_home else (raw["road"], raw["local"])
    box = {
        "players": [norm_player_stats(p) for p in us["players"]],
        "team": norm_totals(us["total"]),
        "opp": norm_totals(them["total"]),
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(box, f, ensure_ascii=False, indent=1)
    return box


def main():
    people = get(f"/clubs/{CLUB}/people")
    roster, staff = [], []
    for x in people:
        p = x["person"]
        if not x.get("active"):
            continue
        if x["type"] == "J":
            roster.append({
                "no": x["dorsal"],
                "name": title_name(p["name"]),
                "pos": x.get("positionName") or "",
                "nat": (p.get("country") or {}).get("code", ""),
                "height": p.get("height") or None,
                "born": (p.get("birthDate") or "")[:10],
                "from": team_case(x.get("lastTeam") or ""),
                "photo": (x.get("images") or {}).get("headshot"),
            })
        elif x["type"] in ("E", "A"):
            staff.append({"name": title_name(p["name"]), "role": "Head Coach" if x["type"] == "E" else "Assistant Coach"})
    roster.sort(key=lambda r: int(r["no"]) if r["no"].isdigit() else 999)
    staff.sort(key=lambda s: s["role"] != "Head Coach")

    games = []
    for g in get("/games")["data"]:
        home, away = g["local"], g["road"]
        if CLUB not in (home["club"]["code"], away["club"]["code"]):
            continue
        is_home = home["club"]["code"] == CLUB
        opp = away if is_home else home
        game = {
            "comp": "EuroCup",
            "code": g["gameCode"],
            "round": g.get("roundAlias") or f"Round {g['round']}",
            "phase": g["phaseType"]["name"],
            "date": g["utcDate"],
            "home": is_home,
            "opp": club_name(opp["club"]),
            "oppCrest": opp["club"]["images"].get("crest"),
            "venue": (g.get("venue") or {}).get("name", "").title(),
            "played": g["played"],
            "us": (home if is_home else away)["score"] if g["played"] else None,
            "them": opp["score"] if g["played"] else None,
        }
        if g["played"]:
            try:
                game["box"] = box_score(g["gameCode"], is_home)
            except Exception as e:  # box score may lag behind the result
                print("box score unavailable for", g["gameCode"], e)
        games.append(game)
    games.sort(key=lambda g: g["date"])

    # Standings: latest round that PAOK's group has played (API returns all groups per round).
    played_rounds = [int(g["round"].split()[-1]) for g in games if g["played"] and g["round"].split()[-1].isdigit()]
    rnd = max(played_rounds) if played_rounds else 1
    standings, group_name = [], ""
    for grp in get(f"/rounds/{rnd}/standings"):
        codes = [s["club"]["code"] for s in grp["standings"]]
        if CLUB in codes:
            group_name = grp["group"]["name"]
            for s in grp["standings"]:
                d = s["data"]
                standings.append({
                    "pos": d["position"], "team": club_name(s["club"]),
                    "crest": s["club"]["images"].get("crest"), "paok": s["club"]["code"] == CLUB,
                    "gp": d["gamesPlayed"], "w": d["gamesWon"], "l": d["gamesLost"],
                    "pf": d["pointsFavour"], "pa": d["pointsAgainst"],
                })
    standings.sort(key=lambda s: s["pos"])

    out = {
        "competition": "BKT EuroCup",
        "season": "2026-27",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "https://www.euroleaguebasketball.net/eurocup/",
        "group": group_name,
        "staff": staff,
        "roster": roster,
        "games": games,
        "standings": standings,
    }
    with open(os.path.join(DATA, "eurocup.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"EuroCup: {len(roster)} players, {len(games)} games ({sum(g['played'] for g in games)} played), standings round {rnd}")


if __name__ == "__main__":
    main()
