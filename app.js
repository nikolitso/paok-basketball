/* PAOK Basketball 2026-27 — static site reading data/eurocup.json and data/gbl.json */
const TZ = 'Europe/Athens';
const COMPS = { GBL: 'Greek League', EuroCup: 'EuroCup', 'Greek Super Cup': 'Super Cup', 'Greek Cup': 'Greek Cup' };
const state = { ec: null, gbl: null, games: [], filters: { schedule: 'All', team: 'GBL', players: 'GBL', roster: 'GBL', mode: 'avg' }, sort: { key: 'pts', dir: -1 } };

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
  [state.ec, state.gbl] = await Promise.all([get('eurocup.json'), get('gbl.json')]);
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
      if (p.pm !== null && p.pm !== undefined) { t.pm += p.pm; t.hasPm = true; }
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
    const age = (b) => { if (!b) return '–'; const d = new Date(b), n = new Date(); return n.getFullYear() - d.getFullYear() - (n < new Date(n.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0); };
    const rows = list.map((p) => {
      const onlyHere = comp === 'EuroCup' ? !inGbl.has(sur(p.name)) : !inEc.has(sur(p.name));
      return `<tr><td class="l"><span class="num">${esc(p.no || "–")}</span></td>
        <td class="l"><b>${esc(p.name)}</b>${onlyHere ? ` <span class="pill">${comp === 'EuroCup' ? 'EuroCup only' : 'GBL only'}</span>` : ''}</td>
        <td class="l">${esc(p.posCode || p.pos)}</td><td>${p.height ? (p.height / 100).toFixed(2) + ' m' : '–'}</td>
        <td class="l">${esc(p.nat)}</td><td>${age(p.born)}</td><td class="l muted">${esc(p.from || '')}</td></tr>`;
    }).join('');
    const staff = state.ec.staff.map((s) => `<li><span>${esc(s.name)}</span><span class="muted">${esc(s.role)}</span></li>`).join('');
    return `<h2>Roster</h2>
      ${seg('roster', [['GBL', `Greek League (${gbl.length})`], ['EuroCup', `EuroCup (${ec.length})`]])}
      <div class="table-wrap"><table>
        <thead><tr><th class="l">#</th><th class="l">Player</th><th class="l">Pos</th><th>Height</th><th class="l">Nat.</th><th>Age</th><th class="l">Previous team</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="note">Registered roster from ${comp === 'EuroCup' ? 'the EuroCup' : 'ESAKE (Greek League)'}. The two leagues have different rules on foreign players, so the lists differ.</p>
      <h2>Coaching staff</h2>
      <div class="card" style="max-width:520px"><ul class="leaders">${staff}</ul></div>`;
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
    const all = state.games.filter((g) => (f === 'All' || g.comp === f) && g.played);
    const r = record(all);
    return `<h2>Schedule & Results</h2>
      <div class="controls">${seg('schedule', [['All', 'All'], ...compsWithGames().map((c) => [c, compName(c)])])}
      <span class="muted">Record: <b>${r.w}–${r.l}</b></span></div>
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
      ...(showPm ? [['pm', '+/-', (p) => (p.hasPm ? fmt(per(p, 'pm')) : '–')]] : []), ['high', 'High', (p) => p.high],
    ];
    function fmt(x) { return mode === 'avg' ? f1(x) : Math.round(x); }
    const sortVal = (p, k) => ({ fgp: (p.fg2m + p.fg3m) / (p.fg2a + p.fg3a || 1), fg2p: p.fg2m / (p.fg2a || 1), fg3p: p.fg3m / (p.fg3a || 1), ftp: p.ftm / (p.fta || 1), gp: p.gp, high: p.high }[k] ?? per(p, k));
    const { key, dir } = state.sort;
    ps.sort((a, b) => dir * (sortVal(a, key) - sortVal(b, key)));
    return `<h2>Player Stats</h2>
      <div class="controls">${seg('players', opts)}${seg('mode', [['avg', 'Per game'], ['tot', 'Totals']])}</div>
      <div class="table-wrap"><table>
        <thead><tr><th class="l">#</th><th class="l">Player</th>${cols.map(([k, l]) => `<th class="sortable ${key === k ? 'sorted' : ''}" onclick="sortBy('${k}')">${l}</th>`).join('')}</tr></thead>
        <tbody>${ps.map((p) => `<tr><td class="l">${esc(p.no)}</td><td class="l"><b>${esc(p.name)}</b></td>${cols.map(([, , f]) => `<td>${f(p)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="note">Click a column to sort. PIR = Performance Index Rating.${showPm ? '' : ' Plus/minus is only published in the EuroCup feed.'}</p>`;
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

/* ---------- pieces ---------- */
function gameRow(g, isNext = false) {
  const res = g.played
    ? `<span class="wl ${result(g)}">${result(g)}</span> ${g.us}–${g.them}`
    : `<span class="muted" style="font:500 14px Inter">${fmtTime(g.date)}</span>`;
  return `<div class="game ${g.played ? 'played' : ''} ${isNext ? 'next' : ''}" ${g.played ? `onclick="openBox('${g.code}')"` : ''}>
    <div class="when"><b>${fmtDate(g.date)}</b>${where(g)}</div>
    <div><div class="opp">${vsAt(g)} ${esc(g.opp)} ${isNext ? '<span class="pill solid">Next</span>' : ''}</div>
      <div class="meta">${esc(compName(g.comp))} · ${esc(g.round)} · ${esc(g.venue)}</div></div>
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
    <td>${p.oreb}</td><td>${p.dreb}</td><td>${p.reb}</td><td>${p.ast}</td><td>${p.stl}</td><td>${p.tov}</td><td>${p.blk}</td><td>${p.pf}</td><td>${p.pir}</td>${hasPm ? `<td>${p.pm ?? ''}</td>` : ''}`
    : `<td colspan="${hasPm ? 15 : 14}" class="l muted">Did not play</td>`}</tr>`).join('');
  const tot = (t, label) => `<tr class="hl"><td></td><td class="l">${label}</td><td></td><td>${t.pts}</td><td>${t.fg2m}/${t.fg2a}</td><td>${t.fg3m}/${t.fg3a}</td><td>${t.ftm}/${t.fta}</td>
    <td>${t.oreb}</td><td>${t.dreb}</td><td>${t.reb}</td><td>${t.ast}</td><td>${t.stl}</td><td>${t.tov}</td><td>${t.blk}</td><td>${t.pf}</td><td>${t.pir}</td>${hasPm ? '<td></td>' : ''}</tr>`;
  $('#box-title').textContent = `PAOK ${g.us}–${g.them} ${g.opp} · ${compName(g.comp)} ${g.round}`;
  $('#box-body').innerHTML = `<p class="muted" style="margin-top:0">${fmtDate(g.date, { year: 'numeric' })} · ${esc(g.venue)}${g.url ? ` · <a href="${esc(g.url)}" target="_blank" rel="noopener">Official box score</a>` : ''}</p>
    <div class="table-wrap"><table>
    <thead><tr><th class="l">#</th><th class="l">Player</th><th>MIN</th><th>PTS</th><th>2P</th><th>3P</th><th>FT</th><th>OR</th><th>DR</th><th>REB</th><th>AST</th><th>STL</th><th>TO</th><th>BLK</th><th>PF</th><th>PIR</th>${hasPm ? '<th>+/-</th>' : ''}</tr></thead>
    <tbody>${rows}${tot(g.box.team, 'PAOK')}${tot(g.box.opp, esc(g.opp)).replace('class="hl"', '')}</tbody></table></div>`;
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
