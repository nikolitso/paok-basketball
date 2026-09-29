"""Fetch PAOK's Greek Basket League data from esake.gr into data/gbl.json.

Run: python scripts/update_gbl.py
Also imports every game listed in data/extra_games.json (Super Cup, Greek Cup, playoffs...).
To add one of those, run:  python scripts/add_game.py <esake game url> --comp "Greek Cup" --round "Final"
Box scores of finished games are cached in data/gbl_box/ so each is downloaded once.
"""
import html
import json
import os
import re
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://www.esake.gr/el/action/"
CHAMPIONSHIP = "184645B9"  # Stoiximan GBL 2026-2027
TEAM = "0000000C"  # PAOK
ROUNDS = 26
SEASON_START_YEAR = 2026

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
BOX_DIR = os.path.join(DATA, "gbl_box")

TEAM_NAMES = {  # accent-free Greek fragment -> English name
    "ΠΑΟΚ": "PAOK", "ΟΛΥΜΠΙΑΚΟΣ": "Olympiacos", "ΠΑΝΑΘΗΝΑΙΚΟΣ": "Panathinaikos", "ΑΕΚ": "AEK",
    "ΑΡΗΣ": "Aris", "ΠΕΡΙΣΤΕΡΙ": "Peristeri", "ΠΡΟΜΗΘΕΑΣ": "Promitheas", "ΗΡΑΚΛΗΣ": "Iraklis",
    "ΜΥΚΟΝΟΣ": "Mykonos", "ΜΑΡΟΥΣΙ": "Maroussi", "ΚΟΛΟΣΣΟΣ": "Kolossos", "ΔΟΞΑ": "Doxa Lefkadas",
    "ΚΑΡΔΙΤΣΑ": "Karditsa", "VIKOS FALCONS": "Vikos Falcons", "ΠΑΝΙΩΝΙΟΣ": "Panionios", "ΛΑΥΡΙΟ": "Lavrio",
}
COUNTRIES = {
    "ΕΛΛΑΔΑ": "GRE", "ΗΠΑ": "USA", "ΤΟΥΡΚΙΑ": "TUR", "ΚΑΝΑΔΑΣ": "CAN", "ΝΙΓΗΡΙΑ": "NGR",
    "ΣΕΡΒΙΑ": "SRB", "ΓΑΛΛΙΑ": "FRA", "ΙΤΑΛΙΑ": "ITA", "ΙΣΠΑΝΙΑ": "ESP", "ΓΕΡΜΑΝΙΑ": "GER",
}
POSITIONS = {"PG": "Guard", "SG": "Guard", "SF": "Forward", "PF": "Forward", "C": "Center"}
MONTHS = {"ΙΑΝ": 1, "ΦΕΒ": 2, "ΜΑΡ": 3, "ΑΠΡ": 4, "ΜΑΙ": 5, "ΙΟΥΝ": 6, "ΙΟΥΛ": 7,
          "ΑΥΓ": 8, "ΣΕΠ": 9, "ΟΚΤ": 10, "ΝΟΕ": 11, "ΔΕΚ": 12}


