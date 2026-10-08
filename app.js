/* PAOK Basketball 2026-27 — static site reading data/eurocup.json and data/gbl.json */
const TZ = 'Europe/Athens';
const COMPS = { GBL: 'Greek League', EuroCup: 'EuroCup', 'Greek Super Cup': 'Super Cup', 'Greek Cup': 'Greek Cup' };
const state = { ec: null, gbl: null, games: [], filters: { standings: 'GBL', powerSort: 'power', onoffSort: 'diff', league: 'GBL', leagueSort: 'net', profTeam: 'PAOK', profiles: 'All', scout: null, schedule: 'All', team: 'GBL', players: 'GBL', roster: 'GBL', mode: 'avg' }, sort: { key: 'pts', dir: -1 } };

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
  let additions;
  [state.ec, state.gbl, state.scout, hidden, state.club, state.clubStaff, state.info, additions, state.league, state.power] = await Promise.all([get('eurocup.json'), get('gbl.json'),
    get('scout.json').catch(() => ({ reports: [] })), get('excluded_players.json').catch(() => ({})), get('paokbc.json').catch(() => ({})), get('paokbc_staff.json').catch(() => []), get('player_info.json').catch(() => ({})), get('roster_additions.json').catch(() => ({})), get('league.json').catch(() => ({ comps: {} })), get('power.json').catch(() => ({ comps: {} }))]);
  // players hidden until their first game (e.g. youth players registered for depth)
  const surnameOf = (n) => n.toLowerCase().replace(/-/g, ' ').split(' ').pop();
  const played = new Set([...state.ec.games, ...state.gbl.games].flatMap((g) => (g.box ? g.box.players.filter((p) => p.sec > 0).map((p) => surnameOf(p.name)) : [])));
  const waiting = new Set((hidden.until_played || []).map((n) => n.toLowerCase()).filter((n) => !played.has(n)));
  for (const d of [state.ec, state.gbl]) d.roster = d.roster.filter((r) => !waiting.has(surnameOf(r.name)));
  // new signings the official feeds don't list yet
  for (const a of (additions && additions.players) || []) {
    for (const [comp, d] of [['EuroCup', state.ec], ['GBL', state.gbl]]) {
      if ((a.comps || []).includes(comp) && !d.roster.some((r) => surnameOf(r.name) === surnameOf(a.name))) d.roster.push({ ...a });
    }
  }
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
      const parts = p.name.toLowerCase().split(' ').slice(1).join(' ');
      const info = [parts.replace(/[^a-z]/g, ''), ...parts.split(/[\s-]+/)].map((k) => state.info[k]).find(Boolean) || {};
      const prev = info.prev || (/paok/i.test(p.from || '') ? '' : p.from);
      const onlyHere = comp === 'EuroCup' ? !inGbl.has(sur(p.name)) : !inEc.has(sur(p.name));
      const h = p.height && p.height >= 160 ? (p.height / 100).toFixed(2) + ' m' : c.height ? c.height + ' m' : '';
      const facts = [
        ['Position', p.posCode ? `${p.posCode} · ${p.pos}` : p.pos], ['Height', h], ['Nationality', p.nat],
        ['Age', age(p.born) ? `${age(p.born)}` : ''], ['Born in', info.birthplace || c.birthplace], ['Previous team', prev],
        ['At PAOK since', info.joined], ['Contract until', info.until ? `${info.until} (summer)` : ''],
      ].filter(([, v]) => v);
      return `<div class="card player-card">
        <div class="photo">${c.photo ? `<img src="${esc(c.photo)}" alt="${esc(p.name)}" loading="lazy">` : '<div class="no-photo">PAOK</div>'}
          <span class="num">${esc(p.no || '–')}</span></div>
        <div class="pc-body">
          <h3>${esc(p.name)}</h3>
          ${onlyHere ? `<span class="pill">${comp === 'EuroCup' ? 'EuroCup only' : 'GBL only'}</span>` : ''}
          <dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
          ${info.note ? `<p class="muted" style="font-size:12px;margin:0">${esc(info.note)}</p>` : ''}
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
      <p class="note">Registered ${comp === 'EuroCup' ? 'EuroCup' : 'Greek League'} roster. The two competitions have different rules on foreign players, so the lists differ.</p>
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
    const ma = (m, a) => `${f1(m / n)} – ${f1(a / n)}`; // made – attempted per game
    const tile = (v, s) => `<div class="tile"><div class="v">${v}</div><div class="s">${s}</div></div>`;
    const cmp = [
      ['Points', avg(us, 'pts'), avg(them, 'pts'), 'pts', 1],
      ['Points allowed', avg(them, 'pts'), avg(us, 'pts'), 'allowed', -1],
      ['FG%', pct(fgm(us), fga(us)), pct(fgm(them), fga(them)), 'fgp', 1],
      ['FG made – attempted', ma(fgm(us), fga(us)), ma(fgm(them), fga(them)), 'fgm', 1, lgMA(comp, 'fgm', 'fga')],
      ['2P%', pct(us.fg2m, us.fg2a), pct(them.fg2m, them.fg2a), 'fg2p', 1],
      ['2P made – attempted', ma(us.fg2m, us.fg2a), ma(them.fg2m, them.fg2a), 'fg2m', 1, lgMA(comp, 'fg2m', 'fg2a')],
      ['3P%', pct(us.fg3m, us.fg3a), pct(them.fg3m, them.fg3a), 'fg3p', 1],
      ['3P made – attempted', ma(us.fg3m, us.fg3a), ma(them.fg3m, them.fg3a), 'fg3m', 1, lgMA(comp, 'fg3m', 'fg3a')],
      ['FT%', pct(us.ftm, us.fta), pct(them.ftm, them.fta), 'ftp', 1],
      ['FT made – attempted', ma(us.ftm, us.fta), ma(them.ftm, them.fta), 'ftm', 1, lgMA(comp, 'ftm', 'fta')],
      ['Rebounds', avg(us, 'reb'), avg(them, 'reb'), 'reb', 1],
      ['Off. rebounds', avg(us, 'oreb'), avg(them, 'oreb'), 'oreb', 1],
      ['Assists', avg(us, 'ast'), avg(them, 'ast'), 'ast', 1],
      ['Steals', avg(us, 'stl'), avg(them, 'stl'), 'stl', 1],
      ['Turnovers', avg(us, 'tov'), avg(them, 'tov'), 'tov', -1],
      ['Blocks', avg(us, 'blk'), avg(them, 'blk'), 'blk', 1],
      ['Fouls', avg(us, 'pf'), avg(them, 'pf'), 'pf', -1],
      ['PIR', avg(us, 'pir'), avg(them, 'pir'), 'pir', 1],
    ];
    // possessions & efficiency rows
    const ps = paceStats(games);
    if (ps) {
      const net = ps.us.rating - ps.them.rating;
      const signed = (x) => `<span class="${x > 0 ? 'pos-text' : x < 0 ? 'neg-text' : ''}">${x > 0 ? '+' : ''}${f1(x)}</span>`;
      cmp.push(
        ['<span class="section-row">Possessions &amp; efficiency</span>', '', '', null, 0],
        ['Possessions per game', f1(ps.poss), f1(ps.poss), 'poss', 1],
        ['Offensive rating (pts per 100 poss)', f1(ps.us.rating), f1(ps.them.rating), 'ortg', 1],
        ['Defensive rating (allowed per 100 poss)', f1(ps.them.rating), f1(ps.us.rating), 'drtg', -1],
        ['Net rating', signed(net), signed(-net), 'net', 1],
      );
    }
    const hasLg = !!leagueOf(comp);
    const me = hasLg ? leagueTeam(comp, 'PAOK') : null;
    const log = games.map((g) => `<tr class="click" onclick="openBox('${g.code}')">
      <td class="l">${fmtDate(g.date)}</td><td class="l">${esc(compName(g.comp))}</td><td class="l">${vsAt(g)} ${esc(g.opp)}</td>
      <td><span class="wl ${result(g)}">${result(g)}</span></td><td><b>${g.us}–${g.them}</b></td>
      <td>${pct(g.box.team.fg2m + g.box.team.fg3m, g.box.team.fg2a + g.box.team.fg3a)}</td><td>${pct(g.box.team.fg3m, g.box.team.fg3a)}</td>
      <td>${g.box.team.reb}</td><td>${g.box.team.ast}</td><td>${g.box.team.tov}</td><td>${g.box.team.pir}</td><td>${f1(gamePoss(g))}</td><td>${f1((100 * g.us) / gamePoss(g))}</td><td>${f1((100 * g.them) / gamePoss(g))}</td></tr>`).join('');
    return `<h2>Team Stats</h2>${seg('team', opts)}
      <div class="tiles">
        ${tile(`${r.w}–${r.l}`, 'Record')}${tile(avg(us, 'pts'), 'Points scored / game')}${tile(avg(them, 'pts'), 'Points allowed / game')}
        ${tile((((us.pts - them.pts) / n) > 0 ? '+' : '') + f1((us.pts - them.pts) / n), 'Point margin / game')}
        ${tile(pct(us.fg3m, us.fg3a) + '%', '3-point %')}${tile(avg(us, 'ast'), 'Assists / game')}
      </div>
      <h2>PAOK vs opponents (per game)</h2>
      <div class="table-wrap" style="max-width:${hasLg ? 860 : 640}px"><table>
        <thead><tr><th class="l">Stat</th><th>PAOK</th><th>Opponents</th>${hasLg ? `<th>${esc(avgLabel(comp))}</th><th>PAOK rank</th>` : ''}</tr></thead>
        <tbody>${cmp.map(([l, a, b, k, dir, lgText]) => (k === null ? `<tr class="section"><td class="l" colspan="${hasLg ? 5 : 3}">${l}</td></tr>`
          : `<tr class="${lgText !== undefined ? 'sub' : ''}"><td class="l">${l}</td><td><b>${a}</b></td><td>${b}</td>${hasLg ? `<td>${lgText ?? lgVal(comp, k)}</td><td>${rankBadge(rankIn(comp, me, k, dir))}</td>` : ''}</tr>`)).join('')}</tbody>
      </table></div>
      ${hasLg ? `<p class="note">${leagueOf(comp).group ? `${esc(leagueOf(comp).group)} average = the average team per game across every game in PAOK's EuroCup group; ranks are among the ${leagueOf(comp).teams.length} ${esc(leagueOf(comp).group)} teams.` : `League average = the average team per game across every ${esc(compName(comp))} game this season; ranks are among all ${leagueOf(comp).teams.length} teams.`} 1st = best (for turnovers, fouls and points allowed, fewest is best). Green = top third, red = bottom third.</p>` : `<p class="note">Pick Greek League or EuroCup above to compare with the league average and see PAOK's rank.</p>`}
      ${paceSection(games, comp)}
      ${extrasSection(games)}
      <h2>Game log</h2>
      <div class="table-wrap"><table>
        <thead><tr><th class="l">Date</th><th class="l">Comp</th><th class="l">Opponent</th><th></th><th>Score</th><th>FG%</th><th>3P%</th><th>REB</th><th>AST</th><th>TO</th><th>PIR</th><th>Poss</th><th>ORtg</th><th>DRtg</th></tr></thead>
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
      ${onOffSection(comp)}
      ${PIR_EXPLAINER}`;
  },

  standingsOfficial() {
    const gbl = state.gbl.standings, ec = state.ec.standings;
    // zone by position: GBL top 8 -> play-offs (quarter-finals), last place -> relegation; EuroCup group top 4 -> play-offs
    const zone = (pos, n, comp) => (comp === 'GBL' ? (pos <= 8 ? 'up' : pos === n ? 'down' : '') : pos <= 4 ? 'up' : '');
    // points deducted = what the record is worth (2 per win, 1 per loss) minus the points shown
    const deduction = (s) => (s.pts == null ? 0 : 2 * s.w + s.l - s.pts);
    const tbl = (rows, comp) => {
      const withPts = comp === 'GBL';
      return `<div class="table-wrap"><table class="standings">
      <thead><tr><th>#</th><th class="l">Team</th><th>GP</th><th>W</th><th>L</th>${withPts ? '<th>Pts</th>' : ''}<th>PF</th><th>PA</th><th>+/-</th><th title="Possessions per game (overtime included)">Poss</th></tr></thead>
      <tbody>${rows.map((s, i) => {
        const cols = withPts ? 10 : 9;
        const cut = comp === 'GBL' ? 8 : 4;
        // labelled dividers: play-off line after the last qualifying place, relegation line above last place
        const before = comp === 'GBL' && i === rows.length - 1
          ? `<tr class="cutline down"><td colspan="${cols}">▼ Relegation zone: last place goes down to the Elite League</td></tr>` : '';
        const after = i === cut - 1 && rows.length > cut
          ? `<tr class="cutline up"><td colspan="${cols}">▲ Top ${cut} ${comp === 'GBL' ? 'reach the play-off quarter-finals' : 'of the group reach the EuroCup play-offs'}</td></tr>` : '';
        const ded = withPts && deduction(s) > 0;
        const diff = s.pf != null ? s.pf - s.pa : s.diff;
        return `<tr class="${s.paok ? 'hl' : ''}"><td><span class="pos ${zone(s.pos, rows.length, comp)}">${s.pos}</span></td><td class="l">${esc(s.team)}</td><td>${s.gp}</td><td>${s.w}</td><td>${s.l}</td>
          ${withPts ? `<td><b class="${ded ? 'deducted' : ''}" ${ded ? `title="${deduction(s)} point${deduction(s) > 1 ? 's' : ''} deducted"` : ''}>${s.pts}${ded ? '*' : ''}</b></td>` : ''}
          <td>${s.pf ?? '–'}</td><td>${s.pa ?? '–'}</td><td class="${diff > 0 ? 'pos-text' : diff < 0 ? 'neg-text' : ''}">${diff == null ? '–' : (diff > 0 ? '+' : '') + diff}</td>
          <td>${(() => { const lt = leagueTeam(comp, s.paok ? 'PAOK' : s.team); return lt && lt.poss != null ? f1(lt.poss) : '–'; })()}</td></tr>`.replace(/^/, before) + after;
      }).join('')}</tbody>
    </table></div>`;
    };
    const deductions = gbl.filter((s) => deduction(s) > 0);
    return `<h3 class="official-h">Greek League · official table</h3><p class="muted standings-sub"><span class="pos up">8</span> Top 8 qualify for the play-offs · 14 teams, 26 rounds</p>${tbl(gbl, 'GBL')}
      <div class="card standings-key">
        <div>
          <div class="key"><span class="pos up">1</span> Play-offs · quarter-finals (places 1–8)</div>
          <div class="key"><span class="pos down">14</span> Relegation · Elite League</div>
          <p class="note">2 points for a win, 1 for a loss. If teams finish level on points, head-to-head games are the tie-breaker.</p>
        </div>
        ${deductions.length ? `<div>${deductions.map((s) => `<div class="key"><span class="info">i</span> ${esc(s.team)}: −${deduction(s)} point${deduction(s) > 1 ? 's' : ''} (Federation decision)</div>`).join('')}</div>` : ''}
      </div>
      <h3 class="official-h">EuroCup · ${esc(state.ec.group)} · official table</h3><p class="muted standings-sub"><span class="pos up">4</span> Top 4 of the group qualify for the play-offs · 8 teams, 14 rounds</p>${tbl(ec, 'EuroCup')}
      <div class="card standings-key"><div class="key"><span class="pos up">1</span> Play-offs (top 4 of the group)</div></div>`;
  },
};

