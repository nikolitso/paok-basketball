/* PAOK Basketball 2026-27 — static site reading data/eurocup.json and data/gbl.json */
const TZ = 'Europe/Athens';
const COMPS = { GBL: 'Greek League', EuroCup: 'EuroCup', 'Greek Super Cup': 'Super Cup', 'Greek Cup': 'Greek Cup' };
const state = { ec: null, gbl: null, games: [], filters: { profTeam: 'PAOK', profiles: 'All', scout: null, schedule: 'All', team: 'GBL', players: 'GBL', roster: 'GBL', mode: 'avg' }, sort: { key: 'pts', dir: -1 } };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const compName = (c) => COMPS[c] || c;
const pct = (m, a) => (a ? ((100 * m) / a).toFixed(1) : '–');
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const mins = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/* dates: "…Z" = exact UTC time; no Z = day known, time to be announced */
const hasTime = (d) => d && d.endsWith('Z');
const toDate = (d) => new Date(hasTime(d) ? d : d + 'Z');
function fmtDate(d, opts = {}) {
  if (!d) return 'TBA';
  const o = { timeZone: hasTime(d) ? TZ : 'UTC', weekday: 'short', day: 'numeric', month: 'short', ...opts };
  return new Intl.DateTimeFormat('en-GB', o).format(toDate(d));
}
const fmtTime = (d) => (hasTime(d) ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(toDate(d)) : 'Time TBA');
const isOver = (g) => g.played;
const result = (g) => (g.us > g.them ? 'W' : 'L');
const where = (g) => (g.neutral ? 'Neutral' : g.home ? 'Home' : 'Away');
const vsAt = (g) => (g.neutral ? 'vs' : g.home ? 'vs' : '@');

async function load() {
  const get = (f) => fetch(`data/${f}?v=${Date.now()}`).then((r) => r.json());
  let hidden;
  [state.ec, state.gbl, state.scout, hidden, state.club, state.clubStaff] = await Promise.all([get('eurocup.json'), get('gbl.json'),
    get('scout.json').catch(() => ({ reports: [] })), get('excluded_players.json').catch(() => ({})), get('paokbc.json').catch(() => ({})), get('paokbc_staff.json').catch(() => [])]);
  // players hidden until their first game (e.g. youth players registered for depth)
  const surnameOf = (n) => n.toLowerCase().replace(/-/g, ' ').split(' ').pop();
  const played = new Set([...state.ec.games, ...state.gbl.games].flatMap((g) => (g.box ? g.box.players.filter((p) => p.sec > 0).map((p) => surnameOf(p.name)) : [])));
  const waiting = new Set((hidden.until_played || []).map((n) => n.toLowerCase()).filter((n) => !played.has(n)));
  for (const d of [state.ec, state.gbl]) d.roster = d.roster.filter((r) => !waiting.has(surnameOf(r.name)));
  state.games = [...state.ec.games, ...state.gbl.games].filter((g) => g.date).sort((a, b) => toDate(a.date) - toDate(b.date));
  window.addEventListener('hashchange', render);
  render();
}

function render() {
  const tab = (location.hash || '#home').slice(1);
  const view = VIEWS[tab] ? tab : 'home';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === view));
  $('#app').innerHTML = VIEWS[view]();
  if (view === 'home') startCountdown();
  window.scrollTo(0, 0);
}
const rerender = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };

function seg(name, options) {
  return `<div class="seg">${options.map(([v, label]) =>
    `<button class="${state.filters[name] === v ? 'on' : ''}" onclick="state.filters['${name}']='${v}';rerender()">${esc(label)}</button>`).join('')}</div>`;
}
const compsWithGames = () => ['GBL', 'EuroCup', ...new Set(state.games.map((g) => g.comp).filter((c) => !['GBL', 'EuroCup'].includes(c)))];

/* ---------- aggregation ---------- */
function gamesWithBox(comp) {
  return state.games.filter((g) => g.played && g.box && (comp === 'All' || g.comp === comp));
}
function record(games) {
  const w = games.filter((g) => g.us > g.them).length;
  return { w, l: games.length - w };
}
function playerTotals(comp) {
  const map = new Map();
  for (const g of gamesWithBox(comp)) {
    for (const p of g.box.players) {
      const key = p.name.toLowerCase().replace(/-/g, ' ').split(' ').pop(); // surname: feeds spell first names differently
      if (!map.has(key)) map.set(key, { name: p.name, no: p.no, gp: 0, gs: 0, sec: 0, pts: 0, fg2m: 0, fg2a: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, tov: 0, blk: 0, pf: 0, pir: 0, pm: 0, hasPm: false, high: 0 });
      const t = map.get(key);
      if (!p.sec) continue; // DNP
      t.gp++; if (p.start) t.gs++;
      for (const k of ['sec', 'pts', 'fg2m', 'fg2a', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'stl', 'tov', 'blk', 'pf', 'pir']) t[k] += p[k] || 0;
      if (p.pm !== null && p.pm !== undefined) { t.pm += p.pm; t.pmg = (t.pmg || 0) + 1; t.hasPm = true; }
      t.high = Math.max(t.high, p.pts);
    }
  }
  return [...map.values()].filter((t) => t.gp > 0);
}
function teamTotals(games) {
  const sum = (side) => games.reduce((acc, g) => { for (const [k, v] of Object.entries(g.box[side])) acc[k] = (acc[k] || 0) + v; return acc; }, {});
  return { us: sum('team'), them: sum('opp'), n: games.length };
}

