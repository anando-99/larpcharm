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
    // sensor axes: +X screen top, +Y right edge, +Z into the screen (the calibrate takes); the back of the charm
    // swings left as it turns about +X and up as it turns about +Y
    for (let i = 0; i < n; i++) { x -= (d[i * 6 + 3] - bx) * k; y -= (d[i * 6 + 4] - by) * k; pts.push([x, y]); }
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
    c.fillStyle = '#6b7785'; c.textAlign = 'right'; c.fillText(`±${am.toFixed(1)} g`, W - 6 * dpr, half - 6 * dpr); c.fillText(`±${gm | 0} dps`, W - 6 * dpr, H - 6 * dpr); c.textAlign = 'left';
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
      const pr = predict(t), odd = pr && t.group !== 'calibrate' && t.group !== 'custom' && (pr.label || 'none') !== t.label;
      el.append(cv); el.insertAdjacentHTML('beforeend', `<span>#${i + 1} · ${(t.n / t.hz).toFixed(2)}s</span><small>${t.session}${t.missed ? ' · ' + t.missed + ' missed' : ''}${odd ? ' · <span class="sp-model bad">model: ' + (pr.label || 'no match') + '</span>' : ''}</small>`);
      const x = document.createElement('button'); x.className = 'sp-x'; x.textContent = '×'; x.title = 'delete this take';
      x.onclick = async e => { e.stopPropagation(); await delTake(t.id); sp.takes = sp.takes.filter(q => q !== t); if (sp.view === t) sp.view = sp.takes.filter(q => q.label === sp.label).at(-1) || null; renderAll(); sendLabel(); };
      el.append(x); el.onclick = () => { sp.view = t; renderTakes(); renderView(); };
      box.append(el);
    });
  }
  function renderView(){
    const t = sp.view; drawPlot(t); drawStroke($('spStroke'), t);
    $('spTakeInfo').innerHTML = t ? `${t.label} · ${(t.n / t.hz).toFixed(2)} s · ${t.n} samples · ${t.trigger} · ${t.session}, ${t.posture} · ${new Date(t.at).toLocaleString()}${t.missed ? ' · ' + t.missed + ' samples missed' : ''}${modelSays(t)}` : '';
  }
  function renderAll(){ renderPlan(); renderNow(); renderTakes(); renderView(); }
  // what the network (spells-net.js, the same one the charm runs) makes of a take
  const preds = new WeakMap();
  function predict(t){
    if (!window.SpellNet || !window.SPELL_MODEL || t.group === 'calibrate') return null;
    if (!preds.has(t)) { try { preds.set(t, SpellNet.classify(t.data, t.n, t.aLsb, t.gLsb)); } catch (e) { preds.set(t, null); } }
    return preds.get(t);
  }
  function modelSays(t){
    const p = predict(t); if (!p) return '';
    const odd = t.group !== 'custom' && (p.label || 'none') !== t.label;
    return ` · <span class="sp-model${odd ? ' bad' : ''}">model: ${p.label || 'no match'} (${p.scores[0].label} ${p.scores[0].sim.toFixed(2)})${odd ? ' — check this take' : ''}</span>`;
  }

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
    if (!$('spRecWrap').offsetParent || e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); timedTake(); }
    else if (e.key === 'Enter') { e.preventDefault(); nextLabel(); }
    else if (e.key === 'Backspace') { e.preventDefault(); $('spUndo').click(); }
  });
  // in record mode, opening the tab switches the charm to its recorder
  document.querySelectorAll('.tab[data-tab="spells"]').forEach(t => t.addEventListener('click', () => { if ($('spMode').value === 'rec') sendLabel(); }));
  addEventListener('resize', () => renderView());
  (function loop(now){ if ($('spRecWrap').offsetParent) { demo(now); if (sp.recording || sp.countdown) renderNow(); } requestAnimationFrame(loop); })(0);

  loadAll().then(all => {
    sp.takes = (all || []).map(t => ({ ...t, data: t.data instanceof Int16Array ? t.data : Int16Array.from(t.data) }));
    const saved = localStorage.getItem('sp_label');
    sp.label = saved && item(saved) ? saved : null;
    sp.view = sp.takes.filter(t => t.label === sp.label).at(-1) || null;
    renderAll();
  }).catch(e => { console.warn(e); renderAll(); });


  // ───────────── the spellbook: what each spell does, teaching new ones, the casts the charm reports ─────────────
  const ACTS = ['nothing', 'torch', 'new colour', 'next song', 'play/pause', 'eyes in love', 'weather', 'clock', 'pet', 'roll dice', 'claude', 'spotify'];
  const BOOK = [
    { label: 'circle', word: 'lumos', how: 'one loop, clockwise, from the top' },
    { label: 'zigzag', word: 'fulmen', how: 'three sharp peaks, left to right' },
    { label: 'flick', word: 'accio', how: 'a quick wrist snap to the right' },
    { label: 'heart', word: 'amor', how: 'one stroke: down the left, up the right' }];
  const book = sp.book = { base: [1, 2, 3, 5], custom: [], live: false, collecting: null, teach: null, casts: [], last: null };
  const conn = () => typeof rxChar !== 'undefined' && !!rxChar;
  const spellCmd = (bytes, txt) => conn() ? write(packet(CMD.SPELL, bytes, txt)).catch(e => hud(e.message)) : (hud('Connect the charm first.'), Promise.resolve());
  const actSelect = (val, onChange) => { const s = document.createElement('select'); ACTS.forEach((a, i) => s.add(new Option(a, i))); s.value = val; s.onchange = () => onChange(+s.value); return s; };

  function miniPath(cv, label){
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, f = PATHS[label];
    c.clearRect(0, 0, W, H); if (!f) return;
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#00e5ff';
    c.strokeStyle = acc; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i <= 60; i++) { const [x, y] = f(i / 60); const px = W / 2 + x * W * .34, py = H / 2 + y * H * .34; i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke(); const [sx, sy] = f(0); c.fillStyle = '#fff'; c.beginPath(); c.arc(W / 2 + sx * W * .34, H / 2 + sy * H * .34, 3, 0, 7); c.fill();
  }
  function renderBook(){
    const box = $('spBookList'); box.innerHTML = '';
    BOOK.forEach((b, i) => {
      const row = document.createElement('div'); row.className = 'sp-spell';
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; miniPath(cv, b.label);
      const info = document.createElement('div');
      info.innerHTML = `<div><b>${b.label}</b><span class="w">${b.word.toUpperCase()}!</span></div><div class="h">${b.how}</div>`;
      const ctl = document.createElement('div'); ctl.className = 'ctl'; ctl.append('does ', actSelect(book.base[i], a => { book.base[i] = a; spellCmd([0, i, a]); renderPreview(); }));
      info.append(ctl); row.append(cv, info); box.append(row);
    });
    book.custom.forEach(c => {
      const row = document.createElement('div'); row.className = 'sp-spell custom';
      const tag = document.createElement('div'); tag.style.cssText = 'width:64px;height:64px;display:grid;place-items:center;color:var(--ok);font-size:11px;border:1px dashed var(--line2)'; tag.textContent = 'taught';
      const info = document.createElement('div'); info.innerHTML = `<div><b>${esc(c.name)}</b><span class="w">${esc(c.name).toUpperCase()}!</span></div><div class="h">your own, learnt from 5 recordings · slot ${c.slot + 1}</div>`;
      const ctl = document.createElement('div'); ctl.className = 'ctl';
      const forget = document.createElement('button'); forget.className = 'btn plain sm sp-danger'; forget.textContent = 'forget';
      forget.onclick = () => { if (forget.dataset.arm !== '1') { forget.dataset.arm = '1'; forget.textContent = 'really forget?'; setTimeout(() => { forget.dataset.arm = ''; forget.textContent = 'forget'; }, 3000); return; } spellCmd([3, c.slot]); };
      ctl.append('does ', actSelect(c.act, a => { c.act = a; spellCmd([0, 10 + c.slot, a]); }), forget); info.append(ctl); row.append(tag, info); box.append(row);
    });
    $('spBookNote').textContent = conn() ? (book.live ? '' : 'reading the spellbook from the charm...') : 'connect the charm to change these.';
    $('spTeach').disabled = !conn() || !!book.teach || book.custom.length >= 6;
    $('spTeachStop').classList.toggle('hidden', !book.teach);
    const p = $('spTeachProg'); p.innerHTML = '';
    if (book.teach) { for (let i = 0; i < 5; i++) { const b = document.createElement('i'); b.className = i < book.teach.n ? 'on' : ''; p.append(b); } p.append(` draw "${book.teach.name}" on the charm: ${book.teach.n}/5`); }
    else if (book.custom.length >= 6) p.textContent = 'the charm holds 6 taught spells. forget one to teach another.';
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function renderCasts(){
    const box = $('spCastLog'); if (!book.casts.length) return;
    box.innerHTML = book.casts.map(k => `<div class="sp-cast"><div class="r"><b class="${k.label ? '' : 'no'}">${k.label ? esc(k.label) + ' · ' + k.sim.toFixed(2) : 'no match'}</b><small>${k.label ? '→ ' + ACTS[k.act] + ' · ' : ''}${k.power != null && k.label ? (k.power >= .8 ? 'overcharged' : 'power ' + Math.round(k.power * 100) + '%') + ' · ' : ''}${k.how === 'd' ? 'taught (dtw)' : 'cnn'} · ${k.ms} ms · ${k.time}</small></div>
      <div class="sp-bars">${k.top.map(([n, s]) => `<span>${esc(n)}</span><span>${s.toFixed(2)}</span><i style="width:${Math.max(0, s) * 100}%;opacity:${n === k.label ? 1 : .45}"></i>`).join('')}</div></div>`).join('');
  }
  function renderCard(){
    const M = window.SPELL_MODEL; if (!M) { $('spModelCard').textContent = 'model not loaded'; return; }
    const m = M.metrics || {}, pc = v => v == null ? '–' : (v * 100).toFixed(1) + '%';
    $('spModelCard').innerHTML = `<table>
      <tr><td>network</td><td>1D CNN, ${M.params.toLocaleString()} parameters</td></tr>
      <tr><td>input</td><td>6-axis IMU, 100 Hz → 7 × ${M.T}</td></tr>
      <tr><td>output</td><td>a ${M.emb}-number fingerprint</td></tr>
      <tr><td>on the charm</td><td>~70 ms, float32, ESP32-S3</td></tr>
      <tr><td>trained</td><td>${M.version}, ${m.takes || '–'} recorded takes</td></tr>
      <tr><td>built-in spells right (5-fold cv)</td><td>${pc(m.spells_right)}</td></tr>
      <tr><td>"not a spell" rejected</td><td>${pc(m.none_rejected)}</td></tr>
      <tr><td>taught spells recognised</td><td>${pc(m.teach && m.teach.taught)}</td></tr>
      <tr><td>other spells taken for a taught one</td><td>${pc(m.teach && m.teach.stole_spells)}</td></tr></table>
      <pre>imu 6×(1–6 s) ─ trim ─ resample ─▶ 7×128
  conv k5 32 ─ conv k5/2 64 ─ conv k3/2 64 ─ conv k3 64
  ─ mean over time ─ linear 32 ─ L2 norm ─▶ fingerprint
  built-in: nearest prototype (cos ≥ ${M.baseThr})
  taught:   DTW to your 5 takes, CNN can veto</pre>
      <p class="meta">how it was built: firmware/tools/spells and docs/spells.md in the repo.</p>`;
  }
  function renderPreview(){}

  const statusBook = s => {
    const k = s.slice(0, s.indexOf('=')), v = s.slice(s.indexOf('=') + 1);
    if (k === 'spb') { book.base = v.split(',').map(Number); book.collecting = []; return true; }
    if (k === 'spc') {
      if (v === 'end') { book.custom = book.collecting || []; book.collecting = null; book.live = true; renderBook(); return true; }
      const a = v.indexOf(','), b = v.indexOf(',', a + 1); (book.collecting || (book.collecting = [])).push({ slot: +v.slice(0, a), act: +v.slice(a + 1, b), name: v.slice(b + 1) }); return true;
    }
    if (k === 'teach') {
      const [slot, n] = v.split(',');
      if (n === 'done') { hud(`Learnt "${book.teach ? book.teach.name : 'it'}"`); book.teach = null; }
      else if (book.teach) book.teach.n = +n;
      renderBook(); return true;
    }
    if (k === 'cast') {
      const f = v.split(','), top = [];
      for (let i = 5; i + 1 < 11 && i + 1 < f.length; i += 2) if (f[i]) top.push([f[i], +f[i + 1]]);
      const c = { label: f[0] === '-' ? null : f[0], sim: +f[1], how: f[2], act: +f[3], ms: +f[4], top: top.slice(0, 3), time: new Date().toLocaleTimeString(), at: performance.now(),
        power: f.length > 11 ? +f[11] : null, mx: f.length > 13 ? +f[12] : null, my: f.length > 13 ? +f[13] : null };
      book.casts.unshift(c); book.casts.length = Math.min(book.casts.length, 20); book.last = c;
      renderCasts(); return true;
    }
    return false;
  };
  const prevStatus = window.spellsOnStatus;
  window.spellsOnStatus = s => { if (!statusBook(s)) prevStatus(s); };

  $('spTeachAct').innerHTML = ''; ACTS.forEach((a, i) => $('spTeachAct').add(new Option(a, i))); $('spTeachAct').value = 1;
  $('spTeach').onclick = () => {
    const name = ascii($('spTeachName').value.trim()).slice(0, 16); if (!name) { hud('Give the spell a name'); return; }
    const used = new Set(book.custom.map(c => c.slot)), slot = [0, 1, 2, 3, 4, 5].find(i => !used.has(i));
    if (slot === undefined) return;
    book.teach = { slot, n: 0, name }; spellCmd([1, slot, +$('spTeachAct').value], name); setActiveMode(17); renderBook();
  };
  $('spTeachStop').onclick = () => { book.teach = null; spellCmd([2]); renderBook(); };
  $('spCastOpen').onclick = () => { spellCmd([5]); setActiveMode(17); };
  seg('spMode', v => { $('spBook').classList.toggle('hidden', v !== 'book'); $('spRecWrap').classList.toggle('hidden', v !== 'rec'); localStorage.setItem('sp_mode', v); if (v === 'rec') { sendLabel(); renderView(); } });
  { const v = localStorage.getItem('sp_mode'); if (v === 'rec') { $('spMode').querySelector('[data-v="rec"]').click(); } }
  const prevConnect = window.spellsOnConnect;
  window.spellsOnConnect = () => { book.live = false; renderBook(); if ($('spMode').value === 'rec') prevConnect(); };
  renderBook(); renderCard();
  window.spellsCastView = () => ({ last: book.last, base: book.base, custom: book.custom, teach: book.teach, acts: ACTS, book: BOOK });
  // ───────────── the wand: views on the charm's spell screen, the air sketch, the constellation ─────────────
  const VIEWS = ['cast', 'knob', 'draw', 'map'];
  const wand = sp.wand = { view: 0, strokes: [], showTakes: false };
  window.spellsWandView = v => { wand.view = v; document.querySelectorAll('#spViews button').forEach(b => b.classList.toggle('on', +b.dataset.v === v)); };
  document.querySelectorAll('#spViews button').forEach(b => b.onclick = () => { spellCmd([7, +b.dataset.v]); setActiveMode(17); window.spellsWandView(+b.dataset.v); });

  // the sketch: strokes of [x, y] in the charm's 228 x 196 canvas
  const SKW = 228, SKH = 196;
  function drawSketchTo(cv, bg, lw){
    const c = cv.getContext('2d'), sx = cv.width / SKW, sy = cv.height / SKH, acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#00e5ff';
    c.fillStyle = bg; c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = acc; c.lineWidth = lw; c.lineCap = c.lineJoin = 'round';
    for (const s of wand.strokes) { if (s.length < 2) continue; c.beginPath(); s.forEach(([x, y], i) => i ? c.lineTo(x * sx, y * sy) : c.moveTo(x * sx, y * sy)); c.stroke(); }
  }
  function renderSketch(){
    drawSketchTo($('spSketch'), '#000', 4);
    const n = wand.strokes.length; $('spSketchInfo').textContent = n ? `${n} stroke${n === 1 ? '' : 's'}, ${wand.strokes.reduce((a, s) => a + s.length, 0)} points` : 'nothing drawn yet: the charm\'s draw view, hold your thumb and draw in the air';
  }
  $('spSketchPng').onclick = () => {
    if (!wand.strokes.length) return hud('Nothing drawn yet');
    const cv = document.createElement('canvas'); cv.width = SKW * 4; cv.height = SKH * 4; drawSketchTo(cv, '#05080b', 10);
    cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `air-sketch-${Date.now()}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); });
  };
  $('spSketchPhoto').onclick = act(async () => {
    if (!wand.strokes.length) throw new Error('Nothing drawn yet');
    if (!conn()) throw new Error('Connect the charm first.');
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = 280; const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#05080b'; c.fillRect(0, 0, 240, 280);
    const tmp = document.createElement('canvas'); tmp.width = SKW; tmp.height = SKH; drawSketchTo(tmp, '#05080b', 3); c.drawImage(tmp, 6, 42);
    await sendBlob(0, toRGB565(c, 240, 280), 0); setActiveMode(2); hud('Your sketch is the charm\'s photo now');
  });
  $('spSketchWipe').onclick = () => { wand.strokes = []; renderSketch(); spellCmd([6]); };

  // the constellation: the 32-number fingerprints projected to 2D the same way the charm does it
  const COLS5 = ['#00e5ff', '#ff6060', '#ffb040', '#f472b6', '#6e7887'];
  function mapProj(e){
    const M = window.SPELL_MODEL, mp = M && M.map; if (!mp) return null;
    if (!mp._mean) { const f = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Float32Array(u.buffer); }; mp._mean = f(mp.mean); mp._v = f(mp.v); }
    let z0 = 0, z1 = 0; for (let k = 0; k < M.emb; k++) { const d = e[k] - mp._mean[k]; z0 += d * mp._v[k]; z1 += d * mp._v[M.emb + k]; }
    return [(z0 - mp.box[0]) / (mp.box[2] - mp.box[0]), (z1 - mp.box[1]) / (mp.box[3] - mp.box[1])];
  }
  function renderMap(){
    const cv = $('spMap'), r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    cv.width = Math.max(300, r.width * dpr | 0); cv.height = Math.round(cv.width * 0.72);
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, M = window.SPELL_MODEL; c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    if (!M || !M.map) return;
    const X = x => 16 * dpr + Math.max(0, Math.min(1, x)) * (W - 32 * dpr), Y = y => H - 16 * dpr - Math.max(0, Math.min(1, y)) * (H - 32 * dpr);
    const box = M.map.box, nx = v => (v - box[0]) / (box[2] - box[0]), ny = v => (v - box[1]) / (box[3] - box[1]);
    c.font = `${11 * dpr}px ` + getComputedStyle(document.body).fontFamily;
    for (const [x, y, k] of M.map.pts) { c.fillStyle = COLS5[k]; c.globalAlpha = .55; c.beginPath(); c.arc(X(nx(x)), Y(ny(y)), 2.2 * dpr, 0, 7); c.fill(); }
    c.globalAlpha = 1;
    if (wand.showTakes) for (const t of sp.takes) { const p = predict(t); if (!p) continue; const q = mapProj(p.emb); if (!q) continue; c.strokeStyle = t.group === 'custom' ? '#39ff14' : COLS5[Math.max(0, M.classes.indexOf(t.label))]; c.lineWidth = dpr; c.beginPath(); c.arc(X(q[0]), Y(q[1]), 3.5 * dpr, 0, 7); c.stroke(); }
    const P = SpellNet.model().proto;
    M.classes.forEach((n, k) => { const q = mapProj(P.subarray(k * M.emb, (k + 1) * M.emb)); c.strokeStyle = c.fillStyle = COLS5[k]; c.lineWidth = 1.5 * dpr; c.beginPath(); c.arc(X(q[0]), Y(q[1]), 6 * dpr, 0, 7); c.stroke(); c.fillText(n, X(q[0]) + 9 * dpr, Y(q[1]) + 4 * dpr); });
    book.casts.slice().reverse().forEach((k, i, all) => {
      if (k.mx == null) return; const last = i === all.length - 1, x = X(k.mx), y = Y(k.my);
      c.fillStyle = k.label ? '#fff' : '#6b7785'; c.globalAlpha = last ? 1 : .35 + .5 * i / all.length; c.beginPath(); c.arc(x, y, (last ? 4.5 : 3) * dpr, 0, 7); c.fill();
      if (last) { c.strokeStyle = '#fff'; c.lineWidth = dpr; c.beginPath(); c.arc(x, y, 9 * dpr, 0, 7); c.stroke(); c.fillText(k.label || 'fizzle', x + 12 * dpr, y - 8 * dpr); }
    });
    c.globalAlpha = 1;
  }
  $('spMapTakes').onchange = () => { wand.showTakes = $('spMapTakes').checked; renderMap(); };

  const statusWand = s => {
    if (!s.startsWith('sk=')) return false;
    const v = s.slice(3);
    if (v === 'x') wand.strokes = [];
    else {
      const b = atob(v.slice(2)), pts = []; for (let i = 0; i + 1 < b.length; i += 2) pts.push([b.charCodeAt(i), b.charCodeAt(i + 1)]);
      if (v[0] === 's' || !wand.strokes.length) wand.strokes.push(pts); else wand.strokes.at(-1).push(...pts);
    }
    renderSketch(); return true;
  };
  const prevStatus2 = window.spellsOnStatus;
  window.spellsOnStatus = s => { if (!statusWand(s)) prevStatus2(s); if (s.startsWith('cast=')) renderMap(); };
  addEventListener('resize', () => { if ($('spBook').offsetParent) renderMap(); });
  document.querySelectorAll('.tab[data-tab="spells"]').forEach(t => t.addEventListener('click', () => setTimeout(renderMap, 50)));
  $('spMode').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setTimeout(renderMap, 50)));
  renderSketch(); setTimeout(renderMap, 100);
  window.spellsWandState = () => ({ view: wand.view, strokes: wand.strokes });


  // for the charm preview
  window.spellsView = () => { const it = item(sp.label); return { label: it ? it.label : '', hint: it ? it.hint : '', take: it ? count(it.label) : 0, goal: it ? it.goal : 0, recording: sp.recording, recAt: sp.recAt, timed: it && it.timed, last: sp.view, stroke: sp.view ? stroke(sp.view) : null }; };
})();
