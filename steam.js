// Steam on the charm: your profile, your library and its hours, and the game you're playing right now.
// Steam's Web API sends no CORS headers, so this page can't ask it. larp-bridge asks instead (with your API key, which
// stays on your computer) and streams the answer here next to Claude Code's state. This page shows it in the steam tab
// and relays it to the charm: CMD_STEAM (0x23) packets, and the avatar as a 64x64 JPEG (transfer kind 7).
// The packet layouts are in firmware/LarpCharm/21_steam.ino. Uses app.js's packet(), write(), sendBlob(), ccB, rxChar.
(() => {
  const $ = id => document.getElementById(id);
  const KIND_AVATAR = 7, N_GAMES = 24, N_TOP = 18;
  const GREEN = '#90ba3c', BLUE = '#57cbde', GREY = '#898989', DIMBLUE = '#3e7e8c', DIM = '#606a78';
  const STATES = ['offline', 'online', 'busy', 'away', 'snooze', 'trading', 'looking to play'];
  const st = { d: null, sent: {}, ava: null, avaFor: '', avaUrl: '', avaImg: null, avaBusy: false, sort: 0 };
  const clean = s => ascii(String(s ?? '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim()).replace(/\x1F/g, ' ');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sp = (s, col, b) => `<span style="color:${col}${b ? ';font-weight:700' : ''}">${esc(s)}</span>`;
  const hours = m => m < 60 ? `${m}m` : m < 600 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m / 60).toLocaleString('en')}h`;
  const clock = s => `${s / 3600 | 0}:${String((s / 60 | 0) % 60).padStart(2, '0')}:${String(s % 60 | 0).padStart(2, '0')}`;
  const ago = d => d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  const live = () => ccB.up && st.d && st.d.ok;
  // the steam screen arrived in firmware 1.1.0: older charms get nothing (they'd ignore it, or refuse the avatar)
  const charmFw = () => (($('fw') && $('fw').textContent) || '').trim();
  const charmHasSteam = () => { const m = charmFw().match(/^(\d+)\.(\d+)/); return !!m && (+m[1] > 1 || (+m[1] === 1 && +m[2] >= 1)); };
  const stateCol = (state, playing) => playing ? GREEN : state === 0 ? GREY : state === 1 || state >= 5 ? BLUE : DIMBLUE;

  // ── what the charm gets: the profile, what's running, and up to 24 games (the most played, then recent ones) ──
  function charmView(){
    const d = st.d;
    if (!d || !d.profile) return null;
    const now = Date.now() / 1000;
    const top = [...d.games].sort((a, b) => b.min - a.min).slice(0, N_TOP), seen = new Set(top.map(g => g.appid));
    const recent = d.games.filter(g => g.wk && !seen.has(g.appid)).sort((a, b) => b.wk - a.wk).slice(0, N_GAMES - top.length);
    const games = [...top, ...recent].map(g => ({ appid: g.appid, name: clean(g.name).slice(0, 27), min: g.min, wk: Math.min(65535, g.wk),
      days: g.last ? Math.min(65534, Math.max(0, Math.floor((now - g.last) / 86400))) : 65535 }));
    let playing = null;
    if (d.playing) {
      const g = d.games.find(x => x.appid === d.playing.appid);
      playing = { name: clean(d.playing.name).slice(0, 39), exact: !!d.playing.exact, since: d.playing.since, min: g ? g.min : 0, wk: g ? g.wk : 0 };
    }
    return { name: clean(d.profile.name), country: clean(d.profile.country), state: d.profile.state, level: d.level | 0, since: d.profile.since | 0,
      count: d.gameCount | 0, totalMin: d.totalMin | 0, wkMin: d.wkMin | 0, games, playing, live: live(), at: d.at };
  }
  window.steamView = () => { const v = charmView(); if (v) v.avatar = st.avaImg; return v; };

  function packets(v){
    const prof = packet(CMD.STEAM, [0, v.state & 255, ...u16(Math.min(65535, v.level)), ...u16(Math.min(65535, v.count)), ...u32(v.totalMin >>> 0),
      ...u16(Math.min(65535, v.wkMin)), ...u16(v.since)], v.name.slice(0, 22) + '\x1F' + v.country.slice(0, 3));
    const p = v.playing, secs = p ? Math.max(0, Math.round((Date.now() - p.since) / 1000)) : 0;
    const now = packet(CMD.STEAM, [1, p ? 1 | (p.exact ? 2 : 0) : 0, ...u32(secs), ...u32(p ? p.min >>> 0 : 0), ...u16(p ? Math.min(65535, p.wk) : 0)], p ? p.name : '');
    const lib = v.games.length ? v.games.map((g, i) => packet(CMD.STEAM, [2, i, v.games.length, ...u32(g.min >>> 0), ...u16(g.wk), ...u16(g.days)], g.name))
      : [packet(CMD.STEAM, [2, 0, 0])];
    return { prof, now, lib, profKey: String(prof), nowKey: p ? `${p.name}|${p.exact}|${p.min}|${p.wk}` : '-', libKey: lib.map(String).join('|') };
  }
  window.steamPackets = () => { const v = charmView(); return v ? packets(v) : null; };      // for tests: what the charm would get

  // send the charm what changed (and what's running every minute, so it knows the link is live)
  function relay(){
    const v = charmView();
    if (!rxChar || !v || !charmHasSteam()) return;
    const S = st.sent, send = b => write(b).catch(() => {}), pk = packets(v);
    if (S.prof !== pk.profKey) { S.prof = pk.profKey; send(pk.prof); }
    if (S.lib !== pk.libKey) { S.lib = pk.libKey; pk.lib.forEach(send); }
    if (S.now !== pk.nowKey || Date.now() - (S.nowAt || 0) > 60000) { S.now = pk.nowKey; S.nowAt = Date.now(); send(pk.now); }
    if (st.ava && S.ava !== st.avaFor) { S.ava = st.avaFor; sendBlob(KIND_AVATAR, st.ava, 0).catch(() => { S.ava = null; }); }
  }

  async function fetchAvatar(){
    const h = st.d && st.d.profile && st.d.profile.avatar;
    if (!h || h === st.avaFor || st.avaBusy) return;
    st.avaBusy = true;
    try {
      const r = await fetch(`${ccB.url}/steam/avatar?h=${encodeURIComponent(h)}`, { cache: 'no-store' });
      if (!r.ok) return;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length < 100 || bytes.length > 16000) return;
      st.ava = bytes; st.avaFor = h;
      if (st.avaUrl) URL.revokeObjectURL(st.avaUrl);
      st.avaUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      const img = new Image(); img.onload = () => { st.avaImg = img; render(); }; img.src = st.avaUrl;
      relay();
    } catch (_) {} finally { st.avaBusy = false; }
  }

  // ── hooks from app.js ──
  window.steamFromBridge = m => {
    const was = st.d && st.d.playing;
    if (!m.profile || (st.d && st.d.profile && st.d.profile.id !== m.profile.id)) {          // no profile now, or another one
      st.sent = {}; st.avaFor = ''; st.ava = null; st.avaImg = null;
      if (st.avaUrl) { URL.revokeObjectURL(st.avaUrl); st.avaUrl = ''; }
    }
    st.d = m;
    if (m.playing && (!was || was.appid !== m.playing.appid)) klog('stm: playing ' + clean(m.playing.name));
    render(); relay(); fetchAvatar();
  };
  window.steamOnConnect = () => { st.sent = {}; relay(); };
  setInterval(() => { if (st.d && rxChar) relay(); }, 30000);

  // ── the steam tab: the same three commands as the charm's screen ──
  function render(){
    const d = st.d, link = $('stLink');
    if (!link) return;
    keyNote();
    link.textContent = !ccB.up ? 'not running' : !d ? 'linked' : d.ok ? 'linked' : d.configured ? 'error' : 'no api key';
    link.className = ccB.up && d && d.ok ? 'ok' : 'bad';
    $('stNote').textContent = !ccB.up ? 'start it: node larp-bridge/bridge.mjs' : d && d.err && d.configured ? d.err : d && d.ok ? `checked ${Math.max(0, (Date.now() - d.at) / 1000 | 0)}s ago` : '';
    const v = charmView(), ava = $('stAva');
    ava.hidden = !st.avaUrl;
    if (st.avaUrl && ava.src !== st.avaUrl) ava.src = st.avaUrl;
    if (!v) {
      $('stWho').innerHTML = sp('$ ', ACCV()) + 'steam --whoami<br>' + sp(!ccB.up ? 'steam: the bridge isn’t running' : !d || !d.configured ? 'steam: no api key yet. enter it below' : 'steam: ' + (d.err || 'asking steam…'), DIM);
      $('stOut').textContent = '';
      return;
    }
    const p = d.profile, playing = v.playing && v.live, col = stateCol(p.state, playing);
    ava.style.borderColor = col;
    $('stWho').innerHTML = [
      sp('$ ', ACCV()) + 'steam --whoami',
      `<b>${esc(p.name)}</b>`,
      sp('● ' + (playing ? 'in-game: ' + d.playing.name : STATES[p.state] || 'online'), col),
      sp([`level ${v.level}`, p.country, p.since ? `on steam since ${p.since}` : '', p.public ? '' : 'private profile'].filter(Boolean).join(' · '), DIM) +
        (p.url ? ` <a class="link" href="${esc(p.url)}" target="_blank" rel="noopener">profile ↗</a>` : ''),
    ].join('<br>');
    const out = [sp('$ ', ACCV()) + 'pgrep -l game'];
    if (playing) {
      const s = Math.max(0, (Date.now() - v.playing.since) / 1000 | 0);
      out.push('  ' + sp(d.playing.name, '#fff', 1) + '   ' + sp(`${v.playing.exact ? 'session' : 'seen for'} ${clock(s)}`, GREEN) + sp(`   ${hours(v.playing.min)} total, ${hours(v.playing.wk)} in 2 weeks`, DIM));
    } else {
      const last = [...d.games].filter(g => g.last).sort((a, b) => b.last - a.last)[0];
      out.push('  ' + sp('nothing running', DIM) + (last ? sp('   last played ', DIM) + esc(last.name) + sp(', ' + ago(Math.floor((Date.now() / 1000 - last.last) / 86400)), DIM) : ''));
    }
    out.push('');
    const list = st.sort ? d.games.filter(g => g.wk).sort((a, b) => b.wk - a.wk) : [...d.games].sort((a, b) => b.min - a.min);
    const shown = list.slice(0, 15), top = Math.max(1, ...shown.map(g => st.sort ? g.wk : g.min));
    out.push(sp('$ ', ACCV()) + (st.sort ? 'ls -t ~/library | head' : 'ls -S ~/library | head -15'));
    if (d.libPrivate) out.push('  ' + sp('steam shows no games: set Privacy > Game details to Public', '#ffb000'));
    else if (!shown.length) out.push('  ' + sp(st.sort ? 'nothing played in the last two weeks' : 'no games', DIM));
    const bar = f => { const n = f * 20, full = n | 0, part = ' ▏▎▍▌▋▊▉'[Math.round((n - full) * 7)] || ''; return ('█'.repeat(full) + (full < 20 ? part : '')).padEnd(20); };
    shown.forEach((g, i) => {
      const val = st.sort ? g.wk : g.min, now_ = playing && g.appid === d.playing.appid;
      out.push(sp(hours(val).padStart(7), i ? '#cdd6e0' : ACCV()) + ' ' + sp(bar(val / top), i ? '#3e6070' : ACCV()) + ' ' + sp(g.name, now_ ? GREEN : i ? '#cdd6e0' : '#fff', !i));
    });
    const more = (st.sort ? list.length : Math.max(list.length, v.count)) - shown.length;
    if (more > 0) out.push(sp(`        … ${more.toLocaleString('en')} more`, DIM));
    out.push('', sp('$ ', ACCV()) + 'du -sh ~/library',
      `  ${sp(hours(v.totalMin), '#fff', 1)} in ${v.count.toLocaleString('en')} games${sp(' · ' + hours(v.wkMin) + ' in the last 2 weeks', DIM)}`);
    $('stOut').innerHTML = out.join('\n');
  }
  const ACCV = () => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#00E5FF';
  setInterval(() => { if ($('stOut') && $('stOut').offsetParent && !document.hidden) render(); }, 1000);

  seg('stSort', v => { st.sort = +v; render(); });
  function keyNote(){
    const d = st.d, id = $('stId');
    $('stKeyNote').textContent = !ccB.up ? 'start the bridge to set this' : d && d.keySet ? 'a key is saved on this computer' : 'no key saved yet';
    if (d && d.idText && !id.value && document.activeElement !== id) id.value = d.idText;
    $('stKey').placeholder = d && d.keySet ? 'saved (leave empty to keep it)' : '32 characters';
  }
  $('stSave').onclick = act(async () => {
    if (!ccB.up) throw new Error('Start the bridge first: node larp-bridge/bridge.mjs');
    const key = $('stKey').value.trim(), id = $('stId').value.trim();
    $('stSave').disabled = true; hud('Checking with Steam…');
    try {
      const r = await ccCmd({ op: 'steamConfig', key, id });
      if (!r.ok) throw new Error(r.err || 'Steam said no.');
      $('stKey').value = '';
      hud(`Linked to ${r.name || 'your Steam profile'}`);
    } finally { $('stSave').disabled = false; }
  });
  $('stClear').onclick = act(async () => {
    if (!ccB.up) throw new Error('Start the bridge first.');
    if (!confirm('Forget the Steam key and profile on this computer?')) return;
    await ccCmd({ op: 'steamConfig', clear: true }); $('stKey').value = ''; $('stId').value = ''; hud('Steam key forgotten');
  });
  [$('stKey'), $('stId')].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') $('stSave').click(); }));
  $('stShow').onclick = act(async () => { if (!st.d || !st.d.profile) throw new Error(ccB.up ? 'No Steam profile yet: enter your key below.' : 'Start the bridge first.'); if (rxChar && !charmHasSteam()) throw new Error(`The charm runs ${charmFw() || 'older firmware'}; its steam screen needs firmware 1.1.0.`); st.sent = {}; relay(); gotoMode(MODE.STEAM); });
  $('stRefresh').onclick = act(async () => { if (!ccB.up) throw new Error('Start the bridge first.'); await ccCmd({ op: 'steam' }); hud('Asking Steam…'); });

  // larp> steam
  COMMANDS.steam = ['steam [refresh]  your steam profile, library and game', async a => {
    if (a[0] === 'refresh') { if (!ccB.up) return say('bridge not running: node larp-bridge/bridge.mjs'); await ccCmd({ op: 'steam' }); return say('asking steam'); }
    const d = st.d, v = charmView();
    if (!ccB.up) return say('bridge not running: node larp-bridge/bridge.mjs');
    if (!v) return say(`steam: ${d && d.configured ? d.err || 'asking…' : 'no api key. enter it in the steam tab'}`);
    if (rxChar && charmHasSteam()) gotoMode(MODE.STEAM);
    say(`${v.name}  ${v.playing ? 'in-game: ' + d.playing.name : STATES[v.state]}  lvl ${v.level}`,
      `${hours(v.totalMin)} in ${v.count} games, ${hours(v.wkMin)} in 2 weeks`,
      ...[...d.games].sort((a, b) => b.min - a.min).slice(0, 5).map(g => `  ${hours(g.min).padStart(6)}  ${g.name}`));
  }];
  SCREENS.steam = SCREENS.stm = MODE.STEAM;
  if (ccB.steam) window.steamFromBridge(ccB.steam); else render();
})();