/* ---------- standings that matter: power ratings + projections ---------- */
// simulated chances: never show a flat 100% / 0% unless it really never/always happened
const pctLabel = (v) => (v >= 100 ? '100' : v >= 99.5 ? '>99' : v <= 0 ? '0' : v < 0.5 ? '<1' : String(Math.round(v)));
VIEWS.standings = function standings() {
  const comps = ['GBL', 'EuroCup'].filter((c) => state.power.comps && state.power.comps[c]);
  if (!comps.length) return VIEWS.standingsOfficial();
  const comp = comps.includes(state.filters.standings) ? state.filters.standings : comps[0];
  state.filters.standings = comp;
  const pw = state.power.comps[comp];
  const signed = (v, cls = true) => (v === null || v === undefined ? '–' : `<span class="${cls ? pmClass(v) : ''}">${v > 0 ? '+' : ''}${f1(v)}</span>`);
  const pctCell = (v) => {
    if (v === null || v === undefined) return '<td>–</td>';
    const shade = Math.round(Math.min(100, v) * 0.55);
    return `<td class="pct" style="--p:${shade}%"><b>${pctLabel(v)}%</b></td>`;
  };
  const sortKey = ['power', 'net', 'expW', 'luck', 'poss', 'sosPlayed', 'sosLeft'].includes(state.filters.powerSort) ? state.filters.powerSort : 'power';
  // tempo: possessions per game (overtime included) from the league table
  const possOf = (t) => { const lt = leagueTeam(comp, t.paok ? 'PAOK' : t.team); return lt ? lt.poss : null; };
  pw.teams.forEach((t) => { t.poss = possOf(t); });
  const lgPoss = (leagueOf(comp) || {}).avg ? leagueOf(comp).avg.poss : null;
  const tempo = (v) => (v === null || v === undefined ? '–' : `${f1(v)}${lgPoss ? ` <span class="rk muted">${v >= lgPoss + 2 ? 'fast' : v <= lgPoss - 2 ? 'slow' : 'avg'}</span>` : ''}`);
  const teams = [...pw.teams].sort((a, b) => (b[sortKey] ?? -1e9) - (a[sortKey] ?? -1e9));
  const th = (k, l, title) => `<th class="sortable ${sortKey === k ? 'sorted' : ''}" title="${title}" onclick="state.filters.powerSort='${k}';rerender()">${l}</th>`;
  // season projections (pw.teams[].projW, pPlayoffs, ...) are computed but not shown for now
  return `<h2>Standings that matter</h2>
    ${seg('standings', comps.map((c) => [c, c === 'EuroCup' ? `EuroCup · ${pw.group || state.ec.group}` : 'Greek League']))}
    <h3 style="margin-top:22px">Power ranking</h3>
    <div class="table-wrap"><table class="power">
      <thead>
        <tr class="groups"><th colspan="3"></th><th colspan="4" class="grp">How good they really are</th><th class="grp">Tempo</th><th colspan="2" class="grp">Schedule strength</th></tr>
        <tr><th>#</th><th class="l">Team</th><th>W–L</th>
          ${th('power', 'Power', 'Opponent- and home-adjusted net rating: points per 100 possessions better than an average team (this season, plus last season as a starting point early on)')}
          ${th('net', 'Net', 'Raw net rating this season: points per 100 possessions better than opponents')}
          ${th('expW', 'Exp. W', 'Wins a team "deserves" from points scored and allowed')}
          ${th('luck', 'Luck', 'Actual wins minus expected wins: teams well above 0 usually come back down')}
          ${th('poss', 'Poss', 'Possessions per game, overtime included: how fast a team plays')}
          ${th('sosPlayed', 'Played', 'Average power of opponents already played (higher = harder)')}
          ${th('sosLeft', 'Ahead', 'Average power of opponents still to play (higher = harder)')}
</tr></thead>
      <tbody>${teams.map((t, i) => `<tr class="${t.paok ? 'hl' : ''}"><td>${sortKey === 'power' ? t.rank : i + 1}</td><td class="l">${esc(t.team)}</td><td>${t.w}–${t.l}</td>
        <td><b>${signed(t.power)}</b></td><td>${signed(t.net)}</td><td>${f1(t.expW)}</td><td>${signed(t.luck)}</td>
        <td>${tempo(t.poss)}</td><td>${signed(t.sosPlayed, false)}</td><td>${signed(t.sosLeft, false)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card" style="max-width:900px;margin-top:14px"><h3>How to read it</h3>
      <ul class="legend">
        <li><b>Power</b><span class="muted">How good a team really is: points per 100 possessions better than an average team, corrected for the opponents it has faced and home court. Ranked by this. Early in the season last season's level counts as a starting point; it fades as games are played.</span></li>
        <li><b>Exp. W / Luck</b><span class="muted">Wins a team "deserves" from points scored and allowed, and how many more (or fewer) it actually has. Close wins are often luck and don't repeat.</span></li>
        <li><b>Poss</b><span class="muted">Possessions per game, overtime included: how fast a team plays. "Fast" / "slow" = at least 2 possessions above / below the ${comp === 'EuroCup' ? 'group' : 'league'} average (${lgPoss ? f1(lgPoss) : '–'}).</span></li>
        <li><b>Schedule</b><span class="muted">Average power of opponents faced so far and still to come: above 0 = tougher than average.</span></li>
      </ul></div>
    ${comp === 'GBL' ? VIEWS.standingsOfficial().split('<h3 class="official-h">EuroCup')[0] : '<h3 class="official-h">EuroCup' + VIEWS.standingsOfficial().split('<h3 class="official-h">EuroCup')[1]}`;
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
    ['Record', p ? `${p.w}–${p.l}` : '–', o ? `${o.w}–${o.l}` : '–', null],
    ['Points scored', v(p?.pts), v(o?.pts), 'pts', 1], ['Points allowed', v(p?.allowed), v(o?.allowed), 'allowed', -1],
    ['Possessions per game', v(p?.poss), v(o?.poss), 'poss', 1], ['Offensive rating', v(p?.ortg), v(o?.ortg), 'ortg', 1],
    ['Defensive rating', v(p?.drtg), v(o?.drtg), 'drtg', -1],
    ['FG%', v(p?.fgp), v(o?.fgp), 'fgp', 1], ['3P%', v(p?.fg3p), v(o?.fg3p), 'fg3p', 1], ['3PA', v(p?.fg3a), v(o?.fg3a), 'fg3a', 1],
    ['FT%', v(p?.ftp), v(o?.ftp), 'ftp', 1], ['Rebounds', v(p?.reb), v(o?.reb), 'reb', 1], ['Off. rebounds', v(p?.oreb), v(o?.oreb), 'oreb', 1],
    ['Assists', v(p?.ast), v(o?.ast), 'ast', 1], ['Turnovers', v(p?.tov), v(o?.tov), 'tov', -1], ['Steals', v(p?.stl), v(o?.stl), 'stl', 1],
    ['PIR', v(p?.pir), v(o?.pir), 'pir', 1], ['Opponents’ FG%', v(p?.opp_fgp), v(o?.opp_fgp), 'opp_fgp', -1],
  ];
  const hasLg = !!leagueOf(pick.comp);
  const meL = hasLg ? leagueTeam(pick.comp, 'PAOK') : null, oppL = hasLg ? leagueTeam(pick.comp, pick.opp) : null;
  const withRank = (val, team, k, dir) => (hasLg && k ? `${val} <span class="rk">${rankBadge(rankIn(pick.comp, team, k, dir))}</span>` : val);
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
        <div class="muted">PAOK win chance: <b style="color:#fff">${pr.winProb}%</b> · expected ${pr.pace ? f1(pr.pace) : '–'} possessions · ${esc(src)}${pr.note ? ' · ' + esc(pr.note) : ''}</div>
      </div>
      <div class="grid two" style="margin-top:16px">${ptable(us, 'PAOK')}${ptable(them, pick.opp)}</div>
      <p class="note">How it works: expected possessions = both teams' possessions per game relative to the league average. Points per 100 possessions = a team's offensive rating × the opponent's defensive rating ÷ the league average,
        reduced if key scorers are missing. Early-season numbers are pulled toward the league average, plus a small home-court edge.
        Player lines: per-minute production this season × expected minutes (shared out among the available players when someone is out).</p>`;
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
    <div class="table-wrap" style="max-width:${hasLg ? 860 : 640}px"><table>
      <thead><tr><th class="l">Stat</th><th>PAOK</th><th>${esc(pick.opp)}</th>${hasLg ? `<th>${esc(avgLabel(pick.comp))}</th>` : ''}</tr></thead>
      <tbody>${rows.map(([l, a, b, k, dir]) => `<tr><td class="l">${l}</td><td><b>${withRank(a, meL, k, dir)}</b></td><td>${withRank(b, oppL, k, dir)}</td>${hasLg ? `<td>${k ? lgVal(pick.comp, k) : '–'}</td>` : ''}</tr>`).join('')}</tbody>
    </table></div>
    ${hasLg ? `<p class="note">Rank among the ${leagueOf(pick.comp).teams.length} ${esc(scopeLabel(pick.comp))} (1st = best). <a href="#league" onclick="state.filters.league='${pick.comp}'">Full league table →</a></p>` : ''}
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
    <p class="note">"Leads the team" counts players who've played at least half of the games. Box scores only capture part of defence: steals, blocks, defensive rebounds, fouls and plus/minus.</p>`;
};

/* ---------- possessions, pace and efficiency ---------- */
// possessions estimate (standard box-score formula), averaged over both teams
const possOf = (t) => t.fg2a + t.fg3a - t.oreb + t.tov + 0.44 * t.fta;
const gamePoss = (g) => (possOf(g.box.team) + possOf(g.box.opp)) / 2;
// game length from players' minutes (200 player-minutes = 40 game minutes); catches overtime
const gameMinutes = (g) => Math.max(40, Math.round(g.box.players.reduce((s, p) => s + (p.sec || 0), 0) / 300 / 5) * 5);
function paceStats(games) {
  const n = games.length;
  if (!n) return null;
  const poss = games.reduce((s, g) => s + gamePoss(g), 0);
  const mins = games.reduce((s, g) => s + gameMinutes(g), 0);
  const sum = (side, k) => games.reduce((s, g) => s + (g.box[side][k] || 0), 0);
  const side = (a, b) => {
    const fga = sum(a, 'fg2a') + sum(a, 'fg3a'), fgm = sum(a, 'fg2m') + sum(a, 'fg3m');
    return {
      rating: (100 * sum(a, 'pts')) / poss,
      efg: fga ? (100 * (fgm + 0.5 * sum(a, 'fg3m'))) / fga : null,
      ts: (100 * sum(a, 'pts')) / (2 * (fga + 0.44 * sum(a, 'fta'))),
      tovPct: (100 * sum(a, 'tov')) / poss,
      orebPct: (100 * sum(a, 'oreb')) / (sum(a, 'oreb') + sum(b, 'dreb') || 1),
      ftr: fga ? (100 * sum(a, 'ftm')) / fga : null,
      astPct: fgm ? (100 * sum(a, 'ast')) / fgm : null,
    };
  };
  return { n, poss: poss / n, pace: (poss * 40) / mins, us: side('team', 'opp'), them: side('opp', 'team') };
}
function paceSection(games, comp) {
  const st = paceStats(games);
  if (!st) return '';
  const net = st.us.rating - st.them.rating;
  const hasLg = !!leagueOf(comp);
  const me = hasLg ? leagueTeam(comp, 'PAOK') : null;
  const lgLine = (key, dir) => (hasLg ? `<div class="lg">${esc(avgLabel(comp))} ${lgVal(comp, key)} · ${rankBadge(rankIn(comp, me, key, dir))}</div>` : '');
  const tile = (v, s, cls = '', key = null, dir = 1) => `<div class="tile"><div class="v ${cls}">${v}</div><div class="s">${s}</div>${key ? lgLine(key, dir) : ''}</div>`;
  const pctRow = (l, k, betterHigh = true) => {
    const a = st.us[k], b = st.them[k];
    const win = a !== null && b !== null && (betterHigh ? a > b : a < b);
    return `<tr><td class="l">${l}</td><td><b class="${win ? 'pos-text' : ''}">${f1(a)}%</b></td><td>${f1(b)}%</td>${hasLg ? `<td>${lgVal(comp, k, '%')}</td><td>${rankBadge(rankIn(comp, me, k, betterHigh ? 1 : -1))}</td>` : ''}</tr>`;
  };
  return `<h2>Four factors &amp; shooting efficiency</h2>
    <div class="table-wrap" style="max-width:${hasLg ? 860 : 640}px"><table>
      <thead><tr><th class="l">Stat</th><th>PAOK</th><th>Opponents</th>${hasLg ? `<th>${esc(avgLabel(comp))}</th><th>PAOK rank</th>` : ''}</tr></thead>
      <tbody>
        ${pctRow('Effective FG% (eFG%)', 'efg')}
        ${pctRow('True shooting % (TS%)', 'ts')}
        ${pctRow('Turnover % (TOV%)', 'tovPct', false)}
        ${pctRow('Offensive rebound % (OREB%)', 'orebPct')}
        ${pctRow('Free throw rate (FTM per 100 FGA)', 'ftr')}
        ${pctRow('Assisted baskets (AST / FGM)', 'astPct')}
      </tbody></table></div>
    <div class="card" style="max-width:760px;margin-top:16px">
      <h3>How to read these</h3>
      <ul class="legend">
        <li><b>Possessions</b><span class="muted">How many times a team had the ball: shots + turnovers + trips to the line − offensive rebounds (each one keeps the same possession alive). Both teams get roughly the same number.</span></li>
        <li><b>Off. / Def. rating</b><span class="muted">Points scored / allowed per 100 possessions. Removes the effect of tempo, so a slow and a fast team can be compared fairly.</span></li>
        <li><b>Net rating</b><span class="muted">Offensive minus defensive rating: how many points per 100 possessions PAOK outscore opponents by.</span></li>
        <li><b>eFG% / TS%</b><span class="muted">Shooting efficiency that counts a three as worth more (eFG%), and also free throws (TS%).</span></li>
        <li><b>TOV% / OREB%</b><span class="muted">Share of possessions lost to turnovers; share of own missed shots rebounded. Green = PAOK better than opponents.</span></li>
      </ul>
    </div>
`;
}

/* ---------- league table: every team, every stat ---------- */
// [key, header, direction (1 = higher is better), group, shown in the compact view]
const LEAGUE_COLS = [
  ['w', 'W–L', 1, 'Overall', true], ['net', 'Net', 1, 'Overall', true], ['ortg', 'ORtg', 1, 'Overall', true],
  ['drtg', 'DRtg', -1, 'Overall', true], ['poss', 'Poss', 1, 'Overall', true],
  ['efg', 'eFG%', 1, 'Offence', true], ['tovPct', 'TOV%', -1, 'Offence', true], ['orebPct', 'OREB%', 1, 'Offence', true],
  ['ftr', 'FT rate', 1, 'Offence', true], ['par3', '3PA rate', 1, 'Offence', true],
  ['opp_efg', 'Opp eFG%', -1, 'Defence', true], ['forcedTov', 'Forced TOV%', 1, 'Defence', true],
  ['drebPct', 'DREB%', 1, 'Defence', true], ['opp_ftr', 'Opp FT rate', -1, 'Defence', true],
  ['pts', 'PTS', 1, 'Per game', false], ['allowed', 'OPP', -1, 'Per game', false], ['ts', 'TS%', 1, 'Per game', false],
  ['fg3p', '3P%', 1, 'Per game', false], ['ftp', 'FT%', 1, 'Per game', false], ['reb', 'REB', 1, 'Per game', false],
  ['ast', 'AST', 1, 'Per game', false], ['stl', 'STL', 1, 'Per game', false], ['blk', 'BLK', 1, 'Per game', false],
  ['pir', 'PIR', 1, 'Per game', false],
];
VIEWS.league = function league() {
  const comps = ['GBL', 'EuroCup'].filter((c) => leagueOf(c));
  if (!comps.length) return '<h2>League</h2><p class="empty">League stats not available yet.</p>';
  const comp = comps.includes(state.filters.league) ? state.filters.league : comps[0];
  state.filters.league = comp;
  const lg = leagueOf(comp);
  const next = new Set(state.scout.reports.filter((r) => r.comp === comp).map((r) => nameKey(r.opp)));
  const isNext = (t) => [...next].some((k) => nameKey(t.team) === k || nameKey(t.team).includes(k) || k.includes(nameKey(t.team)));
  const cols = LEAGUE_COLS.filter((c) => state.filters.leagueAll || c[4]);
  const sortKey = cols.some(([k]) => k === state.filters.leagueSort) ? state.filters.leagueSort : 'net';
  const dir = (LEAGUE_COLS.find(([k]) => k === sortKey) || [0, 0, 1])[2];
  // EuroCup: only PAOK's group (the league average row still covers the whole EuroCup)
  const group = comp === 'EuroCup' ? (lg.teams.find((t) => t.paok) || {}).group : null;
  const pool = group ? lg.teams.filter((t) => t.group === group) : lg.teams;
  const teams = [...pool].sort((a, b) => dir * ((b[sortKey] ?? -1e9) - (a[sortKey] ?? -1e9)));
  const cell = (t, k) => { const v = t[k]; if (v === null || v === undefined) return '–'; return k === 'w' ? `${t.w}–${t.l}` : k === 'net' ? `<span class="${v > 0 ? 'pos-text' : v < 0 ? 'neg-text' : ''}">${v > 0 ? '+' : ''}${f1(v)}</span>` : f1(v); };
  // header bands: Overall / Offence / Defence / Per game
  const groups = cols.reduce((acc, c) => { const last = acc[acc.length - 1]; if (last && last.name === c[3]) last.n++; else acc.push({ name: c[3], n: 1 }); return acc; }, []);
  const avg = group && lg.groupAvg && lg.groupAvg[group] ? lg.groupAvg[group] : lg.avg;
  return `<h2>League stats</h2>
    ${seg('league', comps.map((c) => { const g = c === 'EuroCup' ? (leagueOf(c).teams.find((t) => t.paok) || {}).group : null; return [c, g ? `EuroCup · ${g}` : compName(c)]; }))}
    <p class="muted">${group ? `${esc(group)} (PAOK's group) · ${teams.length} teams` : `${teams.length} teams · ${lg.games} games played`} · per game. Click a column to sort; the line at the bottom is the ${group ? `${esc(group)} average` : 'league average'}.</p>
    <div class="table-wrap"><table class="league">
      <thead><tr class="groups"><th colspan="2"></th>${groups.map((g) => `<th colspan="${g.n}" class="grp">${g.name}${g.name === 'Offence' || g.name === 'Defence' ? ' · four factors' : ''}</th>`).join('')}</tr>
        <tr><th>#</th><th class="l">Team</th>${cols.map(([k, l, d, g]) => `<th class="sortable ${sortKey === k ? 'sorted' : ''} ${g === 'Defence' || g === 'Offence' ? 'ff' : ''}" title="${d < 0 ? 'Lower is better' : 'Higher is better'}" onclick="state.filters.leagueSort='${k}';rerender()">${l}</th>`).join('')}</tr></thead>
      <tbody>${teams.map((t, i) => `<tr class="${t.paok ? 'hl' : isNext(t) ? 'next-opp' : ''}"><td>${i + 1}</td><td class="l">${esc(t.team)}${isNext(t) && !t.paok ? ' <span class="pill">Next opponent</span>' : ''}</td>${cols.map(([k]) => `<td>${cell(t, k)}</td>`).join('')}</tr>`).join('')}
      <tr class="avg-row"><td></td><td class="l">${group ? `${esc(group)} average` : 'League average'}</td>${cols.map(([k]) => `<td>${['gp', 'w', 'net'].includes(k) ? '' : avg[k] === null || avg[k] === undefined ? '–' : f1(avg[k])}</td>`).join('')}</tr></tbody>
    </table></div>
    <p><button class="btn-toggle" onclick="state.filters.leagueAll=!state.filters.leagueAll;rerender()">${state.filters.leagueAll ? 'Show key columns only' : 'Show all columns'}</button></p>
    <div class="card" style="max-width:860px;margin-top:8px"><h3>Columns</h3>
      <ul class="legend">
        <li><b>Net</b><span class="muted">Points per 100 possessions better (or worse) than opponents. The single best indicator of team strength; sorted by this by default.</span></li>
        <li><b>ORtg / DRtg</b><span class="muted">Points scored / allowed per 100 possessions. Lower DRtg = better defence.</span></li>
        <li><b>Poss</b><span class="muted">Possessions per game, overtime included: how fast a team plays. Not good or bad, but it sets how many points a game will have.</span></li>
        <li><b>eFG% / Opp eFG%</b><span class="muted">Shooting efficiency (a three counts 1.5×), own and allowed. The most important of the four factors.</span></li>
        <li><b>TOV% / Forced TOV%</b><span class="muted">Out of 100 possessions, how many end in a turnover: own (lower = better) and opponents' (higher = better defence).</span></li>
        <li><b>OREB% / DREB%</b><span class="muted">Share of own misses rebounded (second chances) and of opponents' misses secured (no second chances).</span></li>
        <li><b>FT rate / Opp FT rate</b><span class="muted">Free throws made per 100 shots: getting to the line, and fouling (lower = better defence).</span></li>
        <li><b>3PA rate</b><span class="muted">Share of shots that are threes: playing style.</span></li>
      </ul>
      <p class="note">Hover a column title to see whether higher or lower is better. Early in the season one game can swing every number a lot.</p></div>`;
};

/* ---------- league averages and ranks ---------- */
// for the EuroCup, comparisons are within PAOK's group: only those teams, and the group's own average
function leagueOf(comp) {
  const lg = (state.league.comps || {})[comp];
  if (!lg || comp !== 'EuroCup') return lg;
  const group = (lg.teams.find((t) => t.paok) || {}).group;
  if (!group || !lg.groupAvg || !lg.groupAvg[group]) return lg;
  return { ...lg, teams: lg.teams.filter((t) => t.group === group), avg: lg.groupAvg[group], group };
}
const avgLabel = (comp) => { const lg = leagueOf(comp); return lg && lg.group ? `${lg.group} avg` : `${compName(comp)} avg`; };
const scopeLabel = (comp) => { const lg = leagueOf(comp); return lg && lg.group ? `${lg.group} teams` : `${compName(comp)} teams`; };
const nameKey = (n) => n.toLowerCase().replace(/[^a-z]/g, '');
function leagueTeam(comp, name) {
  const lg = leagueOf(comp);
  if (!lg) return null;
  if (name === 'PAOK') return lg.teams.find((t) => t.paok);
  const k = nameKey(name);
  return lg.teams.find((t) => nameKey(t.team) === k) || lg.teams.find((t) => nameKey(t.team).includes(k) || k.includes(nameKey(t.team)));
}
// rank of a team for one stat: dir 1 = higher is better, -1 = lower is better
function rankIn(comp, team, key, dir = 1) {
  const lg = leagueOf(comp);
  if (!lg || !team || team[key] === null || team[key] === undefined) return null;
  const vals = lg.teams.map((t) => t[key]).filter((v) => v !== null && v !== undefined);
  const better = vals.filter((v) => (dir > 0 ? v > team[key] : v < team[key])).length;
  return { rank: better + 1, of: vals.length };
}
function rankBadge(r) {
  if (!r) return '<span class="muted">–</span>';
  const cls = r.rank <= Math.ceil(r.of / 3) ? 'pos-text' : r.rank > Math.floor((2 * r.of) / 3) ? 'neg-text' : '';
  return `<span class="${cls}">${ordinal(r.rank)}</span><span class="muted"> / ${r.of}</span>`;
}
const lgMA = (comp, made, att) => { const lg = leagueOf(comp); return lg && lg.avg && lg.avg[made] != null ? `${f1(lg.avg[made])} – ${f1(lg.avg[att])}` : '–'; };
const lgVal = (comp, key, suffix = '') => { const lg = leagueOf(comp); const v = lg && lg.avg ? lg.avg[key] : null; return v === null || v === undefined ? '–' : f1(v) + suffix; };

/* ---------- on / off court plus-minus ---------- */
// For a game with +/- data: on-court +/- is the player's own; off-court = team margin − on-court (exact, since every
// minute is either with him on or off the floor). Minutes off = game minutes − his minutes.
function onOffRows(comp) {
  const map = new Map();
  for (const g of gamesWithBox(comp)) {
    if (!g.box.players.some((p) => p.pm !== null && p.pm !== undefined)) continue; // source without +/-
    const margin = g.us - g.them;
    const gameMin = gameMinutes(g);
    for (const p of g.box.players) {
      if (!p.sec || p.pm === null || p.pm === undefined) continue;
      const key = p.name.toLowerCase().replace(/-/g, ' ').split(' ').pop();
      const t = map.get(key) || { name: p.name, no: p.no, gp: 0, onMin: 0, offMin: 0, on: 0, off: 0 };
      t.gp++;
      t.onMin += p.sec / 60;
      t.offMin += Math.max(0, gameMin - p.sec / 60);
      t.on += p.pm;
      t.off += margin - p.pm;
      map.set(key, t);
    }
  }
  return [...map.values()].map((t) => {
    const on40 = t.onMin ? (40 * t.on) / t.onMin : null;
    const off40 = t.offMin >= 1 ? (40 * t.off) / t.offMin : null;
    return { ...t, on40, off40, diff: on40 !== null && off40 !== null ? on40 - off40 : null };
  });
}
function onOffSection(comp) {
  const rows = onOffRows(comp);
  if (!rows.length) return `<h2>On / off court</h2><p class="empty">No ${comp === 'All' ? '' : esc(compName(comp)) + ' '}games with plus/minus data yet.</p>`;
  const games = gamesWithBox(comp).filter((g) => g.box.players.some((p) => p.pm !== null && p.pm !== undefined)).length;
  // regulars only: more than 10 minutes per game on average over the games with +/- data (e.g. 50+ minutes in 5 games)
  const MIN_PER_GAME = 10;
  const hiddenCount = rows.filter((r) => r.onMin / games <= MIN_PER_GAME).length;
  rows.splice(0, rows.length, ...rows.filter((r) => r.onMin / games > MIN_PER_GAME));
  const sortKey = ['on40', 'off40'].includes(state.filters.onoffSort) ? 'diff' : state.filters.onoffSort || 'diff';
  rows.sort((a, b) => (b[sortKey] ?? -1e9) - (a[sortKey] ?? -1e9));
  const sg = (v) => (v === null || v === undefined ? '–' : `<span class="${pmClass(v)}">${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : f1(v)}</span>`);
  const th = (k, l, title) => `<th class="sortable ${sortKey === k ? 'sorted' : ''}" title="${title}" onclick="state.filters.onoffSort='${k}';rerender()">${l}</th>`;
  return `<h2>On / off court</h2>
    <p class="muted">How PAOK do with each player on the floor vs on the bench · ${games} game${games > 1 ? 's' : ''} with plus/minus data · players averaging more than ${MIN_PER_GAME} minutes per game (over ${games * MIN_PER_GAME} minutes in total)${hiddenCount ? ` · ${hiddenCount} player${hiddenCount > 1 ? 's' : ''} below that not shown` : ''}.</p>
    <div class="table-wrap"><table>
      <thead>
        <tr class="groups"><th colspan="3"></th><th colspan="2" class="grp">On court</th><th colspan="2" class="grp">Off court</th><th class="grp">Difference</th></tr>
        <tr><th class="l">#</th><th class="l">Player</th><th>GP</th>
          ${th('onMin', 'MIN', 'Minutes on court')}${th('on', '+/-', 'Points PAOK outscored opponents by while he played')}
          ${th('offMin', 'MIN', 'Minutes on the bench')}${th('off', '+/-', 'Points PAOK outscored opponents by while he sat')}
          ${th('diff', 'On − off per 40', 'How much better PAOK are with him on the floor, per 40 minutes')}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="l">${esc(r.no)}</td><td class="l"><b>${esc(r.name)}</b></td><td>${r.gp}</td>
        <td>${Math.round(r.onMin)}</td><td>${sg(r.on)}</td>
        <td>${Math.round(r.offMin)}</td><td>${sg(r.off)}</td>
        <td><b>${sg(r.diff)}</b></td></tr>`).join('')}</tbody>
    </table></div>
    <p class="note">Off-court +/- = PAOK's final margin minus the player's own +/- (every minute he isn't playing, he's on the bench), so it's exact.
      Plus/minus also reflects teammates and opponents on the floor, so read it over many games: a few games can swing it a lot.</p>`;
}

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
    <p><b>Performance Index Rating</b> is the one-number score the EuroLeague, EuroCup and Greek League use to rate a player's game.</p>
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
  const gp = gamePoss(g);
  $('#box-body').innerHTML = `<p class="muted" style="margin-top:0">${fmtDate(g.date, { year: 'numeric' })} · ${esc(g.venue)} · ${f1(gp)} possessions · PAOK ${f1((100 * g.us) / gp)} pts per 100 poss vs ${f1((100 * g.them) / gp)}${g.url ? ` · <a href="${esc(g.url)}" target="_blank" rel="noopener">Match report ↗</a>` : ''}</p>
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