def fetch(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "Mozilla/5.0 (paok-basketball-site)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def cells(page):
    """Flatten a page to its text pieces (one per HTML text node)."""
    page = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", "|", page))
    return [c.strip() for c in text.split("|") if c.strip()]


def plain(s):
    """Upper-case and strip Greek accents, for matching."""
    return "".join(ch for ch in unicodedata.normalize("NFD", s.upper()) if unicodedata.category(ch) != "Mn")


def team_name(greek):
    g = plain(greek)
    for key, eng in TEAM_NAMES.items():
        if key in g:
            return eng
    return greek.title()


def athens_to_utc(day, month, hh, mm):
    year = SEASON_START_YEAR if month >= 7 else SEASON_START_YEAR + 1
    local = datetime(year, month, day, hh, mm)
    # Greece: UTC+3 from last Sunday of March to last Sunday of October, else UTC+2.
    def last_sunday(m):
        d = datetime(year, m, 31)
        return d - timedelta(days=(d.weekday() + 1) % 7)
    offset = 3 if last_sunday(3) <= local < last_sunday(10) else 2
    return (local - timedelta(hours=offset)).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_date(s):
    """'Σαβ 3 Οκτ - 15:00' or 'Σαβ 3 Οκτ', '15:00' -> UTC ISO string."""
    m = re.search(r"(\d{1,2})\s+([^\s\d-]+)(?:\s*-?\s*(\d{1,2}):(\d{2}))?", s)
    if not m:
        return None
    mon = MONTHS.get(plain(m.group(2))[:4]) or MONTHS.get(plain(m.group(2))[:3])
    if not mon:
        return None
    if m.group(3) is None:  # time not announced yet: keep the day, mark with T00:00:00 (no Z)
        year = SEASON_START_YEAR if mon >= 7 else SEASON_START_YEAR + 1
        return f"{year}-{mon:02d}-{int(m.group(1)):02d}T00:00:00"
    return athens_to_utc(int(m.group(1)), mon, int(m.group(3)), int(m.group(4)))


def person(last, first):
    return f"{first} {last}".title()


def num(s):
    return int(s) if re.fullmatch(r"-?\d+", s) else 0


def made_att(s):
    a, b = [p.strip() for p in s.split("-")]
    return num(a), num(b)


def stat_row(v):
    """16 ESAKE columns: P 2PM-A 3PM-A FTM-A REB DREB OREB AST BLK BLK-A FOULS_DRAWN FOULS_COMMITTED STL TO MIN PIR."""
    fg2m, fg2a = made_att(v[1])
    fg3m, fg3a = made_att(v[2])
    ftm, fta = made_att(v[3])
    sec = 0
    if re.fullmatch(r"\d+:\d+:\d+", v[14]):
        h, m, s = map(int, v[14].split(":"))
        sec = h * 3600 + m * 60 + s
    return {
        "pts": num(v[0]), "fg2m": fg2m, "fg2a": fg2a, "fg3m": fg3m, "fg3a": fg3a, "ftm": ftm, "fta": fta,
        "reb": num(v[4]), "dreb": num(v[5]), "oreb": num(v[6]), "ast": num(v[7]), "blk": num(v[8]),
        "pf": num(v[11]), "stl": num(v[12]), "tov": num(v[13]), "sec": sec, "pir": num(v[15]),
    }


def parse_game(idgame):
    """Parse an ESAKE game page (mode=3). Returns header info and both teams' box scores."""
    c = cells(fetch(f"EsakegameView?idgame={idgame}&mode=3"))
    i = c.index("vs")
    home, hs, as_, away = c[i - 2], c[i - 1], c[i + 1], c[i + 2]
    # header just before the home team: round, day, time, venue, tv
    head = c[max(0, i - 8):i - 2]
    date = None
    for k in range(len(head) - 1):
        if re.search(r"\d{1,2}\s+\S+$", head[k]) and re.fullmatch(r"\d{1,2}:\d{2}", head[k + 1]):
            date = parse_date(head[k] + " " + head[k + 1])
            venue = head[k + 2] if k + 2 < len(head) else ""
    teams = []
    for j, cell in enumerate(c):
        if cell == "ΑΝΑΛΥΤΙΚΑ ΣΤΑΤΙΣΤΙΚΑ":
            name = c[j + 1]
            k = c.index("RANK", j) + 1
            players = []
            while c[k].startswith("#"):
                row = stat_row(c[k + 3:k + 19])
                row.update({"no": c[k][1:], "name": person(c[k + 1], c[k + 2]), "start": False, "pm": None})
                players.append(row)
                k += 19
            t = c.index("ΣΥΝΟΛΟ", k) + 1
            total = stat_row(c[t:t + 16])
            total.pop("sec")
            teams.append({"name": name, "players": players, "total": total})
    return {"home": home, "away": away, "hs": num(hs), "as": num(as_), "date": date,
            "venue": venue.title() if date else "", "teams": teams}


def box_score(idgame):
    os.makedirs(BOX_DIR, exist_ok=True)
    path = os.path.join(BOX_DIR, f"{idgame}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    g = parse_game(idgame)
    us = next(t for t in g["teams"] if "ΠΑΟΚ" in plain(t["name"]))
    them = next(t for t in g["teams"] if t is not us)
    box = {"players": us["players"], "team": us["total"], "opp": them["total"]}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(box, f, ensure_ascii=False, indent=1)
    return box


def league_games():
    games = []
    for r in range(1, ROUNDS + 1):
        page = fetch(f"EsakeResults?idchampionship={CHAMPIONSHIP}&idteam={TEAM}&idseason=00000001&series={r:02d}")
        for block in page.split('class="esake-program-game"')[1:]:
            block = block.split("esake-news-box")[0]
            ids = re.findall(r"idgame=([0-9A-F]+)&mode=3", block)
            info = re.findall(r'esake-program-game-info[^>]*>(?:<img[^>]*>)?([^<]*)<', block)
            score_box = block.split("esake-program-game-final-score row", 1)[-1].split("esake-program-game-hidden-row")[0]
            cols = re.split(r'<div class="col-lg-\d', score_box)[1:4]
            spans = [" ".join(cells(col)).replace("\xa0", " ").strip(' ">') for col in cols]
            if not ids or len(spans) < 3:
                continue
            home, score, away = spans[0], spans[1], spans[2]
            sc = re.findall(r"\d+", score)
            is_home = "ΠΑΟΚ" in plain(home)
            played = len(sc) == 2
            game = {
                "comp": "GBL", "code": ids[0], "round": f"Round {r}", "phase": "Regular Season",
                "date": parse_date(info[0]) if info else None, "home": is_home,
                "opp": team_name(away if is_home else home), "oppCrest": None,
                "venue": info[1].title() if len(info) > 1 else "", "tv": info[2] if len(info) > 2 else "",
                "played": played,
                "us": (int(sc[0]) if is_home else int(sc[1])) if played else None,
                "them": (int(sc[1]) if is_home else int(sc[0])) if played else None,
                "url": f"https://www.esake.gr/el/action/EsakegameView?idgame={ids[0]}&mode=3",
            }
            if played:
                game["box"] = box_score(ids[0])
            games.append(game)
    return games


def extra_games():
    path = os.path.join(DATA, "extra_games.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        extras = json.load(f)
    games = []
    for e in extras:
        g = parse_game(e["id"])
        is_home = "ΠΑΟΚ" in plain(g["home"])
        played = (g["hs"] + g["as"]) > 0
        game = {
            "comp": e["comp"], "code": e["id"], "round": e.get("round", ""), "phase": e.get("round", ""),
            "date": g["date"], "home": is_home, "opp": team_name(g["away"] if is_home else g["home"]),
            "oppCrest": None, "venue": g["venue"], "played": played,
            "us": (g["hs"] if is_home else g["as"]) if played else None,
            "them": (g["as"] if is_home else g["hs"]) if played else None,
            "url": f"https://www.esake.gr/el/action/EsakegameView?idgame={e['id']}&mode=3",
        }
        if e.get("neutral"):
            game["neutral"] = True
        if played:
            game["box"] = box_score(e["id"])
        games.append(game)
    return games


def roster():
    c = cells(fetch(f"EsaketeamView?idteam={TEAM}&mode=1"))
    players = []
    for i, cell in enumerate(c):
        if cell == "#" and i + 4 < len(c) and c[i + 1].isdigit() and c[i + 5] == "ΟΜΑΔΑ":
            block = c[i:i + 20]
            def after(label):
                return block[block.index(label) + 1] if label in block else ""
            born = after("ΗΜ. ΓΕΝΝΗΣΗΣ")
            d, m, y = (born.split("-") + ["", "", ""])[:3]
            height = after("ΥΨΟΣ").replace(",", "")
            players.append({
                "no": c[i + 1], "name": person(c[i + 2], c[i + 3]),
                "pos": POSITIONS.get(c[i + 4], c[i + 4]), "posCode": c[i + 4],
                "nat": COUNTRIES.get(plain(after("ΧΩΡΑ")), after("ΧΩΡΑ").title()),
                "height": int(height) if height.isdigit() else None,
                # ESAKE uses a placeholder date for some new signings
                "born": f"{y}-{m}-{d}" if y.isdigit() and int(y) < 2015 else "",
            })
    players.sort(key=lambda p: int(p["no"]))
    return players


def standings():
    c = cells(fetch(f"EsakeRanking?idchampionship={CHAMPIONSHIP}"))
    k = c.index("ΔΙΑΦΟΡΑ ΠΟΝΤΩΝ") + 1
    rows = []
    while k + 9 < len(c) and c[k].isdigit():
        # POS TEAM POINTS GP W-L HOME AWAY PTS+/- TIE DIFF
        w, l = made_att(c[k + 4])
        pf = pa = None
        if "-" in c[k + 7] and c[k + 7] != "-":
            pf, pa = made_att(c[k + 7])
        rows.append({"pos": int(c[k]), "team": team_name(c[k + 1]), "paok": "ΠΑΟΚ" in plain(c[k + 1]),
                     "pts": num(c[k + 2]), "gp": num(c[k + 3]), "w": w, "l": l, "pf": pf, "pa": pa,
                     "diff": num(c[k + 9])})
        k += 10
    return rows


def main():
    def key(name):
        return name.lower().replace("-", " ").split()[-1]

    with open(os.path.join(DATA, "eurocup.json"), encoding="utf-8") as f:
        ec_roster = {key(p["name"]): p for p in json.load(f)["roster"]}
    players = roster()
    for p in players:  # fill gaps (birth date, photo) from the EuroCup feed when surnames match
        ec = ec_roster.get(key(p["name"]))
        if ec:
            p["born"] = p["born"] or ec.get("born", "")
            p["photo"] = ec.get("photo")
            p["from"] = ec.get("from", "")

    games = league_games() + extra_games()
    games.sort(key=lambda g: g["date"] or "9999")
    out = {
        "competition": "Stoiximan GBL",
        "season": "2026-27",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "https://www.esake.gr/",
        "roster": players,
        "games": games,
        "standings": standings(),
    }
    with open(os.path.join(DATA, "gbl.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"GBL: {len(players)} players, {len(games)} games ({sum(g['played'] for g in games)} played), "
          f"{len(out['standings'])} teams in standings")


if __name__ == "__main__":
    main()
