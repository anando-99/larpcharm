// ─────────── Spells: the recorder for air-gesture training data ───────────
// Pick what to record in the plan, then either hold your thumb on the charm's screen while you draw the
// gesture (spells, "not a spell", your own), or press record here for the timed calibration takes.
// Each take arrives from the charm as raw accelerometer + gyro samples at 100 Hz and is kept in this
// browser (IndexedDB) until you download the dataset as JSON. Nothing is uploaded anywhere.
(() => {
  const $ = id => document.getElementById(id);
  const PLAN = [
    { group: 'calibrate', title: '1 · calibrate', note: 'about 3 min. the charm lies untouched while it records; press record (or space) and put it down during the countdown.', items: [
      { label: 'still', goal: 1, timed: 10000, hint: 'flat on the table, screen up. don\'t touch it.' },
      { label: 'screen-down', goal: 1, timed: 5000, hint: 'flat on the table, screen down.' },
      { label: 'top-down', goal: 1, timed: 5000, hint: 'standing on its top edge (the top of the screen on the table).' },
      { label: 'bottom-down', goal: 1, timed: 5000, hint: 'standing on its bottom edge.' },
      { label: 'left-down', goal: 1, timed: 5000, hint: 'standing on its left edge.' },
      { label: 'right-down', goal: 1, timed: 5000, hint: 'standing on its right edge.' },
      { label: 'turn-x', goal: 1, timed: 8000, hint: 'tip it forward a quarter turn and back, slowly, 3 times.' },
      { label: 'turn-y', goal: 1, timed: 8000, hint: 'turn it like a key, a quarter turn and back, slowly, 3 times.' },
      { label: 'turn-z', goal: 1, timed: 8000, hint: 'flat on the table, spin it a quarter turn and back, slowly, 3 times.' }] },
    { group: 'spell', title: '2 · spells', note: '20 takes each, in two sittings of 10. vary the size and the speed, never the shape. same grip every time.', items: [
      { label: 'circle', goal: 20, hint: 'one loop, clockwise, starting at the top.' },
      { label: 'zigzag', goal: 20, hint: 'three sharp peaks, left to right.' },
      { label: 'flick', goal: 20, hint: 'a quick wrist snap to the right, then stop.' },
      { label: 'heart', goal: 20, hint: 'one stroke: start at the top middle, down the left side, back up the right.' }] },
    { group: 'none', title: '3 · not a spell', note: 'same thumb hold, anything but a spell. teaches the charm when to say "no match".', items: [
      { label: 'none', goal: 30, hint: 'hold still, tilt to read, shake, half a circle, scribble, point, pick it up.' }] },
    { group: 'custom', title: '4 · your own (test set)', note: '3 gestures that aren\'t the four spells, 8 takes each. these never go into training: they test teach-your-own.', items: [] }];
  const CUSTOM_GOAL = 8;
  const COLS = ['#ff6060', '#60e080', '#60a0ff', '#ffb040', '#c878ff', '#50e6e6'], NAMES = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'];
  const sp = window.spells = { label: null, takes: [], view: null, recording: false, recAt: 0, countdown: 0, timedUntil: 0, incoming: null, retries: 0 };

  // ── storage: IndexedDB, one record per take ──
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, bad) => { const r = indexedDB.open('larp-spells', 1); r.onupgradeneeded = () => r.result.createObjectStore('takes', { keyPath: 'id', autoIncrement: true }); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, bad) => { const t = d.transaction('takes', mode), s = t.objectStore('takes'), r = fn(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => bad(t.error); }); };
  const loadAll = () => tx('readonly', s => s.getAll());
  const addTake = t => tx('readwrite', s => s.add(t));
  const delTake = id => tx('readwrite', s => s.delete(id));
  const clearAll = () => tx('readwrite', s => s.clear());

  // ── the plan, with your own gestures ──
  const customs = () => { try { return JSON.parse(localStorage.getItem('sp_custom') || '[]'); } catch (_) { return []; } };
  const items = () => PLAN.flatMap(g => (g.group === 'custom' ? customs().map(l => ({ label: l, goal: CUSTOM_GOAL, hint: 'your own gesture. same way every time.' })) : g.items).map(it => ({ ...it, group: g.group })));
  const item = l => items().find(i => i.label === l);
  const count = l => sp.takes.filter(t => t.label === l).length;
  const settings = () => ({ session: $('spSession').value, posture: $('spPosture').value, grip: $('spGrip').value.trim() || 'fingertips, screen facing you' });

  function renderPlan(){
    const box = $('spPlan'); box.innerHTML = '';
    for (const g of PLAN) {
      const list = items().filter(i => i.group === g.group), h = document.createElement('div'); h.className = 'sp-group';
      const done = list.reduce((a, i) => a + Math.min(count(i.label), i.goal), 0), goal = list.reduce((a, i) => a + i.goal, 0);
      h.innerHTML = `<div class="sp-gt"><b>${g.title}</b><span>${goal ? done + '/' + goal : ''}</span></div><p class="meta">${g.note}</p>`;
      for (const it of list) {
        const n = count(it.label), b = document.createElement('button');
        b.className = 'sp-item' + (it.label === sp.label ? ' on' : '') + (n >= it.goal ? ' done' : '');
        b.innerHTML = `<span class="sp-l">${n >= it.goal ? '✓' : it.timed ? '◷' : '·'} ${it.label}</span><span class="sp-n">${n}/${it.goal}</span><i style="width:${Math.min(100, n / it.goal * 100)}%"></i>`;
        b.onclick = () => select(it.label);
        if (g.group === 'custom') { const x = document.createElement('span'); x.className = 'sp-x'; x.textContent = '×'; x.title = 'remove from the plan (keeps its takes)'; x.onclick = e => { e.stopPropagation(); localStorage.setItem('sp_custom', JSON.stringify(customs().filter(l => l !== it.label))); if (sp.label === it.label) sp.label = null; renderAll(); }; b.append(x); }
        h.append(b);
      }
      if (g.group === 'custom') {
        const f = document.createElement('div'); f.className = 'actions';
        f.innerHTML = `<input type="text" id="spNew" placeholder="e.g. letter-a, star, check" maxlength="16" spellcheck="false"><button class="btn sm" id="spAdd">add</button>`;
        h.append(f);
      }
      box.append(h);
    }
    const add = () => { const v = $('spNew').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 16); if (!v || item(v)) return; localStorage.setItem('sp_custom', JSON.stringify([...customs(), v])); select(v); };
    $('spAdd').onclick = add; $('spNew').onkeydown = e => { if (e.key === 'Enter') add(); };
    const total = sp.takes.length; $('spTotal').textContent = `${total} take${total === 1 ? '' : 's'} · ${new Set(sp.takes.map(t => t.label)).size} labels · ${(sp.takes.reduce((a, t) => a + t.n, 0) / 100 / 60).toFixed(1)} min of motion`;
  }

  function select(label){
    sp.label = label; localStorage.setItem('sp_label', label || '');
    sp.view = sp.takes.filter(t => t.label === label).at(-1) || null;
    renderAll(); sendLabel();
  }
  function nextLabel(){
    const list = items(), i = list.findIndex(x => x.label === sp.label);
    const nx = list.slice(i + 1).concat(list.slice(0, i + 1)).find(x => count(x.label) < x.goal);
    if (nx) select(nx.label);
  }

  // ── talking to the charm ──
  const enc = new TextEncoder();
  async function sendLabel(){
    if (typeof rxChar === 'undefined' || !rxChar) return;
    const it = item(sp.label), n = it ? count(it.label) : 0, goal = it ? it.goal : 0;
    const txt = it ? ascii(it.label).slice(0, 20) + '\x1F' + ascii(it.hint).slice(0, 72) : '';
    try { await write(packet(CMD.REC, [0, n & 255, n >> 8, goal & 255, goal >> 8], txt)); setActiveMode(16); } catch (e) { console.warn(e); }
  }
  async function timedTake(){
    const it = item(sp.label); if (!it || !it.timed || sp.countdown || sp.recording) return;
    if (typeof rxChar === 'undefined' || !rxChar) { hud('Connect the charm first.'); return; }
    for (let k = 3; k > 0; k--) { sp.countdown = k; renderNow(); await new Promise(r => setTimeout(r, 1000)); }
    sp.countdown = 0;
    await write(packet(CMD.REC, [2, it.timed & 255, it.timed >> 8])).catch(e => hud(e.message));
    sp.timedUntil = performance.now() + it.timed; renderNow();
  }

  const b64bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  window.spellsOnStatus = s => {
    const [k, v] = [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)];
    if (k === 'recst') { sp.recording = v === '1'; if (sp.recording) sp.recAt = performance.now(); else sp.timedUntil = 0; renderNow(); return; }
    if (k === 'rec0') { const [id, n, hz, al, gl, missed, trig] = v.split(','); sp.incoming = { id: +id, n: +n, hz: +hz, aLsb: +al, gLsb: +gl, missed: +missed, trigger: trig === 't' ? 'thumb' : 'timed', chunks: [], label: sp.label }; renderNow(); return; }
    if (k === 'rec1' && sp.incoming) { const a = v.indexOf(','), b = v.indexOf(',', a + 1); if (+v.slice(0, a) === sp.incoming.id) sp.incoming.chunks[+v.slice(a + 1, b)] = b64bytes(v.slice(b + 1)); return; }
    if (k === 'rec2' && sp.incoming) { const [id, cnt, sum] = v.split(',').map(Number); finish(sp.incoming, id, cnt, sum); }
  };
  async function finish(inc, id, cnt, sum){
    const parts = inc.chunks, ok0 = id === inc.id && parts.length === cnt && parts.every(Boolean);
    const bytes = ok0 ? new Uint8Array(parts.reduce((a, p) => a + p.length, 0)) : null;
    if (bytes) { let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; } }
    const good = bytes && bytes.length === inc.n * 12 && bytes.reduce((a, x) => a + x, 0) === sum;
    if (!good) {
      if (sp.retries++ < 2) { $('spState').textContent = 'that take arrived damaged. asking the charm again...'; await write(packet(CMD.REC, [4])).catch(() => {}); return; }
      sp.retries = 0; sp.incoming = null; $('spState').textContent = 'that take was lost on the way. record it again.'; return;
    }
    sp.retries = 0; sp.incoming = null;
    const it = item(inc.label);
    if (!it) { $('spState').textContent = 'pick a label first: the take was not saved.'; return; }
    const dv = new DataView(bytes.buffer), data = new Int16Array(inc.n * 6);
    for (let i = 0; i < data.length; i++) data[i] = dv.getInt16(i * 2, true);
    const take = { label: it.label, group: it.group, ...settings(), trigger: inc.trigger, hz: inc.hz, aLsb: inc.aLsb, gLsb: inc.gLsb, missed: inc.missed, n: inc.n,
      at: new Date().toISOString(), fw: ($('fw') || {}).textContent || '', data };
    take.id = await addTake(take);
    sp.takes.push(take); sp.view = take;
    klog(`rec: ${it.label} #${count(it.label)}, ${(inc.n / inc.hz).toFixed(2)}s`);
    if (it.group === 'calibrate' && count(it.label) >= it.goal) nextLabel(); else { renderAll(); sendLabel(); }
  }
  window.spellsOnConnect = () => { if (sp.label && $('spells') && !$('spells').hidden && $('spells').offsetParent) sendLabel(); };

  // ── drawing: the how-to, the take's six channels, and the stroke from the gyro ──
  const PATHS = {
    circle: t => [Math.cos(-Math.PI / 2 + t * 2 * Math.PI), Math.sin(-Math.PI / 2 + t * 2 * Math.PI)],
    zigzag: t => { const P = [[-1, .6], [-.67, -.6], [-.33, .6], [0, -.6], [.33, .6], [.67, -.6], [1, .6]], f = t * 6, i = Math.min(5, f | 0), u = f - i; return [P[i][0] + (P[i + 1][0] - P[i][0]) * u, P[i][1] + (P[i + 1][1] - P[i][1]) * u]; },
    flick: t => { const e = 1 - (1 - t) ** 3; return [-.6 + 1.4 * e, 0]; },
    heart: t => { const a = t * 2 * Math.PI, x = -16 * Math.sin(a) ** 3, y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a); return [x / 17, -(y - 2) / 17]; },
  };
  function demo(now){
    const cv = $('spDemo'), c = cv.getContext('2d'), W = cv.width, H = cv.height, it = item(sp.label), acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#00e5ff';
    c.clearRect(0, 0, W, H);
    const f = it && PATHS[it.label];
    c.font = '11px ' + getComputedStyle(document.body).fontFamily; c.textAlign = 'center';
    if (!f) {
      c.fillStyle = '#6b7785';
      c.fillText(!it ? 'pick a label' : it.timed ? (sp.countdown ? '' : 'press record') : it.group === 'none' ? 'anything but a spell' : 'your gesture', W / 2, H / 2 + 4);
      if (sp.countdown) { c.fillStyle = acc; c.font = '700 44px ' + getComputedStyle(document.body).fontFamily; c.fillText(sp.countdown, W / 2, H / 2 + 16); }
      return;
    }
    const pt = t => { const [x, y] = f(t); return [W / 2 + x * W * .36, H / 2 + y * H * .36]; };
    c.strokeStyle = '#2a3542'; c.lineWidth = 2; c.beginPath(); for (let i = 0; i <= 80; i++) { const [x, y] = pt(i / 80); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
    const T = it.label === 'flick' ? 900 : 2200, u = (now % (T + 600)) / T;
    if (u <= 1) {
      c.strokeStyle = acc; c.lineWidth = 2.5; c.beginPath(); for (let i = 0; i <= 60; i++) { const [x, y] = pt(Math.min(u, i / 60 * u)); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
      const [x, y] = pt(u); c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill();
    }
    const [sx, sy] = pt(0); c.fillStyle = acc; c.beginPath(); c.arc(sx, sy, 3, 0, 7); c.fill(); c.fillStyle = '#6b7785'; c.fillText('start', sx, sy - 8);
  }
  function stroke(take){
    const d = take.data, n = take.n, k = 1 / take.gLsb / take.hz, nb = Math.min(20, n);
    let bx = 0, by = 0; for (let i = 0; i < nb; i++) { bx += d[i * 6 + 3]; by += d[i * 6 + 4]; } bx /= nb; by /= nb;
    const pts = []; let x = 0, y = 0;
    for (let i = 0; i < n; i++) { x += (d[i * 6 + 4] - by) * k; y += (d[i * 6 + 3] - bx) * k; pts.push([x, y]); }
    return pts;
  }
  function drawStroke(cv, take){
    const c = cv.getContext('2d'), W = cv.width, H = cv.height; c.clearRect(0, 0, W, H);
    if (!take) return;
    const p = stroke(take), xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    const mnx = Math.min(0, ...xs), mxx = Math.max(0, ...xs), mny = Math.min(0, ...ys), mxy = Math.max(0, ...ys), span = Math.max(mxx - mnx, mxy - mny, 8), s = (Math.min(W, H) - 16) / span;
    const cx = W / 2 - (mnx + mxx) / 2 * s, cy = H / 2 - (mny + mxy) / 2 * s, acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#00e5ff';
    c.lineWidth = Math.max(1.5, W / 90); c.lineCap = 'round';
    for (let i = 1; i < p.length; i++) { c.strokeStyle = `color-mix(in srgb, ${acc} ${20 + 80 * i / p.length}%, transparent)`; c.beginPath(); c.moveTo(cx + p[i - 1][0] * s, cy + p[i - 1][1] * s); c.lineTo(cx + p[i][0] * s, cy + p[i][1] * s); c.stroke(); }
    const l = p.at(-1); c.fillStyle = '#fff'; c.beginPath(); c.arc(cx + l[0] * s, cy + l[1] * s, Math.max(2.5, W / 50), 0, 7); c.fill();
  }
  function drawPlot(take){
    const cv = $('spPlot'), r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    cv.width = Math.max(300, r.width * dpr | 0); cv.height = 220 * dpr | 0;
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, half = H / 2;
    c.clearRect(0, 0, W, H); c.font = `${11 * dpr}px ` + getComputedStyle(document.body).fontFamily;
    c.strokeStyle = '#1b232d'; c.lineWidth = 1; [half / 2, half + half / 2].forEach(y => { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); });
    c.fillStyle = '#6b7785'; c.fillText('acc (g)', 6 * dpr, 13 * dpr); c.fillText('gyro (dps)', 6 * dpr, half + 13 * dpr);
    if (!take) { c.fillText('no take yet', W / 2 - 30 * dpr, half); return; }
    const d = take.data, n = take.n;
    let am = 1, gm = 50; for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) { am = Math.max(am, Math.abs(d[i * 6 + ch] / take.aLsb)); gm = Math.max(gm, Math.abs(d[i * 6 + 3 + ch] / take.gLsb)); }
    for (let ch = 0; ch < 6; ch++) {
      const g = ch >= 3, mid = g ? half + half / 2 : half / 2, sc = (half / 2 - 10 * dpr) / (g ? gm : am), lsb = g ? take.gLsb : take.aLsb;
      c.strokeStyle = COLS[ch]; c.lineWidth = 1.4 * dpr; c.beginPath();
      for (let i = 0; i < n; i++) { const x = i / (n - 1) * W, y = mid - d[i * 6 + ch] / lsb * sc; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    c.fillStyle = '#6b7785'; c.fillText(`±${am.toFixed(1)} g`, W - 60 * dpr, 13 * dpr); c.fillText(`±${gm | 0} dps`, W - 70 * dpr, half + 13 * dpr);
    NAMES.forEach((nm, i) => { c.fillStyle = COLS[i]; c.fillText(nm, 90 * dpr + i * 26 * dpr, 13 * dpr); });
  }

  // ── the panel ──
  function renderNow(){
    const it = item(sp.label), n = it ? count(it.label) : 0, conn = typeof rxChar !== 'undefined' && !!rxChar;
    $('spLabel').textContent = it ? it.label : 'pick something to record';
    $('spCount').textContent = it ? `${n} / ${it.goal}` : '';
    $('spCount').classList.toggle('done', !!it && n >= it.goal);
    $('spHint').textContent = it ? it.hint : 'choose a label in the plan on the left. start with 1 · calibrate.';
    const timed = !!(it && it.timed);
    $('spHowThumb').classList.toggle('hidden', timed || !it);
    $('spHowTimed').classList.toggle('hidden', !timed);
    $('spRec').classList.toggle('hidden', !timed);
    $('spRec').textContent = timed ? `record ${it.timed / 1000} s` : 'record';
    $('spRec').disabled = !conn || sp.recording || !!sp.countdown;
    $('spUndo').disabled = !it || !n;
    const st = $('spState');
    st.className = 'sp-state' + (sp.recording ? ' rec' : '');
    if (!conn) st.textContent = 'connect the charm (top right) to record. you can still look through your takes.';
    else if (sp.countdown) st.textContent = `put it down... ${sp.countdown}`;
    else if (sp.recording) st.textContent = `● recording ${((performance.now() - sp.recAt) / 1000).toFixed(1)} s` + (sp.timedUntil ? ' (don\'t touch it)' : ' — let go to stop');
    else if (sp.incoming) st.textContent = 'receiving the take...';
    else if (it && n >= it.goal) st.textContent = 'done ✓ — press next (enter) or keep adding takes.';
    else if (it) st.textContent = timed ? 'ready. press record (or space).' : 'ready. hold your thumb on the charm\'s screen, draw, let go.';
    else st.textContent = '';
  }
  function renderTakes(){
    const box = $('spTakes'), list = sp.takes.filter(t => t.label === sp.label); box.innerHTML = '';
    $('spTakesFor').textContent = sp.label || '';
    if (!list.length) { box.innerHTML = '<p class="meta">no takes yet</p>'; return; }
    list.forEach((t, i) => {
      const el = document.createElement('div'); el.className = 'sp-take' + (t === sp.view ? ' on' : '');
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; drawStroke(cv, t);
      el.append(cv); el.insertAdjacentHTML('beforeend', `<span>#${i + 1} · ${(t.n / t.hz).toFixed(2)}s</span><small>${t.session}${t.missed ? ' · ' + t.missed + ' missed' : ''}</small>`);
      const x = document.createElement('button'); x.className = 'sp-x'; x.textContent = '×'; x.title = 'delete this take';
      x.onclick = async e => { e.stopPropagation(); await delTake(t.id); sp.takes = sp.takes.filter(q => q !== t); if (sp.view === t) sp.view = sp.takes.filter(q => q.label === sp.label).at(-1) || null; renderAll(); sendLabel(); };
      el.append(x); el.onclick = () => { sp.view = t; renderTakes(); renderView(); };
      box.append(el);
    });
  }
  function renderView(){
    const t = sp.view; drawPlot(t); drawStroke($('spStroke'), t);
    $('spTakeInfo').textContent = t ? `${t.label} · ${(t.n / t.hz).toFixed(2)} s · ${t.n} samples · ${t.trigger} · ${t.session}, ${t.posture} · ${new Date(t.at).toLocaleString()}${t.missed ? ' · ' + t.missed + ' samples missed' : ''}` : '';
  }
  function renderAll(){ renderPlan(); renderNow(); renderTakes(); renderView(); }

  // ── export / import ──
  function download(){
    const out = { format: 'larp-spells/1', exported: new Date().toISOString(),
      sensor: { chip: 'QMI8658', hz: 100, channels: NAMES, accel: '+-8 g, raw / aLsb = g', gyro: '+-2048 dps, raw / gLsb = dps', lowpass: '~30 Hz on chip', axes: 'sensor frame, see the calibrate takes' },
      takes: sp.takes.map(({ id, data, ...t }) => ({ ...t, data: Array.from(data) })) };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    a.download = `larp-spells-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function importFile(f){
    const j = JSON.parse(await f.text()); if (j.format !== 'larp-spells/1') throw new Error('Not a larp-spells file.');
    const have = new Set(sp.takes.map(t => t.at + t.label));
    let added = 0;
    for (const t of j.takes) { if (have.has(t.at + t.label)) continue; const take = { ...t, data: Int16Array.from(t.data) }; take.id = await addTake(take); sp.takes.push(take); added++; }
    const cust = new Set(customs()); j.takes.filter(t => t.group === 'custom').forEach(t => cust.add(t.label)); localStorage.setItem('sp_custom', JSON.stringify([...cust]));
    hud(`Imported ${added} take${added === 1 ? '' : 's'}`); renderAll();
  }

  // ── wiring ──
  $('spRec').onclick = () => timedTake();
  $('spNext').onclick = () => nextLabel();
  $('spUndo').onclick = async () => { const t = sp.takes.filter(q => q.label === sp.label).at(-1); if (!t) return; await delTake(t.id); sp.takes = sp.takes.filter(q => q !== t); sp.view = sp.takes.filter(q => q.label === sp.label).at(-1) || null; hud('Last take deleted'); renderAll(); sendLabel(); };
  $('spDownload').onclick = () => sp.takes.length ? download() : hud('No takes yet');
  $('spImport').onchange = e => { const f = e.target.files[0]; if (f) importFile(f).catch(err => hud(err.message)); e.target.value = ''; };
  $('spClear').onclick = async () => {
    if (!sp.takes.length) return;
    if ($('spClear').dataset.arm !== '1') { $('spClear').dataset.arm = '1'; $('spClear').textContent = `really delete all ${sp.takes.length}?`; setTimeout(() => { $('spClear').dataset.arm = ''; $('spClear').textContent = 'delete all'; }, 4000); return; }
    await clearAll(); sp.takes = []; sp.view = null; $('spClear').dataset.arm = ''; $('spClear').textContent = 'delete all'; hud('All takes deleted'); renderAll(); sendLabel();
  };
  $('spExit').onclick = () => { if (typeof rxChar !== 'undefined' && rxChar) write(packet(CMD.REC, [1])).catch(() => {}); setActiveMode(8); };
  ['spSession', 'spPosture'].forEach(id => seg(id, v => localStorage.setItem('sp_' + id, v)));
  ['spSession', 'spPosture'].forEach(id => { const v = localStorage.getItem('sp_' + id); if (v) { $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); $(id).value = v; } });
  $('spGrip').value = localStorage.getItem('sp_grip') || ''; $('spGrip').onchange = () => localStorage.setItem('sp_grip', $('spGrip').value);
  addEventListener('keydown', e => {
    if (!$('spells').offsetParent || e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); timedTake(); }
    else if (e.key === 'Enter') { e.preventDefault(); nextLabel(); }
    else if (e.key === 'Backspace') { e.preventDefault(); $('spUndo').click(); }
  });
  // send the label when the tab is opened, so the charm switches to its recorder
  document.querySelectorAll('.tab[data-tab="spells"]').forEach(t => t.addEventListener('click', () => sendLabel()));
  addEventListener('resize', () => renderView());
  (function loop(now){ if ($('spells').offsetParent) { demo(now); if (sp.recording || sp.countdown) renderNow(); } requestAnimationFrame(loop); })(0);

  loadAll().then(all => {
    sp.takes = (all || []).map(t => ({ ...t, data: t.data instanceof Int16Array ? t.data : Int16Array.from(t.data) }));
    const saved = localStorage.getItem('sp_label');
    sp.label = saved && item(saved) ? saved : null;
    sp.view = sp.takes.filter(t => t.label === sp.label).at(-1) || null;
    renderAll();
  }).catch(e => { console.warn(e); renderAll(); });

  // for the charm preview
  window.spellsView = () => { const it = item(sp.label); return { label: it ? it.label : '', hint: it ? it.hint : '', take: it ? count(it.label) : 0, goal: it ? it.goal : 0, recording: sp.recording, recAt: sp.recAt, timed: it && it.timed, last: sp.view, stroke: sp.view ? stroke(sp.view) : null }; };
})();