/* ---------- views ---------- */
const VIEWS = {
  home() {
    const now = Date.now();
    const next = state.games.find((g) => !g.played && toDate(g.date).getTime() + 3 * 3600e3 > now);
    const last = [...state.games].reverse().find((g) => g.played);
    const recent = state.games.filter((g) => g.played).slice(-5);
    const comps = compsWithGames().filter((c) => state.games.some((g) => g.comp === c && g.played));
    const nextBlock = next ? `
      <section class="card dark next-game">
        <div>
          <div class="label">Next game · ${esc(compName(next.comp))} · ${esc(next.round)}</div>
          <div class="big vs">PAOK ${vsAt(next)} ${esc(next.opp)}</div>
          <div class="muted">${fmtDate(next.date, { weekday: 'long', year: 'numeric' })} · ${fmtTime(next.date)} · ${esc(next.venue)}${next.tv ? ' · TV: ' + esc(next.tv) : ''}</div>
          ${oppContext(next)}
          ${state.scout.reports.some((r) => String(r.code) === String(next.code)) ? `<a class="report" style="color:#fff" href="#scout" onclick="state.filters.scout='${next.comp}'">Scouting report & projections →</a>` : ''}
        </div>
        ${hasTime(next.date) ? `<div class="countdown" id="countdown" data-t="${next.date}"></div>` : ''}
      </section>` : '';
    const lastBlock = last ? `
      <div class="card click" onclick="openBox('${last.code}')" style="cursor:pointer">
        <div class="label">Last result · ${esc(compName(last.comp))} · ${esc(last.round)}</div>
        <div class="big"><span class="wl ${result(last)}">${result(last)}</span> ${last.us}–${last.them}</div>
        <div>PAOK ${vsAt(last)} ${esc(last.opp)} <span class="muted">· ${fmtDate(last.date)}</span></div>
        ${last.box ? `<div class="note">Top scorer: ${topScorer(last)} · Click for box score</div>` : ''}
      </div>` : '';
    const recBlock = `
      <div class="card">
        <div class="label">Records</div>
        <ul class="leaders">
          ${compsWithGames().map((c) => { const gs = state.games.filter((g) => g.comp === c && g.played); const r = record(gs); return `<li><span>${esc(compName(c))}</span><b>${r.w}–${r.l}</b></li>`; }).join('')}
        </ul>
        <div class="note">Form: ${recent.map((g) => `<span class="wl ${result(g)}" title="${esc(g.opp)} ${g.us}-${g.them}">${result(g)}</span>`).join(' ') || '–'}</div>
      </div>`;
    const leaders = comps.map((c) => {
      const ps = playerTotals(c);
      if (!ps.length) return '';
      const top = (k) => [...ps].sort((a, b) => b[k] / b.gp - a[k] / a.gp)[0];
      return `<div class="card"><div class="label">${esc(compName(c))} leaders (per game)</div><ul class="leaders">
        ${[['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['pir', 'PIR']].map(([k, l]) => { const p = top(k); return `<li><span>${l}: ${esc(p.name)}</span><b>${f1(p[k] / p.gp)}</b></li>`; }).join('')}
      </ul></div>`;
    }).join('');
    const upcoming = state.games.filter((g) => !g.played && g !== next).slice(0, 5);
    return `${nextBlock}
      <h2>Overview</h2>
      <div class="grid three">${lastBlock}${recBlock}${leaders}</div>
      <h2>Coming up</h2>
      <div class="games">${upcoming.map((g) => gameRow(g)).join('') || '<p class="empty">No more games scheduled.</p>'}</div>`;
  },

  roster() {
    const comp = state.filters.roster;
    const ec = state.ec.roster, gbl = state.gbl.roster;
    const sur = (n) => n.toLowerCase().replace(/-/g, ' ').split(' ').pop();
    const inEc = new Set(ec.map((p) => sur(p.name))), inGbl = new Set(gbl.map((p) => sur(p.name)));
    const list = comp === 'EuroCup' ? ec : gbl;
    const club = (name) => { // paokbc.gr entry: match on the full surname or any part of it ("Mitrou-Long" ~ "Mitrou")
      const parts = name.toLowerCase().split(' ').slice(1).join(' ');
      const keys = [parts.replace(/[^a-z]/g, ''), ...parts.split(/[\s-]+/).map((w) => w.replace(/[^a-z]/g, ''))];
      return keys.map((k) => state.club[k]).find(Boolean) || {};
    };
    const age = (b) => { if (!b) return null; const d = new Date(b), n = new Date(); return n.getFullYear() - d.getFullYear() - (n < new Date(n.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0); };
    const cards = list.map((p) => {
      const c = club(p.name);
      const onlyHere = comp === 'EuroCup' ? !inGbl.has(sur(p.name)) : !inEc.has(sur(p.name));
      const h = p.height && p.height >= 160 ? (p.height / 100).toFixed(2) + ' m' : c.height ? c.height + ' m' : '';
      const facts = [
        ['Position', p.posCode ? `${p.posCode} · ${p.pos}` : p.pos], ['Height', h], ['Nationality', p.nat],
        ['Age', age(p.born) ? `${age(p.born)}` : ''], ['Born in', c.birthplace], ['Previous team', p.from],
      ].filter(([, v]) => v);
      return `<div class="card player-card">
        <div class="photo">${c.photo ? `<img src="${esc(c.photo)}" alt="${esc(p.name)}" loading="lazy">` : '<div class="no-photo">PAOK</div>'}
          <span class="num">${esc(p.no || '–')}</span></div>
        <div class="pc-body">
          <h3>${esc(p.name)}</h3>
          ${onlyHere ? `<span class="pill">${comp === 'EuroCup' ? 'EuroCup only' : 'GBL only'}</span>` : ''}
          <dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        </div></div>`;
    }).join('');
    const staffList = state.clubStaff.length ? state.clubStaff : state.ec.staff;
    const staff = staffList.map((s) => `<div class="card coach ${s.role === 'Head Coach' ? 'head' : ''}">
        <div class="coach-photo">${s.photo ? `<img src="${esc(s.photo)}" alt="${esc(s.name)}" loading="lazy">` : ''}</div>
        <div><div class="label">${esc(s.role)}</div><h3>${esc(s.name)}</h3>${s.bio ? `<p>${esc(s.bio)}</p>` : ''}</div>
      </div>`).join('');
    return `<h2>Roster</h2>
      ${seg('roster', [['GBL', `Greek League (${gbl.length})`], ['EuroCup', `EuroCup (${ec.length})`]])}
      <div class="grid roster-grid">${cards}</div>
      <p class="note">Registered roster from ${comp === 'EuroCup' ? 'the EuroCup' : 'ESAKE (Greek League)'}. The two leagues have different rules on foreign players, so the lists differ.
        Photos and profiles: PAOK BC.</p>
      <h2>Coaching staff</h2>
      <div class="grid staff-grid">${staff}</div>`;
  },

  schedule() {
    const f = state.filters.schedule;
    const list = state.games.filter((g) => f === 'All' || g.comp === f);
    const next = state.games.find((g) => !g.played);
    let month = '';
    const rows = list.map((g) => {
      const m = fmtDate(g.date, { weekday: undefined, day: undefined, month: 'long', year: 'numeric' });
      const head = m !== month ? `<div class="month">${m}</div>` : '';
      month = m;
      return head + gameRow(g, g === next);
    }).join('');
    const recChip = (c, label) => {
      const r = record(state.games.filter((g) => g.played && (c === 'All' || g.comp === c)));
      return `<div class="rec ${f === c ? 'on' : ''}"><span>${esc(label)}</span><b>${r.w}–${r.l}</b></div>`;
    };
    return `<h2>Schedule & Results</h2>
      <div class="records">${recChip('All', 'Overall')}${compsWithGames().map((c) => recChip(c, compName(c))).join('')}</div>
      <div class="controls">${seg('schedule', [['All', 'All'], ...compsWithGames().map((c) => [c, compName(c)])])}</div>
      <div class="games">${rows || '<p class="empty">No games.</p>'}</div>`;
  },

  team() {
    const comp = state.filters.team;
    const games = gamesWithBox(comp);
    const opts = [...compsWithGames().map((c) => [c, compName(c)]), ['All', 'All games']];
    if (!games.length) return `<h2>Team Stats</h2>${seg('team', opts)}<p class="empty">No ${esc(compName(comp))} games played yet.</p>`;
    const { us, them, n } = teamTotals(games);
    const r = record(games);
    const avg = (o, k) => f1(o[k] / n);
    const fgm = (o) => o.fg2m + o.fg3m, fga = (o) => o.fg2a + o.fg3a;
    const tile = (v, s) => `<div class="tile"><div class="v">${v}</div><div class="s">${s}</div></div>`;
    const cmp = [
      ['Points', avg(us, 'pts'), avg(them, 'pts')],
      ['FG%', pct(fgm(us), fga(us)), pct(fgm(them), fga(them))],
      ['2P%', pct(us.fg2m, us.fg2a), pct(them.fg2m, them.fg2a)],
      ['3P%', pct(us.fg3m, us.fg3a), pct(them.fg3m, them.fg3a)],
      ['3PA', avg(us, 'fg3a'), avg(them, 'fg3a')],
      ['FT%', pct(us.ftm, us.fta), pct(them.ftm, them.fta)],
      ['FTA', avg(us, 'fta'), avg(them, 'fta')],
      ['Rebounds', avg(us, 'reb'), avg(them, 'reb')],
      ['Off. rebounds', avg(us, 'oreb'), avg(them, 'oreb')],
      ['Assists', avg(us, 'ast'), avg(them, 'ast')],
      ['Steals', avg(us, 'stl'), avg(them, 'stl')],
      ['Turnovers', avg(us, 'tov'), avg(them, 'tov')],
      ['Blocks', avg(us, 'blk'), avg(them, 'blk')],
      ['Fouls', avg(us, 'pf'), avg(them, 'pf')],
      ['PIR', avg(us, 'pir'), avg(them, 'pir')],
    ];
    const log = games.map((g) => `<tr class="click" onclick="openBox('${g.code}')">
      <td class="l">${fmtDate(g.date)}</td><td class="l">${esc(compName(g.comp))}</td><td class="l">${vsAt(g)} ${esc(g.opp)}</td>
      <td><span class="wl ${result(g)}">${result(g)}</span></td><td><b>${g.us}–${g.them}</b></td>
      <td>${pct(g.box.team.fg2m + g.box.team.fg3m, g.box.team.fg2a + g.box.team.fg3a)}</td><td>${pct(g.box.team.fg3m, g.box.team.fg3a)}</td>
      <td>${g.box.team.reb}</td><td>${g.box.team.ast}</td><td>${g.box.team.tov}</td><td>${g.box.team.pir}</td></tr>`).join('');
    return `<h2>Team Stats</h2>${seg('team', opts)}
      <div class="tiles">
        ${tile(`${r.w}–${r.l}`, 'Record')}${tile(avg(us, 'pts'), 'Points scored / game')}${tile(avg(them, 'pts'), 'Points allowed / game')}
        ${tile((((us.pts - them.pts) / n) > 0 ? '+' : '') + f1((us.pts - them.pts) / n), 'Point margin / game')}
        ${tile(pct(us.fg3m, us.fg3a) + '%', '3-point %')}${tile(avg(us, 'ast'), 'Assists / game')}
      </div>
      <h2>PAOK vs opponents (per game)</h2>
      <div class="table-wrap" style="max-width:640px"><table>
        <thead><tr><th class="l">Stat</th><th>PAOK</th><th>Opponents</th></tr></thead>
        <tbody>${cmp.map(([l, a, b]) => `<tr><td class="l">${l}</td><td><b>${a}</b></td><td>${b}</td></tr>`).join('')}</tbody>
      </table></div>
      ${extrasSection(games)}
      <h2>Game log</h2>
      <div class="table-wrap"><table>
        <thead><tr><th class="l">Date</th><th class="l">Comp</th><th class="l">Opponent</th><th></th><th>Score</th><th>FG%</th><th>3P%</th><th>REB</th><th>AST</th><th>TO</th><th>PIR</th></tr></thead>
        <tbody>${log}</tbody></table></div>`;
  },

  players() {
    const comp = state.filters.players, mode = state.filters.mode;
    const opts = [...compsWithGames().map((c) => [c, compName(c)]), ['All', 'All games']];
    const ps = playerTotals(comp);
    if (!ps.length) return `<h2>Player Stats</h2>${seg('players', opts)}<p class="empty">No ${esc(compName(comp))} games played yet.</p>`;
    const showPm = ps.some((p) => p.hasPm);
    const per = (p, k) => (mode === 'avg' ? p[k] / p.gp : p[k]);
    const cols = [
      ['gp', 'GP', (p) => p.gp], ['sec', 'MIN', (p) => mins(per(p, 'sec'))], ['pts', 'PTS', (p) => fmt(per(p, 'pts'))],
      ['reb', 'REB', (p) => fmt(per(p, 'reb'))], ['oreb', 'OR', (p) => fmt(per(p, 'oreb'))], ['ast', 'AST', (p) => fmt(per(p, 'ast'))],
      ['stl', 'STL', (p) => fmt(per(p, 'stl'))], ['blk', 'BLK', (p) => fmt(per(p, 'blk'))], ['tov', 'TO', (p) => fmt(per(p, 'tov'))],
      ['fgp', 'FG%', (p) => pct(p.fg2m + p.fg3m, p.fg2a + p.fg3a)], ['fg2p', '2P%', (p) => pct(p.fg2m, p.fg2a)],
      ['fg3p', '3P%', (p) => pct(p.fg3m, p.fg3a)], ['fg3m', '3PM', (p) => fmt(per(p, 'fg3m'))], ['ftp', 'FT%', (p) => pct(p.ftm, p.fta)],
      ['pf', 'PF', (p) => fmt(per(p, 'pf'))], ['pir', 'PIR', (p) => fmt(per(p, 'pir'))],
      ...(showPm ? [['pm', '+/-', (p) => { if (!p.hasPm) return '–'; const v = mode === 'avg' ? p.pm / p.pmg : p.pm; return `<span class="${pmClass(v)}">${v > 0 ? '+' : ''}${fmt(v)}</span>`; }]] : []), ['high', 'High', (p) => p.high],
    ];
    function fmt(x) { return mode === 'avg' ? f1(x) : Math.round(x); }
    const sortVal = (p, k) => ({ fgp: (p.fg2m + p.fg3m) / (p.fg2a + p.fg3a || 1), fg2p: p.fg2m / (p.fg2a || 1), fg3p: p.fg3m / (p.fg3a || 1), ftp: p.ftm / (p.fta || 1), gp: p.gp, high: p.high, pm: p.hasPm ? (mode === 'avg' ? p.pm / p.pmg : p.pm) : -999 }[k] ?? per(p, k));
    const { key, dir } = state.sort;
    ps.sort((a, b) => dir * (sortVal(a, key) - sortVal(b, key)));
    return `<h2>Player Stats</h2>
      <div class="controls">${seg('players', opts)}${seg('mode', [['avg', 'Per game'], ['tot', 'Totals']])}</div>
      <div class="table-wrap"><table>
        <thead><tr><th class="l">#</th><th class="l">Player</th>${cols.map(([k, l]) => `<th class="sortable ${key === k ? 'sorted' : ''}" onclick="sortBy('${k}')">${l}</th>`).join('')}</tr></thead>
        <tbody>${ps.map((p) => `<tr><td class="l">${esc(p.no)}</td><td class="l"><b>${esc(p.name)}</b></td>${cols.map(([, , f]) => `<td>${f(p)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="note">Click a column to sort.${showPm ? '' : ' Plus/minus isn\'t available for these games.'}</p>
      ${PIR_EXPLAINER}`;
  },

  standings() {
    const gbl = state.gbl.standings, ec = state.ec.standings;
    const tbl = (rows, withPts) => `<div class="table-wrap"><table>
      <thead><tr><th>#</th><th class="l">Team</th><th>GP</th><th>W</th><th>L</th>${withPts ? '<th>Pts</th>' : ''}<th>PF</th><th>PA</th><th>+/-</th></tr></thead>
      <tbody>${rows.map((s) => `<tr class="${s.paok ? 'hl' : ''}"><td>${s.pos}</td><td class="l">${esc(s.team)}</td><td>${s.gp}</td><td>${s.w}</td><td>${s.l}</td>${withPts ? `<td><b>${s.pts}</b></td>` : ''}<td>${s.pf ?? '–'}</td><td>${s.pa ?? '–'}</td><td>${s.pf != null ? (s.pf - s.pa > 0 ? '+' : '') + (s.pf - s.pa) : s.diff ?? '–'}</td></tr>`).join('')}</tbody>
    </table></div>`;
    return `<h2>Stoiximan GBL</h2>${tbl(gbl, true)}
      <p class="note">2 points for a win, 1 for a loss. Negative points are league penalties. Top 8 go to the play-offs.</p>
      <h2>EuroCup · ${esc(state.ec.group)}</h2>${tbl(ec, false)}
      <p class="note">Top 4 of the group go to the play-offs.</p>`;
  },
};

/* ---------- next game: scouting + projections ---------- */
const athensDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: hasTime(d) ? TZ : 'UTC' }).format(toDate(d));
VIEWS.scout = function scout() {
  const reports = [...state.scout.reports].sort((a, b) => toDate(a.date) - toDate(b.date));
  if (!reports.length) return '<h2>Next Game</h2><p class="empty">No upcoming games to scout.</p>';
  const pick = reports.find((r) => r.comp === state.filters.scout) || reports[0];
  state.filters.scout = pick.comp;
  const tabs = reports.length > 1 ? seg('scout', reports.map((r) => [r.comp, `${compName(r.comp)} · ${r.home ? 'vs' : '@'} ${r.opp}`])) : '';
  const o = pick.oppTeam, p = pick.paokTeam;
  const v = (x, suf = '') => (x === null || x === undefined ? '–' : x + suf);
  const rows = [
    ['Record', p ? `${p.w}–${p.l}` : '–', o ? `${o.w}–${o.l}` : '–'],
    ['Points scored', v(p?.pts), v(o?.pts)], ['Points allowed', v(p?.allowed), v(o?.allowed)],
    ['FG%', v(p?.fgp), v(o?.fgp)], ['3P%', v(p?.fg3p), v(o?.fg3p)], ['3PA', v(p?.fg3a), v(o?.fg3a)],
    ['FT%', v(p?.ftp), v(o?.ftp)], ['Rebounds', v(p?.reb), v(o?.reb)], ['Off. rebounds', v(p?.oreb), v(o?.oreb)],
    ['Assists', v(p?.ast), v(o?.ast)], ['Turnovers', v(p?.tov), v(o?.tov)], ['Steals', v(p?.stl), v(o?.stl)],
    ['PIR', v(p?.pir), v(o?.pir)], ['Opponents’ FG%', v(p?.opp_fgp), v(o?.opp_fgp)],
  ];
  const sample = o && o.gp < 3 ? `<p class="note">Early season: ${esc(pick.opp)} ${o.gp === 1 ? 'has played 1 game' : `have played ${o.gp} games`} in the ${esc(compName(pick.comp))}, so treat these numbers as a first look.</p>` : '';
  const card = (pl) => `<div class="card impact">
      <div class="impact-head"><span class="num">${esc(pl.no || '–')}</span><div><b>${esc(pl.name)}</b><div class="muted" style="font-size:12px">${pl.gp} game${pl.gp > 1 ? 's' : ''} · ${pl.min} min</div></div><div class="pir-badge">${pl.pir}<span>PIR</span></div></div>
      <div class="impact-line"><div><b>${pl.pts}</b><span>PTS</span></div><div><b>${pl.reb}</b><span>REB</span></div><div><b>${pl.ast}</b><span>AST</span></div><div><b>${v(pl.fg3p, '%')}</b><span>3P</span></div></div>
      ${pl.tags.length ? `<div class="tags">${pl.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')}</div>` : ''}
    </div>`;

  // projections unlock on match day (Greek time)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const matchDay = athensDay(pick.date) <= today;
  let proj;
  if (!pick.projection) proj = '<p class="empty">Not enough data for projections yet.</p>';
  else if (!matchDay) {
    proj = `<div class="card locked"><b>Projections unlock on match day</b> (${fmtDate(pick.date, { weekday: 'long' })}).
      <p class="muted" style="margin:6px 0 0">They use the expected lineups, so they're published once it's known who plays.</p></div>`;
  } else {
    const pr = pick.projection, us = pr.paok, them = pr.opp;
    const src = { manual: 'Lineups: confirmed team news', official: 'Lineups: official game roster', assumed: 'Lineups not confirmed yet: full squads assumed' }[pr.lineupSource];
    const ptable = (side, name) => `<div><h3>${esc(name)} <span class="muted" style="font:500 13px Inter">${side.missing.length ? 'Out: ' + side.missing.map(esc).join(', ') : 'No absences'}</span></h3>
      <div class="table-wrap"><table><thead><tr><th class="l">#</th><th class="l">Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>PIR</th></tr></thead>
      <tbody>${side.players.map((r) => `<tr><td class="l">${esc(r.no)}</td><td class="l"><b>${esc(r.name)}</b></td><td>${r.min}</td><td><b>${f1(r.pts)}</b></td><td>${f1(r.reb)}</td><td>${f1(r.ast)}</td><td>${f1(r.pir)}</td></tr>`).join('')}</tbody></table></div></div>`;
    const [hn, hs, an, as] = pick.home ? ['PAOK', us.score, pick.opp, them.score] : [pick.opp, them.score, 'PAOK', us.score];
    proj = `<div class="card dark proj">
        <div class="label">Projected score</div>
        <div class="big">${esc(hn)} ${Math.round(hs)} – ${Math.round(as)} ${esc(an)}</div>
        <div class="winbar"><div style="width:${pr.winProb}%"></div></div>
        <div class="muted">PAOK win chance: <b style="color:#fff">${pr.winProb}%</b> · ${esc(src)}${pr.note ? ' · ' + esc(pr.note) : ''}</div>
      </div>
      <div class="grid two" style="margin-top:16px">${ptable(us, 'PAOK')}${ptable(them, pick.opp)}</div>
      <p class="note">How it works: each player's per-minute production this season × expected minutes (shared out among the available players when someone is missing).
        Team totals blend PAOK's attack with the opponent's defence and vice versa, pulled toward the league average early in the season, with a small home-court edge.</p>`;
  }
  return `<h2>Next Game</h2>${tabs}
    <div class="card dark" style="margin-bottom:8px">
      <div class="label">${esc(compName(pick.comp))} · ${esc(pick.round)}</div>
      <div class="big">PAOK ${pick.home ? 'vs' : '@'} ${esc(pick.opp)}</div>
      <div class="muted">${fmtDate(pick.date, { weekday: 'long', year: 'numeric' })} · ${fmtTime(pick.date)} · ${esc(pick.venue)}${pick.url ? ` · <a class="report" style="color:#fff" href="${esc(pick.url)}" target="_blank" rel="noopener">Game page ↗</a>` : ''}</div>
    </div>
    <h2>Match-day projections</h2>${proj}
    <h2>${esc(pick.opp)}: impact players</h2>
    ${pick.impact.length ? `<div class="grid three">${pick.impact.map(card).join('')}</div>` : '<p class="empty">They haven\'t played yet this season.</p>'}
    ${sample}
    <h2>Team comparison (${esc(compName(pick.comp))}, per game)</h2>
    <div class="table-wrap" style="max-width:640px"><table>
      <thead><tr><th class="l">Stat</th><th>PAOK</th><th>${esc(pick.opp)}</th></tr></thead>
      <tbody>${rows.map(([l, a, b]) => `<tr><td class="l">${l}</td><td><b>${a}</b></td><td>${b}</td></tr>`).join('')}</tbody>
    </table></div>
    ${pick.paokImpact.length ? `<h2>PAOK's key players (${esc(compName(pick.comp))})</h2><div class="grid three">${pick.paokImpact.slice(0, 3).map(card).join('')}</div>` : ''}`;
};

/* ---------- player profiles ---------- */
const TAG_RULES = [
  ['Top scorer', 'Leads the team in points per game'],
  ['Rebounder', 'Leads the team in rebounds, or 6+ per game'],
  ['Playmaker', 'Leads the team in assists, or 4+ per game'],
  ['3-pt threat', '1.5+ threes made per game at 35%+'],
  ['Gets to the line', '4+ free-throw attempts per game'],
  ['Disruptor', '2+ steals and blocks combined per game'],
];
const DEF_RULES = [
  ['Ball hawk', '1.5+ steals per game'],
  ['Rim protector', '1+ blocks per game'],
  ['Defensive glass', 'Leads the team in defensive rebounds, or 5+ per game'],
  ['Positive +/-', 'PAOK outscore opponents while he is on court (plus/minus above 0)'],
  ['Negative +/-', 'PAOK are outscored while he is on court (plus/minus below 0)'],
  ['Foul trouble', '3.5+ personal fouls per game'],
];
const RULE_TEXT = Object.fromEntries([...TAG_RULES, ...DEF_RULES]);
const pmClass = (v) => (v === null || v === undefined || v === 0 ? '' : v > 0 ? 'pos-text' : 'neg-text');

/* every profile is a per-game line: {name, no, gp, min, pts, reb, dreb, ast, stl, blk, pf, fg3m, fg3a (total), fg3p, fta, pir, pm} */
function perGameFromTotals(t) {
  const g = t.gp;
  return {
    name: t.name, no: t.no, gp: g, min: t.sec / 60 / g, pts: t.pts / g, reb: t.reb / g, dreb: t.dreb / g, ast: t.ast / g,
    stl: t.stl / g, blk: t.blk / g, pf: t.pf / g, fg3m: t.fg3m / g, fg3a: t.fg3a, fg3p: t.fg3a ? (100 * t.fg3m) / t.fg3a : null,
    fta: t.fta / g, pir: t.pir / g, pm: t.hasPm ? t.pm / t.pmg : null, // only games that publish +/-
  };
}
function profileTags(p, regulars) {
  const isReg = regulars.includes(p);
  const leads = (k) => isReg && regulars.every((o) => o === p || o[k] <= p[k]);
  const off = [], def = [];
  if (leads('pts')) off.push('Top scorer');
  if (leads('reb') || p.reb >= 6) off.push('Rebounder');
  if (leads('ast') || p.ast >= 4) off.push('Playmaker');
  if (p.fg3m >= 1.5 && (p.fg3p || 0) >= 35) off.push('3-pt threat');
  if (p.fta >= 4) off.push('Gets to the line');
  if (p.stl + p.blk >= 2) off.push('Disruptor');
  if (p.stl >= 1.5) def.push('Ball hawk');
  if (p.blk >= 1) def.push('Rim protector');
  if (leads('dreb') || p.dreb >= 5) def.push('Defensive glass');
  if (p.pm !== null && p.pm !== undefined && p.pm !== 0) def.push(p.pm > 0 ? 'Positive +/-' : 'Negative +/-');
  if (p.pf >= 3.5) def.push('Foul trouble');
  return { off, def };
}
const sname = (n) => n.toLowerCase().replace(/-/g, ' ').split(' ').pop();
const yearsOld = (b) => { if (!b) return null; const d = new Date(b), n = new Date(); return n.getFullYear() - d.getFullYear() - (n < new Date(n.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0); };

function profileCard(r, p, regulars, emptyText) {
  const h = r.height && r.height >= 160 ? (r.height / 100).toFixed(2) + ' m' : ''; // feeds sometimes carry placeholder heights
  const age = yearsOld(r.born);
  const bio = [r.posCode || r.pos, h, r.nat, age ? age + ' yrs' : ''].filter(Boolean).map(esc).join(' · ');
  const head = (extra) => `<div class="impact-head"><span class="num">${esc(r.no || (p && p.no) || '–')}</span><div><b>${esc(r.name)}</b><div class="muted" style="font-size:12px">${bio}</div>${extra}</div>${p ? `<div class="pir-badge">${f1(p.pir)}<span>PIR</span></div>` : ''}</div>`;
  if (!p) return `<div class="card impact muted-card">${head('')}<p class="muted" style="margin:14px 0 0">${esc(emptyText)}</p></div>`;
  const { off, def } = profileTags(p, regulars);
  const pill = (t, cls = '') => `<span class="pill ${cls}" title="${esc(RULE_TEXT[t])}">${esc(t)}</span>`;
  const pm = p.pm === null || p.pm === undefined ? '–' : (p.pm > 0 ? '+' : '') + f1(p.pm);
  return `<div class="card impact">
    ${head(`<div class="muted" style="font-size:12px">${p.gp} game${p.gp > 1 ? 's' : ''} · ${f1(p.min)} min</div>`)}
    <div class="impact-line"><div><b>${f1(p.pts)}</b><span>PTS</span></div><div><b>${f1(p.reb)}</b><span>REB</span></div><div><b>${f1(p.ast)}</b><span>AST</span></div><div><b>${p.fg3p === null || p.fg3p === undefined ? '–' : f1(p.fg3p) + '%'}</b><span>3P</span></div></div>
    ${off.length ? `<div class="tags">${off.map((t) => pill(t)).join('')}</div>` : ''}
    <div class="def-line"><span class="label">Defence</span>
      <div><b>${f1(p.stl)}</b><span>STL</span></div><div><b>${f1(p.blk)}</b><span>BLK</span></div><div><b>${f1(p.dreb)}</b><span>DREB</span></div><div><b>${f1(p.pf)}</b><span>PF</span></div><div><b class="${pmClass(p.pm)}">${pm}</b><span>+/-</span></div></div>
    ${def.length ? `<div class="tags">${def.map((t) => pill(t, { 'Foul trouble': '', 'Positive +/-': 'pos', 'Negative +/-': 'neg' }[t] ?? 'def')).join('')}</div>` : ''}
  </div>`;
}

VIEWS.profiles = function profiles() {
  const reports = [...state.scout.reports].sort((a, b) => toDate(a.date) - toDate(b.date));
  const teams = [['PAOK', 'PAOK'], ...reports.map((r) => [`opp:${r.comp}`, `${r.opp} (${compName(r.comp)})`])];
  if (!teams.some(([k]) => k === state.filters.profTeam)) state.filters.profTeam = 'PAOK';
  const team = state.filters.profTeam;
  let items, regulars, emptyText, intro = '';
  if (team === 'PAOK') {
    const comp = state.filters.profiles;
    const teamGp = gamesWithBox(comp).length;
    const lines = playerTotals(comp).map(perGameFromTotals);
    regulars = lines.filter((p) => p.gp >= Math.max(1, Math.ceil(teamGp / 2)));
    const roster = new Map();
    for (const r of [...state.gbl.roster, ...state.ec.roster]) if (!roster.has(sname(r.name))) roster.set(sname(r.name), r);
    items = [...roster.values()].map((r) => ({ r, p: lines.find((x) => sname(x.name) === sname(r.name)) }));
    emptyText = `No ${comp === 'All' ? '' : compName(comp) + ' '}games played yet.`;
    intro = seg('profiles', [['All', 'All games'], ...compsWithGames().map((c) => [c, compName(c)])]);
  } else {
    const rep = reports.find((r) => `opp:${r.comp}` === team);
    const lines = rep.oppPlayers || [];
    const teamGp = rep.oppTeam ? rep.oppTeam.gp : 0;
    regulars = lines.filter((p) => p.gp >= Math.max(1, Math.ceil(teamGp / 2)));
    const roster = rep.oppRoster && rep.oppRoster.length ? rep.oppRoster : [];
    const seen = new Set(roster.map((r) => sname(r.name)));
    const all = [...roster, ...lines.filter((p) => !seen.has(sname(p.name))).map((p) => ({ name: p.name, no: p.no }))];
    items = all.map((r) => ({ r, p: lines.find((x) => sname(x.name) === sname(r.name)) }));
    emptyText = `No ${compName(rep.comp)} games played yet.`;
    intro = `<p class="muted">${esc(compName(rep.comp))} stats this season${teamGp ? ` (${teamGp} game${teamGp > 1 ? 's' : ''})` : ''} · next meeting ${fmtDate(rep.date)} ·
      <a href="#scout" onclick="state.filters.scout='${rep.comp}'">Scouting report →</a></p>`;
  }
  items.sort((a, b) => (b.p ? b.p.pir : -99) - (a.p ? a.p.pir : -99));
  const legend = (title, rules, cls) => `<div class="card"><h3>${title}</h3><ul class="legend">${rules.map(([n, d]) => `<li><span class="pill ${{ 'Positive +/-': 'pos', 'Negative +/-': 'neg' }[n] || cls}">${esc(n)}</span><span class="muted">${esc(d)}</span></li>`).join('')}</ul></div>`;
  return `<h2>Player Profiles</h2>${seg('profTeam', teams)}${intro}
    <div class="grid three">${items.map(({ r, p }) => profileCard(r, p, regulars, emptyText)).join('')}</div>
    <h2>What the badges mean</h2>
    <div class="grid two">${legend('Offence &amp; all-round', TAG_RULES, '')}${legend('Defence', DEF_RULES, 'def')}</div>
    ${PIR_EXPLAINER}
    <p class="note">"Leads the team" counts players who've played at least half of the games. Box scores only capture part of defence: steals, blocks, defensive rebounds, fouls and plus/minus.
      Plus/minus comes from the EuroCup and FIBA LiveStats; ESAKE's own pages don't publish it, so it can be missing for some Greek League games.</p>`;
};

/* ---------- pieces ---------- */
const EXTRAS = [
  ['tovPts', 'Points from turnovers'], ['paint', 'Points in the paint'], ['second', 'Second chance points'],
  ['fastbreak', 'Fast break points'], ['bench', 'Bench points'], ['lead', 'Biggest lead'], ['run', 'Biggest scoring run'],
];
function extrasSection(games) {
  const withX = games.filter((g) => g.box.extra);
  if (!withX.length) return '';
  const n = withX.length;
  const avg = (side, k) => f1(withX.reduce((s, g) => s + g.box.extra[side][k], 0) / n);
  const best = (side, k) => Math.max(...withX.map((g) => g.box.extra[side][k]));
  const cell = (side, k) => (['lead', 'run'].includes(k) && n > 1 ? `${avg(side, k)} <span class="muted">(best ${best(side, k)})</span>` : avg(side, k));
  return `<h2>Scoring breakdown (per game)</h2>
    <div class="table-wrap" style="max-width:640px"><table>
      <thead><tr><th class="l">Stat</th><th>PAOK</th><th>Opponents</th></tr></thead>
      <tbody>${EXTRAS.map(([k, l]) => `<tr><td class="l">${l}</td><td><b>${cell('us', k)}</b></td><td>${cell('them', k)}</td></tr>`).join('')}</tbody>
    </table></div>
    ${n < games.length ? `<p class="note">Based on ${n} of ${games.length} games (not published for the others).</p>` : ''}`;
}
function linkFor(g) {
  if (!g.url) return '';
  const label = g.played ? 'Match report' : 'Game page';
  return `<a class="report" href="${esc(g.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${label} ↗</a>`;
}
const PIR_EXPLAINER = `
  <div class="card pir">
    <h3>What is PIR?</h3>
    <p><b>Performance Index Rating</b> is the one-number score the EuroLeague, EuroCup and Greek League use to rate a player's game
      (in Greek: <i>Αξιολόγηση</i> or "Ranking").</p>
    <div class="formula">
      <div><span class="label">Adds</span>Points + Rebounds + Assists + Steals + Blocks + Fouls drawn</div>
      <div><span class="label">Subtracts</span>Missed shots + Missed free throws + Turnovers + Shots blocked + Fouls committed</div>
    </div>
    <ul class="scale">
      <li><b>0 or less</b><span>poor game</span></li>
      <li><b>~10</b><span>solid game</span></li>
      <li><b>20+</b><span>very good game</span></li>
      <li><b>30+</b><span>outstanding game</span></li>
    </ul>
    <p class="note">Example: 12 points in 20 minutes plus rebounds, assists and drawn fouls with few misses can be worth more PIR than 20 points on poor shooting.</p>
  </div>`;
function gameRow(g, isNext = false) {
  const res = g.played
    ? `<span class="wl ${result(g)}">${result(g)}</span> ${g.us}–${g.them}`
    : `<span class="muted" style="font:500 14px Inter">${fmtTime(g.date)}</span>`;
  return `<div class="game ${g.played ? 'played' : ''} ${isNext ? 'next' : ''}" ${g.played ? `onclick="openBox('${g.code}')"` : ''}>
    <div class="when"><b>${fmtDate(g.date)}</b>${where(g)}</div>
    <div><div class="opp">${vsAt(g)} ${esc(g.opp)} ${isNext ? '<span class="pill solid">Next</span>' : ''}</div>
      <div class="meta">${esc(compName(g.comp))} · ${esc(g.round)} · ${esc(g.venue)}</div>${linkFor(g)}</div>
    <div class="res">${res}</div></div>`;
}
function topScorer(g) {
  const p = [...g.box.players].sort((a, b) => b.pts - a.pts)[0];
  return `${esc(p.name)} ${p.pts} pts`;
}
function oppContext(g) {
  const table = g.comp === 'EuroCup' ? state.ec.standings : g.comp === 'GBL' ? state.gbl.standings : [];
  const row = table.find((s) => s.team.toLowerCase().includes(g.opp.toLowerCase().split(' ')[0]));
  const prev = state.games.filter((x) => x.played && x.opp === g.opp);
  const bits = [];
  if (row && row.gp) bits.push(`${esc(g.opp)}: ${ordinal(row.pos)} in ${g.comp === 'EuroCup' ? state.ec.group : 'GBL'} (${row.w}–${row.l})`);
  if (prev.length) bits.push('This season: ' + prev.map((x) => `${result(x)} ${x.us}–${x.them} (${compName(x.comp)})`).join(', '));
  return bits.length ? `<div class="note" style="color:#ddd">${bits.join(' · ')}</div>` : '';
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

function sortBy(k) {
  state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 };
  rerender();
}

function openBox(code) {
  const g = state.games.find((x) => String(x.code) === String(code));
  if (!g || !g.box) return;
  const hasPm = g.box.players.some((p) => p.pm !== null && p.pm !== undefined);
  const rows = g.box.players.map((p) => `<tr><td class="l">${esc(p.no)}</td><td class="l">${p.start ? '<b>' : ''}${esc(p.name)}${p.start ? '</b>' : ''}</td>
    ${p.sec ? `<td>${mins(p.sec)}</td><td><b>${p.pts}</b></td><td>${p.fg2m}/${p.fg2a}</td><td>${p.fg3m}/${p.fg3a}</td><td>${p.ftm}/${p.fta}</td>
    <td>${p.oreb}</td><td>${p.dreb}</td><td>${p.reb}</td><td>${p.ast}</td><td>${p.stl}</td><td>${p.tov}</td><td>${p.blk}</td><td>${p.pf}</td><td>${p.pir}</td>${hasPm ? `<td class="${pmClass(p.pm)}">${p.pm === null || p.pm === undefined ? '' : (p.pm > 0 ? '+' : '') + p.pm}</td>` : ''}`
    : `<td colspan="${hasPm ? 15 : 14}" class="l muted">Did not play</td>`}</tr>`).join('');
  const tot = (t, label) => `<tr class="hl"><td></td><td class="l">${label}</td><td></td><td>${t.pts}</td><td>${t.fg2m}/${t.fg2a}</td><td>${t.fg3m}/${t.fg3a}</td><td>${t.ftm}/${t.fta}</td>
    <td>${t.oreb}</td><td>${t.dreb}</td><td>${t.reb}</td><td>${t.ast}</td><td>${t.stl}</td><td>${t.tov}</td><td>${t.blk}</td><td>${t.pf}</td><td>${t.pir}</td>${hasPm ? '<td></td>' : ''}</tr>`;
  $('#box-title').textContent = `PAOK ${g.us}–${g.them} ${g.opp} · ${compName(g.comp)} ${g.round}`;
  $('#box-body').innerHTML = `<p class="muted" style="margin-top:0">${fmtDate(g.date, { year: 'numeric' })} · ${esc(g.venue)}${g.url ? ` · <a href="${esc(g.url)}" target="_blank" rel="noopener">Official match report ↗</a>` : ''}</p>
    <div class="table-wrap"><table>
    <thead><tr><th class="l">#</th><th class="l">Player</th><th>MIN</th><th>PTS</th><th>2P</th><th>3P</th><th>FT</th><th>OR</th><th>DR</th><th>REB</th><th>AST</th><th>STL</th><th>TO</th><th>BLK</th><th>PF</th><th>PIR</th>${hasPm ? '<th>+/-</th>' : ''}</tr></thead>
    <tbody>${rows}${tot(g.box.team, 'PAOK')}${tot(g.box.opp, esc(g.opp)).replace('class="hl"', '')}</tbody></table></div>
    ${g.box.extra ? `<h3 style="margin-top:18px">Scoring breakdown</h3><div class="table-wrap" style="max-width:520px"><table>
      <thead><tr><th class="l"></th><th>PAOK</th><th>${esc(g.opp)}</th></tr></thead>
      <tbody>${EXTRAS.map(([k, l]) => `<tr><td class="l">${l}</td><td><b>${g.box.extra.us[k]}</b></td><td>${g.box.extra.them[k]}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}`;
  $('#box-dialog').showModal();
}

let timer;
function startCountdown() {
  clearInterval(timer);
  const el = $('#countdown');
  if (!el) return;
  const t = new Date(el.dataset.t).getTime();
  const tick = () => {
    let s = Math.max(0, Math.floor((t - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60);
    el.innerHTML = [[d, 'days'], [h, 'hrs'], [m, 'min']].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  };
  tick();
  timer = setInterval(tick, 30000);
}

$('#box-dialog').addEventListener('click', (e) => { if (e.target.id === 'box-dialog') e.target.close(); });
load().catch((e) => { $('#app').innerHTML = `<p class="empty">Could not load data (${esc(e.message)}).</p>`; });
