"""Decide which competitions tonight's update needs, from the schedules.

Prints the decision and, inside GitHub Actions, writes `eurocup=true|false` and `gbl=true|false`
to $GITHUB_OUTPUT for the workflow steps.

- EuroCup: any EuroCup game (any group, so league stats stay complete) started in the last 30 hours.
- Greek League: any league game started in the last 30 hours, or a PAOK league game from the last 4 days
  whose result hasn't come in yet (the league can post results late).
- Both: when the run was started by hand, on Mondays (weekly full refresh: rosters, late corrections),
  or when a schedule can't be read (better to update than to miss a game).
"""
import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
NOW = datetime.now(timezone.utc)
RECENT = timedelta(hours=30)


def when(iso):
    if not iso:
        return None
    if iso.endswith("Z"):
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return datetime.fromisoformat(iso).replace(tzinfo=timezone.utc)  # day known, time not announced


def recent(dt):
    return dt is not None and NOW - RECENT <= dt <= NOW


def eurocup_needed():
    req = urllib.request.Request("https://api-live.euroleague.net/v2/competitions/U/seasons/U2026/games",
                                 headers={"User-Agent": "paok-basketball-site"})
    with urllib.request.urlopen(req, timeout=30) as r:
        games = json.load(r)["data"]
    return any(recent(when(g.get("utcDate"))) for g in games)


def gbl_needed():
    # all fixtures, with dates, as saved by the last Greek League schedule read
    with open(os.path.join(DATA, "league_cache", "gbl_schedule.json"), encoding="utf-8") as f:
        sched = json.load(f)
    if any(recent(when(g.get("date"))) for games in sched.values() for g in games):
        return True
    # a PAOK game (league or cup) from the last few days still without a result
    with open(os.path.join(DATA, "gbl.json"), encoding="utf-8") as f:
        paok = json.load(f)["games"]
    return any(not g["played"] and when(g["date"]) and NOW - timedelta(days=4) <= when(g["date"]) <= NOW for g in paok)


def main():
    manual = os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch" or not os.environ.get("GITHUB_ACTIONS")
    monday = NOW.astimezone(timezone(timedelta(hours=3))).weekday() == 0
    plan = {}
    for comp, check in (("eurocup", eurocup_needed), ("gbl", gbl_needed)):
        if manual or monday:
            plan[comp] = True
            continue
        try:
            plan[comp] = check()
        except Exception as e:  # can't tell: update rather than risk missing a game
            print(f"{comp}: schedule unavailable ({e}), updating anyway")
            plan[comp] = True
    reason = "run started by hand" if manual else "weekly full refresh (Monday)" if monday else "games in the last 30 hours"
    print(f"Plan ({reason}): EuroCup {'yes' if plan['eurocup'] else 'no'}, Greek League {'yes' if plan['gbl'] else 'no'}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            for k, v in plan.items():
                f.write(f"{k}={'true' if v else 'false'}\n")
            comps = " ".join(c for c, k in (("EuroCup", "eurocup"), ("GBL", "gbl")) if plan[k])
            f.write(f"comps={comps}\n")  # arguments for the scripts that cover both competitions
            f.write(f"full={'true' if manual or monday else 'false'}\n")  # photos and staff: weekly is plenty


if __name__ == "__main__":
    main()
