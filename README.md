# PAOK Basketball 2026-27

Unofficial fan site: rosters, schedule, results, team and player stats for PAOK in the
**Stoiximan GBL** (Greek League), the **BKT EuroCup** and the Greek Super Cup / Cup.

It's a static site (`index.html`, `styles.css`, `app.js`) that reads JSON files in `data/`.

## How the data updates

A GitHub Action (`.github/workflows/update-data.yml`) runs every 2 hours and:

| Script | Source | What it gets |
|---|---|---|
| `scripts/update_eurocup.py` | Euroleague public API | EuroCup roster, staff, schedule, box scores, Group D standings |
| `scripts/update_gbl.py` | esake.gr | GBL roster, all 26 rounds, box scores, standings, plus games in `data/extra_games.json` |

Regular-season league and EuroCup games are picked up automatically, with no manual steps.
To run it right away: **Actions → Update stats → Run workflow**.

## Adding cup / Super Cup / playoff games

These aren't in the regular-season schedule, so add them from their ESAKE link:

```bash
python scripts/add_game.py "https://www.esake.gr/el/action/EsakegameView?idgame=XXXXXXXX&mode=3" --comp "Greek Cup" --round "Quarter-final"
python scripts/update_gbl.py
```

Use `--neutral` for games at a neutral venue.

## Run locally

```bash
python scripts/update_eurocup.py
python scripts/update_gbl.py
python -m http.server 8000
```

Then open http://localhost:8000.
