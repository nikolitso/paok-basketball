# PAOK Basketball site: update checklist

Site: https://antonisnikolitsopoulos.com/paok-basketball/ · Repo: `nikolitso/paok-basketball` · Local copy: `Desktop\paok-basketball`

---

## 1. Every night: automatic (nothing to do)

The **Update stats** GitHub Action runs at **23:59 Greek time** and refreshes, in order:

- [ ] EuroCup: roster, schedule, results, box scores, Group D table
- [ ] Greek League: roster, schedule, results, box scores, +/- (from the play-by-play), table
- [ ] League stats for every team (League page, averages, ranks)
- [ ] Power ratings (Standings page)
- [ ] Next-game scouting and match-day projections
- [ ] Player photos and staff (club site)

**Check it ran (once a week is enough):** GitHub → *Actions* → *Update stats*: the latest run is green.
If a run is red or missing: open it, click **Re-run all jobs**, or use **Run workflow** for a fresh run. A one-off red run is usually GitHub having no free server; just run it again.

---

## 2. Match day: before the game

- [ ] **Team news:** who is out for PAOK and the opponent (injuries, rest, left out of the 12).
  - The Claude scheduled task *PAOK match-day lineup check* looks at 11:00 and 17:00 (only while the Claude app is open).
  - Or paste the news / the official 12-man lists to Claude: it records them in `data/lineups.json`.
- [ ] **Next Game page:** projections are unlocked, the lineup line says "confirmed team news", absences are listed.

---

## 3. After every game

### EuroCup
- [ ] Nothing to do: everything arrives with the 23:59 run.
- [ ] For an immediate update: GitHub → *Actions* → *Update stats* → **Run workflow** (about 1–2 minutes), once the game has been over for a while.

### Greek League
- [ ] Nothing required: result, box score and +/- arrive automatically once ESAKE has posted the game (sometimes the next day).
- [ ] **Want it on the site right away?** Ask Claude "update with PAOK–<opponent>". It finds the live box score and links it.
- [ ] Note: a game only counts as finished 2½ hours after tip-off (live pages show partial stats).

### Quick check after the update
- [ ] Schedule: result and W/L, "Match report" link, box score opens
- [ ] Home: last result, records, form
- [ ] Team Stats / Player Stats / Player Profiles include the game; on/off table updated
- [ ] Standings (power + official) and League page show the new round
- [ ] Next Game has moved to the next opponent

---

## 4. Games outside the regular season (Greek Cup, Super Cup, play-offs)

- [ ] Send Claude the game's ESAKE link plus competition and round (e.g. "Greek Cup, quarter-final").
  It runs `scripts/add_game.py`; from then on the game updates automatically, +/- included.
- [ ] For an older game with no +/-: send the play-by-play Excel export (as with the Super Cup files).

---

## 5. Roster and contracts

| Event | What to tell Claude | File it changes |
|---|---|---|
| New signing not yet in the official rosters | Name + link to the announcement | `data/roster_additions.json`, `data/player_info.json` |
| Player leaving / to hide from the site | "Remove <name>" | `data/excluded_players.json` → `players` |
| Youth player: hide until he plays | "Hide <name> until he plays" | `data/excluded_players.json` → `until_played` |
| Contract extension, joined date, previous club | The news item | `data/player_info.json` |
| Number assigned to a new player | Nothing: it comes in with the rosters | — |

New signings disappear from the manual list by themselves once an official roster lists them.

---

## 6. Monthly / occasional checks

- [ ] Roster page: photos present for everyone (new players appear once the club site adds them)
- [ ] Contracts in `player_info.json` still correct after transfer windows
- [ ] The automatic match-day lineup task still listed under **Scheduled** in the Claude app
- [ ] Greek League team names: if ESAKE renames a team (new sponsor, Greek/Latin spelling), check the Standings / League pages for a team showing twice or with an odd name, and tell Claude

---

## 7. Season milestones

- [ ] **EuroCup regular season ends (13 Jan 2027):** play-off format and groups change: ask Claude to adapt the Standings/League EuroCup views.
- [ ] **Greek League regular season ends (round 26):** add play-off games as they're scheduled (section 4).
- [ ] **New season (summer 2027):** ask Claude to switch season codes (EuroCup `U2027`, new ESAKE championship id), roll last season into the power-rating starting point, and reset rosters/contracts.

---

## 8. House rules for the site

- Never mention data sources in the site's text.
- Possessions per game (overtime included) is the tempo stat, not pace.
- EuroCup comparisons are within PAOK's group (Group D).
- Projections are hidden on the Standings page for now (still computed).
- After changing `app.js` or `styles.css`, bump the `?v=` number in `index.html` so browsers load the new version.

---

## 9. If something looks wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Old layout / error message on the site | Browser cache | **Ctrl+F5** |
| Result missing the day after a game | Nightly run failed, or ESAKE hasn't posted yet | Check *Actions*; ask Claude to update with the live box score |
| A player shown twice / missing in stats | Different spelling in two sources | Tell Claude the two spellings |
| A team with an odd name in tables | ESAKE renamed or respelled it | Tell Claude |
| Next Game shows an old opponent | Nightly run didn't run | **Run workflow** |
