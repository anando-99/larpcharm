// ─────────── Protocol (must match firmware 8.3+) ───────────
const SVC = '6e400001-c4a7-4d2e-9b3c-c4a2d7c0ffee';
const RX  = '6e400002-c4a7-4d2e-9b3c-c4a2d7c0ffee';
const ST  = '6e400003-c4a7-4d2e-9b3c-c4a2d7c0ffee';
// A tab left open (or a cached page) notices a newer build on GitHub Pages and reloads into it once.
const BUILD = (document.querySelector('meta[name="build"]') || {}).content || '';
if (/^https:/.test(location.protocol)) fetch(location.pathname + '?b=' + Date.now(), { cache: 'no-store' }).then(r => r.text()).then(t => {
  const m = t.match(/<meta name="build" content="([^"]+)"/);
  if (m && m[1] !== BUILD && !sessionStorage.getItem('o_build' + m[1])) { sessionStorage.setItem('o_build' + m[1], '1'); location.reload(); }
}).catch(() => {});
const CMD = {MODE:1, TEXT:2, TIME:3, NOWPLAYING:4, XFER_BEGIN:5, XFER_DATA:6, XFER_END:7, BRIGHT:8, PET:9, CARD:10, SETTINGS:11, PING:12, BUZZ:13, FEED:14, LOOK:18, TIMER:19, TOY:20, THEME:21, SKIN:22, EYES:23, TUNE:24, TORCH:25, SONG_LIST:26, SONG_DELETE:27, CC:30, WEATHER:31};
const MODE = {CLOCK:0, TEXT:1, PHOTO:2, MUSIC:4, PET:5, TOY:6, CARD:7, DECK:8, EYES:9, JUKE:10, TORCH:11, CHARGE:12, TERM:13, CLAUDE:14, WEATHER:15};
const THEMES = ['#00E5FF', '#FF2BD6', '#FFB000', '#39FF14', '#FF3B30', '#C8DCFF'];
const klog = m => { if (window.charmLog) window.charmLog(m); };       // lines for the preview's dmesg pane
const ui = window.ui = { mode: 8, bg: 9, face: 0, toy: 0, theme: 0, playing: false, artReady: false, expr: 255, torch: 0, jbSong: -1, jbQueue: 0, charging: false, bat: 76 };
const CHUNK = 495, WINDOW = 16;
const W = 240, H = 280;

const $ = id => document.getElementById(id);
const enc = new TextEncoder();
let device = null, rxChar = null, stChar = null, manualDisconnect = false;
let queue = Promise.resolve();
let state = { fsUsed: 0, fsTotal: 0 };

function hud(msg){ const t = $('hud'); t.textContent = msg; t.classList.add('on'); if (window.kickCharm) kickCharm(3); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200); }
const act = fn => async (...a) => { try { await fn(...a); } catch (e) { hud(e.message === 'not connected' ? 'Connect your Larp Charm first.' : e.message); } };

function enqueue(fn){ const p = queue.then(fn); queue = p.catch(() => {}); return p; }
function write(bytes){ return enqueue(async () => { if (!rxChar) throw new Error('not connected'); await rxChar.writeValueWithResponse(bytes); }); }

const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const i16 = v => [v & 255, (v >> 8) & 255];
const hexRgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const rgb565 = h => { const [r,g,b] = hexRgb(h); const v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3); return [v >> 8, v & 255]; };
const ascii = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E\n]/g, '?');
function packet(cmd, header = [], str = ''){ const s = enc.encode(str); const out = new Uint8Array(1 + header.length + s.length); out[0] = cmd; out.set(header, 1); out.set(s, 1 + header.length); return out; }
const fmtBytes = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fmtTime = s => { s = Math.max(0, Math.round(s)); return s >= 60 ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s' : s + ' s'; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────── Connection ───────────
if (!navigator.bluetooth) $('noBle').style.display = 'block';

async function connect(){
  if (device && device.gatt.connected) { manualDisconnect = true; device.gatt.disconnect(); return; }
  try {
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SVC] }] });
    device.addEventListener('gattserverdisconnected', onDisconnected);
    manualDisconnect = false;
    await connectGatt();
  } catch (e) { if (e.name !== 'NotFoundError') hud(e.message); }
}
$('connectBtn').onclick = connect;

async function connectGatt(){
  $('connText').textContent = 'Connecting…';
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService(SVC);
  rxChar = await svc.getCharacteristic(RX);
  stChar = await svc.getCharacteristic(ST);
  await stChar.startNotifications();
  stChar.addEventListener('characteristicvaluechanged', e => onStatus(new TextDecoder().decode(e.target.value)));
  document.body.classList.add('connected');
  $('dot').classList.add('on');
  $('connText').textContent = device.name || 'Larp Charm';
  $('connectBtn').textContent = 'Disconnect';
  await syncTime();
  await write(packet(CMD.PING));
  await refreshMySongs();
  ccResync(); ccSetRemote(); wxSend();
  hud('Connected to ' + (device.name || 'Larp Charm'));
  klog('ble: link up');
  if (spotifyToken()) startSpotifyLoop();
}

async function onDisconnected(){
  setTimeout(ccSetRemote, 0);
  klog('ble: link down');
  rxChar = stChar = null;
  document.body.classList.remove('connected');
  $('dot').classList.remove('on');
  $('connText').textContent = 'Not connected';
  $('connectBtn').textContent = 'Connect';
  $('bat').classList.remove('on');
  rejectWaiters(new Error('Disconnected'));
  if (manualDisconnect || !device) return;
  for (let i = 0; i < 5; i++) {
    await sleep(1500 * (i + 1));
    try { await connectGatt(); return; } catch (_) {}
  }
}

// ─────────── Notifications ───────────
let ackBytes = 0, ackWaiters = [], xferWaiter = null;
function rejectWaiters(err){ ackWaiters.forEach(w => w.reject(err)); ackWaiters = []; if (xferWaiter) { xferWaiter.reject(err); xferWaiter = null; } }

function onStatus(s){
  if (s.startsWith('ack=')) {
    ackBytes = +s.slice(4);
    ackWaiters = ackWaiters.filter(w => { if (ackBytes >= w.n) { w.resolve(); return false; } return true; });
    return;
  }
  if (s.startsWith('media=')) { mediaControl(s.slice(6)); return; }
  if (s.startsWith('cc=')) { ccFromCharm(s.slice(3)); return; }
  if (s.startsWith('song=')) { const p = s.slice(5).split(','); if (songCollect) songCollect.push({ id: +p[0], n: +p[1], name: p.slice(2).join(',') || 'Song' }); return; }
  const kv = Object.fromEntries(s.split(';').map(x => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; }));
  if (kv.b !== undefined) setBattery(+kv.b, kv.c === '1');
  if (kv.fw) $('fw').textContent = kv.fw;
  if (kv.m !== undefined) setActiveMode(+kv.m);
  if (kv.lk) { const [b, f] = kv.lk.split(',').map(Number); setLook(b, f, false); }
  if (kv.toy !== undefined) setToy(+kv.toy, false);
  if (kv.th !== undefined) setTheme(+kv.th, false);
  if (kv.st !== undefined) $('stepCount').textContent = (+kv.st).toLocaleString();
  if (kv.eye !== undefined) setExprUi(+kv.eye);
  if (kv.jb !== undefined) { ui.jbSong = +kv.jb; ui.jbQueue = +(kv.q || 0); renderSongs(); }
  if (kv.imu !== undefined) $('imuNote').classList.toggle('hidden', kv.imu === '1');
  if (kv.fs) { const [u, t] = kv.fs.split(',').map(Number); state.fsUsed = u; state.fsTotal = t; renderStorage(); }
  if (kv.songs === 'end' && songCollect) { mySongs = songCollect; songCollect = null; renderMySongs(); }
  if (kv.songs === 'changed') refreshMySongs();
  if (kv.art === 'need') { lastTrack = null; lastSent = 0; setTimeout(pollSpotify, 300); }   // the charm lost the cover (it restarted): send it again
  if (kv.xfer && xferWaiter) {
    const w = xferWaiter; xferWaiter = null;
    if (kv.xfer === 'ok') w.resolve();
    else w.reject(new Error({ full: 'The charm already has eight of your songs. Delete one first.', space: 'Not enough space on the charm.', nofs: 'Storage isn’t set up on the charm. Update its firmware.', format: 'That didn’t arrive intact. Try again.' }[kv.why] || 'Transfer failed. Try again.'));
  }
}

function setBattery(pct, chg){
  $('bat').classList.add('on');
  $('bat').classList.toggle('charging', chg);
  $('batPct').textContent = pct + '%';
  ui.bat = pct; ui.charging = chg;
}

function setActiveMode(m){ ui.mode = m; document.querySelectorAll('#modes .tile').forEach(b => b.classList.toggle('active', +b.dataset.m === m)); }

async function syncTime(){
  const epoch = Math.floor(Date.now() / 1000), tz = -new Date().getTimezoneOffset();
  await write(packet(CMD.TIME, [...u32(epoch), ...i16(tz)]));
  klog(`rtc: synced, utc${tz < 0 ? '-' : '+'}${Math.abs(tz) / 60 | 0}:${String(Math.abs(tz) % 60).padStart(2, '0')}`);
}

// ─────────── Controls ───────────
function seg(id, onChange){
  const el = $(id); el.value = el.querySelector('.on').dataset.v;
  el.querySelectorAll('button').forEach(b => b.onclick = () => {
    el.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); el.value = b.dataset.v; onChange && onChange(el.value);
  });
}
function setSeg(id, v){ const b = $(id).querySelector(`[data-v="${v}"]`); if (b) b.click(); }

document.querySelectorAll('.swatches').forEach(box => {
  const target = $(box.dataset.target);
  const pick = v => { target.value = v; box.querySelectorAll('.sw').forEach(s => s.classList.toggle('on', s.dataset.c === v)); localStorage.setItem('f_' + target.id, v); };
  box.dataset.colors.split(',').forEach(c => { const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.dataset.c = c; b.title = c; b.onclick = () => pick(c); box.appendChild(b); });
  const custom = document.createElement('label'); custom.className = 'sw-custom'; custom.title = 'Custom colour';
  const inp = document.createElement('input'); inp.type = 'color'; inp.oninput = () => pick(inp.value); custom.appendChild(inp); box.appendChild(custom);
  pick(localStorage.getItem('f_' + target.id) || target.value);
});

function rangeFill(el){ el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min || 1) * 100) + '%'); }
document.querySelectorAll('input[type=range]').forEach(r => { rangeFill(r); r.addEventListener('input', () => rangeFill(r)); });

const gotoMode = window.charmGoto = m => { setActiveMode(m); if (window.kickCharm) kickCharm(3); if (rxChar) write(packet(CMD.MODE, [m])).catch(() => {}); };
document.querySelectorAll('#modes .tile').forEach(b => b.onclick = () => gotoMode(+b.dataset.m));
setActiveMode(ui.mode);

// ─────────── Text ───────────
seg('txtStyle');
$('sendTxt').onclick = act(async () => {
  const t = ascii($('txt').value).slice(0, 300);
  await write(packet(CMD.TEXT, [+$('txtStyle').value, ...rgb565($('txtFg').value), ...rgb565($('txtBg').value)], t));
  setActiveMode(MODE.TEXT); hud('Message sent'); klog(`rx: motd, ${ascii($('txt').value).length} bytes`);
});

// ─────────── Images ───────────
function toRGB565(ctx, w, h){
  const d = ctx.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h * 2);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 2) {
    const v = ((d[i] & 0xF8) << 8) | ((d[i+1] & 0xFC) << 3) | (d[i+2] >> 3);
    out[j] = v & 255; out[j+1] = v >> 8;
  }
  return out;
}
function srcSize(img){ return [img.displayWidth || img.videoWidth || img.naturalWidth || img.width, img.displayHeight || img.videoHeight || img.naturalHeight || img.height]; }
function drawFitted(ctx, img, w, h, fit = 'cover', zoom = 1, bg = '#000'){
  const [iw, ih] = srcSize(img);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (!iw || !ih) return;
  const s = (fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih)) * zoom;
  const dw = iw * s, dh = ih * s;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
function loadImage(file){ return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Couldn’t open that image.')); img.src = URL.createObjectURL(file); }); }

// Windowed transfer: writes without response, waits for the charm to confirm every WINDOW chunks.
function waitAck(n, ms = 10000){
  if (ackBytes >= n) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const w = { n, resolve, reject };
    ackWaiters.push(w);
    setTimeout(() => { if (ackWaiters.includes(w)) { ackWaiters = ackWaiters.filter(x => x !== w); reject(new Error('The charm stopped responding. Move closer and try again.')); } }, ms);
  });
}
function sendBlob(kind, bytes, id, onProgress){
  return enqueue(async () => {
    if (!rxChar) throw new Error('not connected');
    ackBytes = 0;
    const done = new Promise((resolve, reject) => { xferWaiter = { resolve, reject }; });
    done.catch(() => {});
    await rxChar.writeValueWithResponse(packet(CMD.XFER_BEGIN, [kind, ...u32(bytes.length), ...u32(id >>> 0)]));
    await sleep(60);
    if (!xferWaiter) return done;   // rejected immediately (no space etc.)
    let noResp = typeof rxChar.writeValueWithoutResponse === 'function';
    const t0 = performance.now();
    let n = 0;
    for (let off = 0; off < bytes.length; off += CHUNK) {
      if (!xferWaiter) return done;
      const part = bytes.subarray(off, off + CHUNK);
      const pkt = new Uint8Array(part.length + 1); pkt[0] = CMD.XFER_DATA; pkt.set(part, 1);
      if (noResp) {
        try { await rxChar.writeValueWithoutResponse(pkt); }
        catch (_) { noResp = false; await rxChar.writeValueWithResponse(pkt); }
      } else await rxChar.writeValueWithResponse(pkt);
      const sent = Math.min(bytes.length, off + CHUNK);
      if (++n % WINDOW === 0) await waitAck(sent);
      if (onProgress) { const el = (performance.now() - t0) / 1000; onProgress(sent / bytes.length, el > 1 ? (bytes.length - sent) / (sent / el) : null); }
    }
    await waitAck(bytes.length);
    await rxChar.writeValueWithResponse(Uint8Array.of(CMD.XFER_END));
    setTimeout(() => { if (xferWaiter) { xferWaiter.reject(new Error('No reply from the charm.')); xferWaiter = null; } }, 15000);
    return done;
  });
}
function progress(id){
  const box = $(id), bar = box.querySelector('i'), txt = box.querySelector('p');
  return {
    show(msg){ box.classList.add('on'); bar.style.width = '0'; txt.textContent = msg || ''; },
    set(f, msg){ bar.style.width = (f * 100).toFixed(1) + '%'; if (msg !== undefined) txt.textContent = msg; },
    hide(delay = 1200){ setTimeout(() => box.classList.remove('on'), delay); }
  };
}

// Photo
let photoImg = null;
const pctx = $('photoCv').getContext('2d', { willReadFrequently: true });
function placeholder(ctx, w, h, label){
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0E0726'); g.addColorStop(1, '#21134F');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#A99BDB'; ctx.font = '500 15px ' + getComputedStyle(document.body).fontFamily; ctx.textAlign = 'center'; ctx.fillText(label, w / 2, h / 2);
}
placeholder(pctx, W, H, 'No photo');
function redrawPhoto(){ if (photoImg) drawFitted(pctx, photoImg, W, H, $('photoFit').value, $('photoZoom').value / 100); $('zoomVal').textContent = $('photoZoom').value + '%'; }
seg('photoFit', redrawPhoto);
$('photoZoom').addEventListener('input', redrawPhoto);
$('photoFile').onchange = act(async e => { if (!e.target.files[0]) return; photoImg = await loadImage(e.target.files[0]); redrawPhoto(); $('sendPhoto').disabled = false; });
$('sendPhoto').onclick = act(async () => {
  const pr = progress('photoProg'); pr.show('Sending…'); $('sendPhoto').disabled = true;
  try {
    await sendBlob(0, toRGB565(pctx, W, H), 0, (f, eta) => pr.set(f, eta != null ? `Sending… ${fmtTime(eta)} left` : 'Sending…'));
    pr.set(1, 'Saved on your charm.'); setActiveMode(MODE.PHOTO); klog('fs: photo.bin 131k');
  } catch (e) { pr.set(0, e.message); throw e; }
  finally { $('sendPhoto').disabled = false; pr.hide(2500); }
});


async function jpegBlob(canvas, q){ return new Promise(r => canvas.toBlob(r, 'image/jpeg', q)); }

function renderStorage(){
  if (!state.fsTotal) return;
  $('storageText').textContent = `${fmtBytes(state.fsUsed)} of ${fmtBytes(state.fsTotal)} used`;
  $('storageFree').textContent = `${fmtBytes(state.fsTotal - state.fsUsed)} free`;
  $('storageFill').style.width = (state.fsUsed / state.fsTotal * 100).toFixed(1) + '%';
}

// ─────────── Music ───────────
seg('musicSrc', v => { $('spotifyBox').classList.toggle('hidden', v !== 'spotify'); $('manualBox').classList.toggle('hidden', v !== 'manual'); });
// title 0x1F artist, then (from Spotify) 0x1F "volume,shuffle,repeat" 0x1F device name
function nowPlayingPacket(rgb, playing, posMs, durMs, title, artist, ex){
  let s = ascii(title).slice(0, 80) + '\x1F' + ascii(artist).slice(0, 60);
  if (ex) s += '\x1F' + `${ex.vol},${ex.shuffle ? 1 : 0},${ex.repeat}` + '\x1F' + ascii(ex.device || '').slice(0, 24);
  ui.np = { pos: posMs, dur: durMs, at: performance.now(), ...(ex || { vol: -1 }) };
  return packet(CMD.NOWPLAYING, [...rgb, playing ? 1 : 0, ...u32(posMs), ...u32(durMs)], s);
}
function vibeColor(ctx, w, h){
  const d = ctx.getImageData(0, 0, w, h).data; let r = 0, g = 0, b = 0, t = 0;
  for (let i = 0; i < d.length; i += 16) {
    const R = d[i], G = d[i+1], B = d[i+2], mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx ? (mx - mn) / mx : 0;
    const wgt = 0.05 + sat * sat * (mx / 255);
    r += R * wgt; g += G * wgt; b += B * wgt; t += wgt;
  }
  const c = [r / t, g / t, b / t], mx = Math.max(...c) || 1;
  return c.map(v => Math.round(Math.min(255, v * (220 / mx))));
}
const actx = $('artCv').getContext('2d', { willReadFrequently: true });
const AW = 280;      // the cover goes over square: the charm shrinks it to 120×120 for its player and crops it to 240×280 full screen
let manualArt = null;
async function artJpeg(){ return new Uint8Array(await (await jpegBlob($('artCv'), 0.82)).arrayBuffer()); }
const toHex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
$('mArtFile').onchange = act(async e => { if (!e.target.files[0]) return; manualArt = await loadImage(e.target.files[0]); drawFitted(actx, manualArt, AW, AW); ui.artReady = true; $('mColor').value = toHex(vibeColor(actx, AW, AW)); hud('Album art ready'); });
$('sendMusic').onclick = act(async () => {
  const [m, s] = $('mLen').value.split(':').map(Number);
  const dur = ((m || 0) * 60 + (s || 0)) * 1000;
  await write(nowPlayingPacket(hexRgb($('mColor').value), $('mPlaying').checked, 0, dur, $('mTitle').value || 'Untitled', $('mArtist').value));
  ui.playing = $('mPlaying').checked;
  if (manualArt) { drawFitted(actx, manualArt, AW, AW); ui.artReady = true; await sendBlob(3, await artJpeg(), 0); }
  await write(packet(CMD.MODE, [MODE.MUSIC])); setActiveMode(MODE.MUSIC); hud('Now playing sent');
});

const REDIRECT = location.origin + location.pathname;
$('redirUri').textContent = REDIRECT;
$('spClient').value = localStorage.getItem('sp_client') || '';
$('spClient').onchange = () => localStorage.setItem('sp_client', $('spClient').value.trim());
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function spotifyToken(){ return localStorage.getItem('sp_access'); }
$('spLogin').onclick = act(async () => {
  const client = $('spClient').value.trim(); if (!client) throw new Error('Paste your Spotify Client ID first.');
  localStorage.setItem('sp_client', client);
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  localStorage.setItem('sp_verifier', verifier);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  const q = new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: REDIRECT, scope: 'user-read-currently-playing user-read-playback-state user-modify-playback-state', code_challenge_method: 'S256', code_challenge: challenge });
  location.href = 'https://accounts.spotify.com/authorize?' + q;
});
$('spLogout').onclick = () => { ['sp_access', 'sp_refresh', 'sp_exp'].forEach(k => localStorage.removeItem(k)); $('spNow').style.display = 'none'; hud('Signed out of Spotify'); };
async function tokenRequest(params){
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error_description || 'Spotify sign-in failed');
  localStorage.setItem('sp_access', j.access_token);
  if (j.refresh_token) localStorage.setItem('sp_refresh', j.refresh_token);
  localStorage.setItem('sp_exp', Date.now() + (j.expires_in - 60) * 1000);
}
async function ensureToken(){
  if (Date.now() < +localStorage.getItem('sp_exp')) return true;
  const rt = localStorage.getItem('sp_refresh'); if (!rt) return false;
  await tokenRequest({ grant_type: 'refresh_token', refresh_token: rt, client_id: localStorage.getItem('sp_client') });
  return true;
}
(async () => {
  const code = new URLSearchParams(location.search).get('code');
  if (!code) return;
  try {
    await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: localStorage.getItem('sp_client'), code_verifier: localStorage.getItem('sp_verifier') });
    hud('Spotify connected. Now connect your charm.');
  } catch (e) { hud(e.message); }
  history.replaceState(null, '', REDIRECT);
})();
let spTimer = null, lastTrack = null, lastPlaying = null, lastSent = 0;
const REPEAT = { off: 0, context: 1, track: 2 };
function startSpotifyLoop(){ lastTrack = null; lastPlaying = null; clearInterval(spTimer); spTimer = setInterval(pollSpotify, 5000); pollSpotify(); }
async function pollSpotify(){
  if (!$('spLive').checked || !rxChar || document.hidden) return;
  try {
    if (!(await ensureToken())) return;
    const r = await fetch('https://api.spotify.com/v1/me/player', { headers: { Authorization: 'Bearer ' + spotifyToken() } });
    if (r.status === 204) return;
    if (r.status === 401) { localStorage.setItem('sp_exp', 0); return; }
    const j = await r.json(); const it = j.item; if (!it) return;
    const title = it.name, artist = (it.artists || []).map(a => a.name).join(', ');
    const dv = j.device || {}, ex = { vol: dv.volume_percent == null ? -1 : dv.volume_percent, shuffle: !!j.shuffle_state, repeat: REPEAT[j.repeat_state] || 0, device: dv.name || '' };
    const st = [j.is_playing, ex.vol, ex.shuffle, ex.repeat, ex.device].join('|');
    const changed = it.id !== lastTrack;
    if (!changed && st === lastPlaying && Date.now() - lastSent < 20000) return;
    let rgb = [244, 114, 182], artBytes = null;
    const art = it.album && it.album.images && (it.album.images.find(i => i.width <= 640) || it.album.images[0]);
    if (art) {
      try {
        const img = new Image(); img.crossOrigin = 'anonymous';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = art.url; });
        drawFitted(actx, img, AW, AW);
        ui.artReady = true;
        rgb = vibeColor(actx, AW, AW);
        $('mColor').value = toHex(rgb);
        if (changed) artBytes = await artJpeg();
        $('spArt').src = art.url;
      } catch (_) {}
    }
    await write(nowPlayingPacket(rgb, j.is_playing, j.progress_ms || 0, it.duration_ms || 0, title, artist, ex));
    if (artBytes) await sendBlob(3, artBytes, 0);
    lastTrack = it.id; lastPlaying = st; lastSent = Date.now(); ui.playing = j.is_playing;
    if ($('spTitle').textContent !== title) klog('np: ' + title);
    $('spNow').style.display = 'flex'; $('spTitle').textContent = title; $('spArtist').textContent = artist;
  } catch (e) { console.warn(e); }
}

// Play, pause, skip and volume, asked for by tapping the charm's music screen.
async function mediaControl(kind){
  try {
    if ($('musicSrc').value !== 'spotify' || !spotifyToken()) {
      if (kind !== 'toggle') { hud(kind.startsWith('vol') ? 'Volume from the charm needs Spotify.' : 'Skipping songs from the charm needs Spotify.'); return; }
      $('mPlaying').checked = !$('mPlaying').checked; ui.playing = $('mPlaying').checked;
      const [m, s] = $('mLen').value.split(':').map(Number);
      await write(nowPlayingPacket(hexRgb($('mColor').value), ui.playing, 0, ((m || 0) * 60 + (s || 0)) * 1000, $('mTitle').value || 'Untitled', $('mArtist').value));
      return;
    }
    if (!(await ensureToken())) { hud('Sign in with Spotify again.'); return; }
    if (kind === 'volup' || kind === 'voldown') {
      const np = ui.np || {}, v = Math.max(0, Math.min(100, (np.vol >= 0 ? np.vol : 50) + (kind === 'volup' ? 10 : -10)));
      const r = await fetch('https://api.spotify.com/v1/me/player/volume?volume_percent=' + v, { method: 'PUT', headers: { Authorization: 'Bearer ' + spotifyToken() } });
      if (r.ok) { np.vol = v; hud('Volume ' + v + '%'); }
      else if (r.status === 404) hud('Start a song on Spotify first.');
      else hud(r.status === 403 ? 'That device won’t let Spotify change its volume.' : 'Couldn’t change the volume.');
      lastSent = 0; lastPlaying = null; setTimeout(pollSpotify, 700);
      return;
    }
    const path = kind === 'next' ? 'next' : kind === 'prev' ? 'previous' : (ui.playing ? 'pause' : 'play');
    const r = await fetch('https://api.spotify.com/v1/me/player/' + path, { method: kind === 'toggle' ? 'PUT' : 'POST', headers: { Authorization: 'Bearer ' + spotifyToken() } });
    if (r.status === 401 || r.status === 403) {
      let reason = ''; try { reason = (await r.json()).error.reason || ''; } catch (_) {}
      hud(reason === 'PREMIUM_REQUIRED' ? 'Spotify only allows this with Premium.' : 'Sign out of Spotify here and sign in again to allow control from the charm.');
    } else if (r.status === 404) hud('Start a song on Spotify first.');
    else hud({ next: 'Next song', prev: 'Previous song', toggle: ui.playing ? 'Paused' : 'Playing' }[kind]);
    if (r.ok && kind === 'toggle') ui.playing = !ui.playing;
    lastSent = 0; lastPlaying = null;
    setTimeout(pollSpotify, 700);
  } catch (e) { console.warn(e); }
}

// ─────────── Pet / Card / NFC ───────────
seg('petSp');
$('sendPet').onclick = act(async () => { await write(packet(CMD.PET, [+$('petSp').value, ...hexRgb($('petCol').value)], ascii($('petName').value).slice(0, 12))); setActiveMode(MODE.PET); hud('Pet updated'); });
$('feedPet').onclick = act(async () => { await write(packet(CMD.FEED)); setActiveMode(MODE.PET); hud('Fed'); });
$('sendCard').onclick = act(async () => { await write(packet(CMD.CARD, hexRgb($('cAcc').value), ascii($('cName').value).slice(0, 20) + '\x1F' + ascii($('cSub').value).slice(0, 24))); setActiveMode(MODE.CARD); hud('Card shown'); });

$('nfcUrl').value = localStorage.getItem('nfc_url') || '';
$('writeNfc').onclick = act(async () => {
  if (!('NDEFReader' in window)) throw new Error('NFC writing needs Chrome on Android.');
  const url = $('nfcUrl').value.trim(); if (!/^https?:\/\//.test(url)) throw new Error('Enter a full link starting with https://');
  localStorage.setItem('nfc_url', url);
  hud('Hold the tag to the back of your phone…');
  await new NDEFReader().write({ records: [{ recordType: 'url', data: url }] });
  hud('Tag written');
});

// ─────────── Settings ───────────
let brightT;
function brightLabel(){ $('brightVal').textContent = Math.round($('bright').value / 255 * 100) + '%'; }
brightLabel();
$('bright').addEventListener('input', () => { brightLabel(); clearTimeout(brightT); brightT = setTimeout(() => write(packet(CMD.BRIGHT, [+$('bright').value])).catch(() => {}), 120); });
const OPT_IDS = ['swap', 'optSound', 'optShake', 'optChime', 'optFx', 'tiltX', 'tiltY', 'tiltSwap'];
OPT_IDS.forEach(id => { const v = localStorage.getItem('o_' + id); if (v !== null) $(id).checked = v === '1'; });
{ const v = localStorage.getItem('o_sleep'); if (v !== null) $('sleep').value = v; }
{ const v = localStorage.getItem('o_idle') ?? (localStorage.getItem('o_optEyesIdle') === '1' ? '1' : null); if (v !== null) $('idleKind').value = v; }
const sendSettings = act(async () => {
  OPT_IDS.forEach(id => localStorage.setItem('o_' + id, $(id).checked ? '1' : '0'));
  localStorage.setItem('o_sleep', $('sleep').value); localStorage.setItem('o_idle', $('idleKind').value);
  const flags = ($('optSound').checked ? 1 : 0) | ($('optShake').checked ? 2 : 0) | ($('optChime').checked ? 4 : 0) | ($('optFx').checked ? 8 : 0) | ($('idleKind').value === '1' ? 16 : 0);
  const tilt = ($('tiltX').checked ? 1 : 0) | ($('tiltY').checked ? 2 : 0) | ($('tiltSwap').checked ? 4 : 0);
  await write(packet(CMD.SETTINGS, [...i16(+$('sleep').value), $('swap').checked ? 1 : 0, flags, tilt, +$('idleKind').value]));
  hud('Saved');
});
$('sleep').onchange = sendSettings; $('idleKind').onchange = sendSettings; OPT_IDS.forEach(id => $(id).onchange = sendSettings);
$('syncTime').onclick = act(async () => { await syncTime(); hud('Time synced'); });
$('findMe').onclick = act(() => write(packet(CMD.BUZZ, [5])));

// ─────────── Remember inputs ───────────
['txt', 'mTitle', 'mArtist', 'petName', 'cName', 'cSub'].forEach(id => {
  const el = $(id), v = localStorage.getItem('f_' + id); if (v !== null) el.value = v;
  el.addEventListener('change', () => localStorage.setItem('f_' + id, el.value));
});
buildShow();

// ─────────── Colour theme ───────────
function setTheme(t, send = true){
  ui.theme = t = Math.max(0, Math.min(THEMES.length - 1, t | 0));
  document.documentElement.style.setProperty('--acc', THEMES[t]);
  document.querySelectorAll('#themes .thm').forEach(b => b.classList.toggle('on', +b.dataset.v === t));
  localStorage.setItem('o_theme', t);
  if (send) { if (window.kickCharm) kickCharm(3); klog('tty: theme ' + ['ice', 'neon', 'amber', 'phosphor', 'redline', 'ghost'][t]); if (rxChar) write(packet(CMD.THEME, [t])).catch(() => {}); }
}
document.querySelectorAll('#themes .thm').forEach(b => b.onclick = () => setTheme(+b.dataset.v));
setTheme(+(localStorage.getItem('o_theme') || 0), false);

// ─────────── Clock look ───────────
function setLook(bg, face, send = true){
  ui.bg = bg; ui.face = face;
  document.querySelectorAll('#bgs .bgt').forEach(b => b.classList.toggle('on', +b.dataset.v === bg));
  document.querySelectorAll('#faceSeg button').forEach(b => b.classList.toggle('on', +b.dataset.v === face));
  if (send) { if (ui.mode !== MODE.DECK) setActiveMode(MODE.CLOCK); if (window.kickCharm) kickCharm(2); if (rxChar) write(packet(CMD.LOOK, [bg, face])).catch(() => {}); }
}
document.querySelectorAll('#bgs .bgt').forEach(b => b.onclick = () => setLook(+b.dataset.v, ui.face));
document.querySelectorAll('#faceSeg button').forEach(b => b.onclick = () => { setActiveMode(MODE.CLOCK); setLook(ui.bg, +b.dataset.v); if (rxChar) write(packet(CMD.MODE, [MODE.CLOCK])).catch(() => {}); });

// ─────────── Toys ───────────
window.charmSetToy = k => setToy(k);
function setToy(k, send = true){
  if (k !== ui.toy && k >= 3 && window.toyPreviewNew) window.toyPreviewNew(k);
  ui.toy = k;
  document.querySelectorAll('#toySeg button').forEach(b => b.classList.toggle('on', +b.dataset.v === k));
  if (send) { setActiveMode(MODE.TOY); if (rxChar) write(packet(CMD.TOY, [k, 0])).catch(() => {}); }
}
document.querySelectorAll('#toySeg button').forEach(b => b.onclick = () => setToy(+b.dataset.v));
$('rollToy').onclick = act(async () => { if (ui.toy >= 3 && window.toyPreviewNew) window.toyPreviewNew(ui.toy); setActiveMode(MODE.TOY); await write(packet(CMD.TOY, [ui.toy, 1])); setActiveMode(MODE.TOY); hud(['Asking the oracle…', 'Rolling…', 'Flipping…', 'New game', 'Rock, paper, scissors…', 'Get ready…'][ui.toy] || 'Go'); });

// ─────────── Timer ───────────
const startTimer = act(async min => {
  if (!(min > 0) || min > 1080) throw new Error('Pick between 1 minute and 18 hours.');
  await write(packet(CMD.TIMER, i16(Math.round(min * 60)))); hud(`Timer set for ${min} min`); klog(`tmr: armed, ${min}m`);
});
document.querySelectorAll('#timerPresets button').forEach(b => b.onclick = () => startTimer(+b.dataset.min));
$('startTimer').onclick = () => startTimer(+$('timerMin').value);
$('cancelTimer').onclick = act(async () => { await write(packet(CMD.TIMER, [0, 0])); hud('Timer cancelled'); });


// ─────────── Eyes ───────────
function setExprUi(e){
  ui.expr = e;
  document.querySelectorAll('#exprs button').forEach(b => b.classList.toggle('on', +b.dataset.v === e));
}
document.querySelectorAll('#exprs button').forEach(b => b.onclick = () => {
  const e = +b.dataset.v;
  setExprUi(e); ui.exprAt = performance.now(); setActiveMode(MODE.EYES);
  if (rxChar) write(packet(CMD.EYES, [e])).catch(() => {});
});

// ─────────── Jukebox ───────────
const SONG_INFO = { 'Jingle Bells': 'Winter song, 1857', 'We Wish You a Merry Christmas': 'English carol', 'Deck the Halls': 'Welsh carol', 'Silent Night': 'Austrian carol, 1818',
  'O Christmas Tree': 'German carol', 'Joy to the World': 'Carol, 1839', 'Twinkle Twinkle': 'Nursery rhyme', 'Mary Had a Little Lamb': 'Nursery rhyme', 'Happy Birthday': 'Birthdays',
  'Row Row Row Your Boat': 'Round', 'London Bridge': 'Nursery rhyme', 'Old MacDonald': 'Nursery rhyme', 'Ode to Joy': 'Ninth Symphony', 'Fur Elise': 'Bagatelle in A minor',
  'Fifth Symphony': 'The famous four notes', 'Eine kleine Nachtmusik': 'Mozart', 'Hall of the Mountain King': 'Grieg', "Brahms' Lullaby": 'Brahms', 'Korobeiniki': 'Russian folk song',
  'Greensleeves': 'English folk song', 'Village Morning': 'Cosy waltz', 'Overworld Run': 'Upbeat adventure', "Hero's March": 'Fanfare', 'Save Point': 'Calm arpeggios',
  'Boss Battle': 'Fast and tense', 'Night Market': 'Laid back', 'Level Clear': 'Short jingle' };
let songCat = +(localStorage.getItem('o_songcat') || 0), mySongs = [], songCollect = null;
const songSecs = sg => sg.notes.filter((_, k) => k % 2).reduce((a, b) => a + b, 0) * 15 / sg.bpm;
function songRow(id, name, sub, onListen){
  const li = document.createElement('li'); li.dataset.id = id;
  const nm = document.createElement('span'); nm.textContent = name;
  const sm = document.createElement('small'); sm.textContent = sub; nm.append(sm); li.append(nm);
  if (onListen) { const listen = document.createElement('button'); listen.className = 'listen'; listen.textContent = 'Listen'; listen.onclick = () => onListen(listen); li.append(listen); }
  const play = document.createElement('button'); play.className = 'btn sm'; play.textContent = 'Play';
  play.onclick = act(async () => { await write(packet(CMD.TUNE, [1, id])); setActiveMode(MODE.JUKE); hud('Playing ' + name); });
  const add = document.createElement('button'); add.className = 'btn plain sm'; add.textContent = 'Queue';
  add.onclick = act(async () => { await write(packet(CMD.TUNE, [2, id])); hud(ui.jbSong >= 0 ? 'Added to the queue' : 'Playing ' + name); });
  li.append(play, add);
  return li;
}
function renderSongs(){
  const cats = window.SONG_CATS || [], seg = $('catSeg');
  if (!seg.children.length) cats.forEach((c, i) => { const b = document.createElement('button'); b.textContent = c; b.dataset.v = i; b.onclick = () => { songCat = i; localStorage.setItem('o_songcat', i); $('songList').innerHTML = ''; renderSongs(); }; seg.append(b); });
  [...seg.children].forEach(b => b.classList.toggle('on', +b.dataset.v === songCat));
  const ul = $('songList');
  if (!ul.children.length) (window.SONGS || []).forEach((sg, i) => { if (sg.cat === songCat) ul.append(songRow(i, sg.name, `${SONG_INFO[sg.name] || ''}, ${Math.round(songSecs(sg))} s`, btn => previewSong(sg, btn, i))); });
  document.querySelectorAll('#songList li, #mySongs li').forEach(li => li.classList.toggle('playing', +li.dataset.id === ui.jbSong));
  const name = ui.jbSong >= 100 ? (mySongs.find(m => m.id === ui.jbSong) || {}).name : ((window.SONGS || [])[ui.jbSong] || {}).name;
  $('jbNow').textContent = ui.jbSong >= 0 && name ? `▶ ${name}` + (ui.jbQueue ? ` · +${ui.jbQueue} queued` : '') : 'Nothing playing';
}
async function refreshMySongs(){ if (!rxChar) return; songCollect = []; await write(packet(CMD.SONG_LIST)); }
function renderMySongs(){
  const ul = $('mySongs'); ul.innerHTML = '';
  if (!mySongs.length) { ul.innerHTML = '<li class="empty">No songs yet</li>'; return; }
  for (const m of mySongs) {
    const li = songRow(m.id, m.name, `${m.n} notes, on the charm`);
    const del = document.createElement('button'); del.className = 'btn plain sm'; del.textContent = 'Delete';
    del.onclick = act(async () => { if (!confirm(`Delete “${m.name}” from your charm?`)) return; await write(packet(CMD.SONG_DELETE, [m.id])); });
    li.append(del); ul.append(li);
  }
  renderSongs();
}
renderSongs();
$('jbSkip').onclick = act(() => write(packet(CMD.TUNE, [3])));
$('jbStop').onclick = act(() => write(packet(CMD.TUNE, [0])));

// plays a melody in the browser with a square wave, close to how the buzzer sounds
let audio = null, previewing = null;
function previewSong(sg, btn, i = -1){
  if (previewing) { previewing.stop(); if (previewing.btn === btn) { previewing = null; return; } }
  audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  const g = audio.createGain(); g.gain.value = 0.04; g.connect(audio.destination);
  let t = audio.currentTime + 0.05; const oscs = [];
  for (let k = 0; k < sg.notes.length; k += 2) {
    const m = sg.notes[k], d = sg.notes[k + 1] * 15 / sg.bpm;
    if (m) { const o = audio.createOscillator(); o.type = 'square'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); o.connect(g); o.start(t); o.stop(t + d * 0.85); oscs.push(o); }
    t += d;
  }
  btn.classList.add('on'); btn.textContent = 'Stop';
  const done = () => { btn.classList.remove('on'); btn.textContent = 'Listen'; if (previewing && previewing.btn === btn) previewing = null; };
  const timer = setTimeout(done, (t - audio.currentTime) * 1000);
  previewing = { btn, stop(){ oscs.forEach(o => { try { o.stop(); } catch (_) {} }); clearTimeout(timer); done(); } };
  window.previewNotes = { song: i, start: audio.currentTime + 0.05, ctx: audio };
}

// ─────────── Torch ───────────
seg('torchSeg', v => { ui.torch = +v; if (ui.mode === MODE.TORCH && rxChar) write(packet(CMD.TORCH, [1, ui.torch])).catch(() => {}); });
$('torchOn').onclick = act(async () => { setActiveMode(MODE.TORCH); await write(packet(CMD.TORCH, [1, ui.torch])); });
$('torchOff').onclick = act(async () => { setActiveMode(MODE.DECK); await write(packet(CMD.TORCH, [0])); });

// ─────────── Your own songs: MIDI file → melody → charm ───────────
// Reads a standard MIDI file, keeps the highest note of the chosen part at each moment, and rounds to sixteenth notes.
function parseMidi(buf){
  const d = new DataView(buf); let p = 0;
  const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p++)); return s; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; }, u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 127); } while (b & 128); return v; };
  if (str(4) !== 'MThd') throw new Error('That isn’t a MIDI file.');
  const hl = u32(); u16(); const ntr = u16(), div = u16(); p = 8 + hl;
  if (div & 0x8000) throw new Error('This MIDI file uses a timing format the page can’t read.');
  let tempo = 500000; const parts = {}, names = {};
  for (let t = 0; t < ntr && p < d.byteLength; t++) {
    if (str(4) !== 'MTrk') break;
    const end = u32() + p; let tick = 0, run = 0; const on = {};
    while (p < end) {
      tick += vlq(); let st = d.getUint8(p);
      if (st < 0x80) st = run; else { p++; run = st; }
      if (st === 0xFF) { const ty = d.getUint8(p++), len = vlq();
        if (ty === 0x51 && tempo === 500000) tempo = (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2);
        if (ty === 0x03) { let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(d.getUint8(p + i)); names[t] = s.trim(); }
        p += len; continue; }
      if (st === 0xF0 || st === 0xF7) { p += vlq(); continue; }
      const ty = st & 0xF0, ch = st & 15, a1 = d.getUint8(p++), a2 = (ty === 0xC0 || ty === 0xD0) ? 0 : d.getUint8(p++);
      const key = t + ':' + ch;
      if (ty === 0x90 && a2 > 0) { on[ch + ':' + a1] = tick; (parts[key] = parts[key] || []).push({ t: tick, n: a1, e: tick + div }); }
      else if (ty === 0x80 || (ty === 0x90 && a2 === 0)) { const s = on[ch + ':' + a1]; if (s !== undefined) { const list = parts[key] || []; for (let i = list.length - 1; i >= 0; i--) if (list[i].n === a1 && list[i].t === s) { list[i].e = tick; break; } } }
    }
    p = end;
  }
  const list = Object.entries(parts).filter(([k]) => !k.endsWith(':9')).map(([k, notes]) => ({ key: k, notes, label: (names[k.split(':')[0]] || 'Part ' + (+k.split(':')[0] + 1)) + ` (${notes.length} notes)` }))
    .sort((x, y) => y.notes.length - x.notes.length);
  if (!list.length) throw new Error('No notes found in that file.');
  return { div, bpm: Math.round(60e6 / tempo), parts: list };
}
function melodyFrom(part, div, shift){
  const step = div / 4, byStart = new Map();
  for (const n of part.notes) { const q = Math.round(n.t / step); const o = byStart.get(q); if (!o || n.n > o.n) byStart.set(q, { n: n.n, e: Math.max(1, Math.round(n.e / step)) }); }
  const starts = [...byStart.keys()].sort((x, y) => x - y), out = [];
  let pitches = starts.map(s => byStart.get(s).n).sort((x, y) => x - y), med = pitches[pitches.length >> 1] || 72, auto = 0;
  while (med + auto < 66) auto += 12;
  if (starts[0] > 0) out.push(0, Math.min(255, starts[0]));
  for (let i = 0; i < starts.length && out.length < 3000; i++) {
    const s = starts[i], nx = i + 1 < starts.length ? starts[i + 1] : byStart.get(s).e, nt = byStart.get(s);
    const len = Math.max(1, Math.min(nx, Math.max(nt.e, s + 1)) - s);
    let m = nt.n + auto + shift; while (m > 100) m -= 12; while (m < 40) m += 12;
    out.push(m, Math.min(255, len));
    const gap = nx - s - len; if (gap > 0) out.push(0, Math.min(255, gap));
  }
  return out.slice(0, 3000);
}
let midi = null;
seg('midiOct');
$('midiFile').onchange = act(async e => {
  const f = e.target.files[0]; if (!f) return;
  midi = parseMidi(await f.arrayBuffer());
  $('midiName').value = f.name.replace(/\.[^.]+$/, '').slice(0, 23);
  $('midiPart').innerHTML = ''; midi.parts.forEach((pt, i) => { const o = document.createElement('option'); o.value = i; o.textContent = pt.label; $('midiPart').append(o); });
  $('midiInfo').textContent = `${midi.parts.length} part${midi.parts.length > 1 ? 's' : ''} · ${midi.bpm} bpm`;
  $('midiOpts').classList.remove('hidden');
});
function currentMidiSong(){
  if (!midi) throw new Error('Choose a MIDI file first.');
  const notes = melodyFrom(midi.parts[+$('midiPart').value || 0], midi.div, +$('midiOct').value);
  return { name: ascii($('midiName').value || 'My song').slice(0, 23), bpm: Math.max(30, Math.min(255, midi.bpm)), notes };
}
$('midiListen').onclick = act(async () => previewSong(currentMidiSong(), $('midiListen')));
$('midiSend').onclick = act(async () => {
  const sg = currentMidiSong();
  if (sg.notes.length / 2 > 1500) hud('That’s a long one, so only the first 1500 notes go to the charm.');
  const n = Math.min(1500, sg.notes.length / 2), out = new Uint8Array(32 + n * 2);
  out.set(enc.encode('LSNG'), 0); out[4] = 1; out[5] = sg.bpm; out[6] = n & 255; out[7] = n >> 8; out.set(enc.encode(sg.name), 8); out.set(sg.notes.slice(0, n * 2), 32);
  const pr = progress('midiProg'); pr.show('Sending…');
  try { await sendBlob(4, out, 0, f => pr.set(f, `Sending ${Math.round(f * 100)}%`)); pr.set(1, 'On your charm, in My songs.'); await refreshMySongs(); }
  catch (e) { pr.set(0, e.message); throw e; } finally { pr.hide(2500); }
});


// ─────────── Claude Code, through larp-bridge on this computer ───────────
// The bridge streams Claude Code's state (from its hooks and status line); this page relays it to the charm,
// and relays the charm's answers (allow / deny a permission, launch a preset) back to the bridge.
const CC_STATE = { offline: 0, ready: 1, thinking: 2, tool: 3, perm: 4, waiting: 5, done: 6 };
const CC_KIND = { user: 0, text: 1, tool: 2, res: 3, err: 4 };
const ccB = { url: localStorage.getItem('o_bridge') || 'http://127.0.0.1:7337', es: null, up: false, client: 0, st: null, sent: {} };
window.ccBridge = () => (ccB.up ? ccB.st : null);
const u16 = v => [v & 255, (v >> 8) & 255];
const cc1F = (...f) => f.map(x => ascii(String(x ?? '')).replace(/\x1F/g, ' ')).join('\x1F');
async function ccCmd(body){
  const r = await fetch(ccB.url + '/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
function ccSetRemote(){ if (ccB.up && ccB.client) ccCmd({ op: 'remote', client: ccB.client, on: !!rxChar }).catch(() => {}); }
function ccResync(){ ccB.sent = {}; if (ccB.st) ccRelay(ccB.st); }
let ccRetry = 0, ccRetryT = 0;
function ccConnectBridge(){
  clearTimeout(ccRetryT);
  if (ccB.es) ccB.es.close();
  localStorage.setItem('o_bridgeOn', '1');
  $('ccLinkBtn').classList.add('hidden');
  ccB.es = new EventSource(ccB.url + '/events');
  ccB.es.onopen = () => { ccB.up = true; ccRetry = 0; ccRender(); };
  ccB.es.onerror = () => {                                   // back off instead of hammering a bridge that isn't running
    if (ccB.up) klog('cc: bridge down');
    ccB.up = false; ccRender();
    ccB.es.close(); ccB.es = null;
    ccRetryT = setTimeout(ccConnectBridge, Math.min(60000, 3000 * 2 ** ccRetry++));
  };
  ccB.es.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'hello') { ccB.client = m.client; ccB.up = true; klog('cc: bridge linked'); ccSetRemote(); }
    else if (m.type === 'state') { m.at = performance.now(); ccB.st = m; ccRelay(m); ccRender(); }
    else if (m.type === 'permEnd' && rxChar) write(packet(CMD.CC, [4, ...u16(m.id), m.how === 'answered' ? 1 : 0])).catch(() => {});
  };
}
// send the charm what changed
function ccRelay(st){
  if (!rxChar) return;
  const S = ccB.sent, send = bytes => write(bytes).catch(() => {});
  const head = cc1F(st.session.project, st.session.model, st.tool, st.prompt), code = CC_STATE[st.state] ?? 0;
  const stKey = code + head;
  if (S.state !== stKey || Date.now() - (S.stateAt || 0) > 10000) { S.state = stKey; S.stateAt = Date.now(); send(packet(CMD.CC, [0, code, ...u16(Math.min(65535, st.elapsed | 0))], head)); }
  const last = st.log.length ? st.log[st.log.length - 1].seq : 0;
  if (S.seq === undefined || last < S.seq || (st.log.length && st.log[0].seq > S.seq + 1)) { send(packet(CMD.CC, [2])); S.seq = st.log.length ? st.log[0].seq - 1 : 0; }
  for (const l of st.log) if (l.seq > S.seq) { send(packet(CMD.CC, [1, CC_KIND[l.k] ?? 1], ascii(l.t))); S.seq = l.seq; }
  const s = st.status, statKey = JSON.stringify([s, st.session.version, st.session.model, st.session.name, st.session.cwd]);
  if (S.status !== statKey) { S.status = statKey; send(packet(CMD.CC, [6, Math.min(100, s.ctx | 0), ...u16(Math.round((s.cost || 0) * 100)), ...u16(Math.round((s.durationMs || 0) / 60000)), ...u16(s.linesAdded | 0), ...u16(s.linesRemoved | 0)], cc1F(st.session.version, st.session.model, st.session.name || st.session.id.slice(0, 8), st.session.cwd))); }
  const pre = cc1F(...st.presets);
  if (S.presets !== pre) { S.presets = pre; send(packet(CMD.CC, [5], pre)); }
  if (st.perm && S.perm !== st.perm.id) { S.perm = st.perm.id; send(packet(CMD.CC, [3, ...u16(st.perm.id)], cc1F(st.perm.tool, st.perm.detail, st.perm.project))); }
  if (!st.perm) S.perm = null;
}
// the charm answered: "allow:7", "deny:7" or "launch:2"
function ccFromCharm(v){
  const [what, n] = v.split(':');
  if (what === 'allow' || what === 'deny') ccCmd({ op: 'perm', id: +n, decision: what }).catch(() => hud('The bridge isn’t running.'));
  else if (what === 'launch') ccCmd({ op: 'launch', index: +n }).then(() => hud('Launching on this computer')).catch(() => hud('The bridge isn’t running.'));
}
// the claude panel on this page
function ccRender(){
  const st = ccB.st, el = $('ccLink');
  if (!el) return;
  el.textContent = ccB.up ? 'linked' : 'not running'; el.className = ccB.up ? 'ok' : 'bad';
  $('ccRemote').textContent = ccB.up ? (rxChar ? 'charm answers permission prompts' : 'connect the charm to answer prompts from it') : '';
  const live = ccB.up && st;
  $('ccSession').classList.toggle('hidden', !live);
  if (!live) return;
  const s = st.status, cost = '$' + (s.cost || 0).toFixed(2), mins = Math.round((s.durationMs || 0) / 60000);
  $('ccStateLine').textContent = st.state === 'tool' && st.tool ? `running ${st.tool}` : st.state;
  $('ccStateLine').dataset.state = st.state;
  $('ccFacts').textContent = [st.session.project || '-', st.session.model || '-', `ctx ${s.ctx | 0}%`, cost, `${mins}m`, `+${s.linesAdded | 0} -${s.linesRemoved | 0}`].join('  ·  ');
  const lines = st.log.slice(-14).map(l => (l.k === 'user' ? '> ' : l.k === 'tool' ? '● ' : l.k === 'res' ? '  ⎿ ' : l.k === 'err' ? '  ⎿ ! ' : '● ') + l.t);
  $('ccLog').textContent = lines.join('\n') || '(nothing yet)';
  $('ccPerm').classList.toggle('hidden', !st.perm);
  if (st.perm) $('ccPermText').textContent = `${st.perm.tool}: ${st.perm.detail}`;
  const box = $('ccPresets');
  if (box.dataset.k !== st.presets.join('|')) {
    box.dataset.k = st.presets.join('|'); box.innerHTML = '';
    st.presets.forEach((n, i) => { const b = document.createElement('button'); b.className = 'btn plain sm'; b.textContent = n; b.onclick = act(async () => { await ccCmd({ op: 'launch', index: i }); hud('Launching ' + n); }); box.append(b); });
  }
}
$('ccAllow').onclick = act(async () => { if (ccB.st && ccB.st.perm) await ccCmd({ op: 'perm', id: ccB.st.perm.id, decision: 'allow' }); });
$('ccDeny').onclick = act(async () => { if (ccB.st && ccB.st.perm) await ccCmd({ op: 'perm', id: ccB.st.perm.id, decision: 'deny' }); });
$('ccUrl').value = ccB.url;
$('ccUrl').onchange = () => { ccB.url = $('ccUrl').value.trim().replace(/\/$/, ''); localStorage.setItem('o_bridge', ccB.url); ccConnectBridge(); };
$('ccLinkBtn').onclick = () => { ccRetry = 0; ccConnectBridge(); };
// link straight away when this page comes from the bridge itself, or after you've linked once
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || localStorage.getItem('o_bridgeOn') === '1') ccConnectBridge();
setInterval(() => { if (ccB.st && rxChar) ccRelay(ccB.st); }, 10000);

// ─────────── the command line at the bottom of the page ───────────
const SCREENS = { weather: 15, wx: 15, home: 8, deck: 8, clock: 0, msg: 1, message: 1, photo: 2, img: 2, music: 4, np: 4, spotify: 4, pet: 5, dice: 6, rng: 6, id: 7, card: 7, eyes: 9, jukebox: 10, jbx: 10, torch: 11, tty: 13, term: 13, claude: 14, cc: 14 };
const THEME_NAMES = ['ice', 'neon', 'amber', 'phosphor', 'redline', 'ghost'];
const cmdIn = $('cmdIn'), cmdOut = $('cmdOut');
const cmdHist = []; let cmdPos = 0, cmdClearT = 0;
function say(...lines){
  cmdOut.textContent = (cmdOut.textContent ? cmdOut.textContent + '\n' : '') + lines.join('\n');
  cmdOut.textContent = cmdOut.textContent.split('\n').slice(-14).join('\n');
  cmdOut.scrollTop = cmdOut.scrollHeight;
  clearTimeout(cmdClearT); cmdClearT = setTimeout(() => { cmdOut.textContent = ''; }, 12000);
}
const need = () => { if (!rxChar) throw new Error('not connected. type: connect'); };
const COMMANDS = {
  help: ['list commands', () => say(...Object.entries(COMMANDS).map(([k, [d]]) => `  ${k.padEnd(10)} ${d}`), '  keys: / focuses here, 0-9 switch tabs')],
  connect: ['pair with the charm (bluetooth)', () => $('connectBtn').click()],
  open: ['open <screen>  e.g. open claude', a => { const m = SCREENS[a[0]]; if (m === undefined) return say(`screens: ${Object.keys(SCREENS).join(' ')}`); gotoMode(m); say(`opened ${a[0]}`); }],
  theme: ['theme <ice|neon|amber|phosphor|redline|ghost>', a => { const t = isNaN(a[0]) ? THEME_NAMES.indexOf(a[0]) : +a[0]; if (t < 0) return say(`themes: ${THEME_NAMES.join(' ')}`); setTheme(t); say(`theme ${THEME_NAMES[t]}`); }],
  msg: ['msg <text>  show a message', a => { if (!a.length) return say('usage: msg <text>'); need(); $('txt').value = a.join(' '); $('sendTxt').click(); say('sent'); }],
  bright: ['bright <0-100>', a => { const v = Math.max(3, Math.min(100, +a[0] || 0)); $('bright').value = Math.round(v * 2.55); $('bright').dispatchEvent(new Event('input')); say(`brightness ${v}%`); }],
  timer: ['timer <minutes|off>', a => { need(); if (a[0] === 'off') { $('cancelTimer').click(); return say('timer off'); } startTimer(+a[0]); say(`timer ${+a[0]}m`); }],
  idle: ['idle <off|eyes|tty|claude>  what shows when idle', a => { const v = { off: 0, eyes: 1, tty: 2, term: 2, claude: 3 }[a[0]]; if (v === undefined) return say('usage: idle <off|eyes|tty|claude>'); $('idleKind').value = v; sendSettings(); say(`idle screen: ${a[0]}`); }],
  beep: ['make the charm beep', () => { need(); $('findMe').click(); say('beep'); }],
  sync: ['sync the clock', () => { need(); $('syncTime').click(); say('time synced'); }],
  roll: ['roll the dice / ask the oracle / new game', () => { need(); $('rollToy').click(); }],
  game: ['game <oracle|dice|coin|ttt|rps|reflex>', a => { const k = ['oracle', 'dice', 'coin', 'ttt', 'rps', 'reflex'].indexOf(a[0]); if (k < 0) return say('games: oracle dice coin ttt rps reflex'); setToy(k); gotoMode(MODE.TOY); say(`game: ${a[0]}`); }],
  torch: ['torch <on|off>', a => { need(); $(a[0] === 'off' ? 'torchOff' : 'torchOn').click(); }],
  tab: ['tab <name>  switch panel', a => { const t = document.querySelector(`.tab[data-tab="${a[0]}"]`) || [...document.querySelectorAll('.tab')].find(x => x.textContent === a[0]); if (!t) return say('tabs: ' + [...document.querySelectorAll('.tab')].map(x => x.textContent).join(' ')); t.click(); }],
  allow: ['allow the pending claude permission', async () => { if (!ccB.st || !ccB.st.perm) return say('nothing is waiting'); await ccCmd({ op: 'perm', id: ccB.st.perm.id, decision: 'allow' }); say('allowed'); }],
  deny: ['deny the pending claude permission', async () => { if (!ccB.st || !ccB.st.perm) return say('nothing is waiting'); await ccCmd({ op: 'perm', id: ccB.st.perm.id, decision: 'deny' }); say('denied'); }],
  launch: ['launch <n|name>  start a preset claude session', async a => {
    const p = (ccB.st && ccB.st.presets) || []; if (!ccB.up) return say('bridge not running: node larp-bridge/bridge.mjs');
    const i = isNaN(a[0]) ? p.findIndex(n => n.startsWith(a.join(' '))) : +a[0];
    if (!(i >= 0 && i < p.length)) return say(...p.map((n, k) => `  ${k}  ${n}`));
    await ccCmd({ op: 'launch', index: i }); say(`launching ${p[i]}`);
  }],
  weather: ['weather [city]  look up and show the weather', async a => {
    if (a.length) { const r = await wxGeocode(a.join(' ')); if (!r.length) return say(`no place called ${a.join(' ')}`); wxSetPlace(r[0]); }
    if (!wxS.place) return say('usage: weather <city>');
    await wxFetch(); if (rxChar) gotoMode(MODE.WEATHER); say(...$('wxOut').textContent.split('\n'));
  }],
  status: ['charm and claude status', () => {
    const st = ccB.st;
    say(`charm   ${rxChar ? 'connected' : 'not connected'}${rxChar ? `, ${ui.bat}%` : ''}`, `bridge  ${ccB.up ? 'linked' : 'not running'}`,
      ...(st && ccB.up ? [`claude  ${st.state}${st.tool ? ' ' + st.tool : ''} in ${st.session.project || '?'}`, `        ${st.session.model || ''}  ctx ${st.status.ctx | 0}%  $${(st.status.cost || 0).toFixed(2)}`] : []));
  }],
  clear: ['clear this output', () => { cmdOut.textContent = ''; }],
};
async function runCmd(line){
  const [c, ...a] = line.trim().split(/\s+/);
  if (!c) return;
  say(`larp> ${line}`);
  const f = COMMANDS[c.toLowerCase()];
  if (!f) return say(`${c}: command not found. try help`);
  try { await f[1](a.map((x, i) => (i === 0 && c !== 'msg' ? x.toLowerCase() : x))); } catch (e) { say(`error: ${e.message}`); }
}
cmdIn.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const v = cmdIn.value; cmdIn.value = ''; if (v.trim()) { cmdHist.push(v); cmdPos = cmdHist.length; runCmd(v); } }
  else if (e.key === 'ArrowUp') { if (cmdPos > 0) cmdIn.value = cmdHist[--cmdPos]; e.preventDefault(); }
  else if (e.key === 'ArrowDown') { cmdPos = Math.min(cmdHist.length, cmdPos + 1); cmdIn.value = cmdHist[cmdPos] || ''; e.preventDefault(); }
  else if (e.key === 'Escape') { cmdIn.blur(); cmdOut.textContent = ''; }
  else if (e.key === 'Tab') { const m = Object.keys(COMMANDS).find(k => k.startsWith(cmdIn.value.trim())); if (m) cmdIn.value = m + ' '; e.preventDefault(); }
});
addEventListener('keydown', e => { if (e.key === '/' && !e.target.closest('input,textarea,select')) { cmdIn.focus(); e.preventDefault(); } });
setInterval(() => {
  const d = new Date();
  $('cmdRight').textContent = `ble ${rxChar ? 'up' : 'down'} | bridge ${ccB.up ? 'up' : 'down'}${rxChar ? ` | bat ${ui.bat}%` : ''} | ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}, 1000);
window.ccAnswerFromPreview = allow => { if (ccB.st && ccB.st.perm) ccCmd({ op: 'perm', id: ccB.st.perm.id, decision: allow ? 'allow' : 'deny' }).catch(() => {}); };
window.ccLaunchFromPreview = i => ccCmd({ op: 'launch', index: i }).then(() => hud('Launching on this computer')).catch(() => {});

// ─────────── weather: Open-Meteo (free, no key), sent to the charm over Bluetooth ───────────
const WX_NAMES = ['clear', 'partly cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunderstorm'];
const wmo = c => c === 0 ? 0 : c <= 2 ? 1 : c === 3 ? 2 : c <= 48 ? 3 : c <= 57 ? 4 : c <= 67 ? 5 : c <= 77 ? 6 : c <= 82 ? 5 : c <= 86 ? 6 : 7;
const wxS = { place: (() => { try { return JSON.parse(localStorage.getItem('o_wxPlace')); } catch (_) { return null; } })(), fahr: localStorage.getItem('o_wxF') === '1', data: null };
window.wxData = () => wxS.data;
async function wxGeocode(q){
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=${encodeURIComponent(q)}`);
  const j = await r.json();
  return (j.results || []).map(p => ({ name: p.name, country: p.country_code || '', region: p.admin1 || '', lat: p.latitude, lon: p.longitude }));
}
function wxSetPlace(p){ wxS.place = p; localStorage.setItem('o_wxPlace', JSON.stringify(p)); $('wxResults').innerHTML = ''; $('wxQ').value = p.name; }
async function wxFetch(){
  const p = wxS.place; if (!p) return;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2&temperature_unit=${wxS.fahr ? 'fahrenheit' : 'celsius'}`;
  const j = await (await fetch(u)).json();
  const c = j.current, now = c.time.slice(0, 13);
  const start = j.hourly.time.findIndex(t => t.slice(0, 13) > now);
  const hours = [0, 1, 2, 3].map(i => start + i).filter(i => i >= 0 && i < j.hourly.time.length).map(i => ({ h: +j.hourly.time[i].slice(11, 13), cond: wmo(j.hourly.weather_code[i]), t: Math.round(j.hourly.temperature_2m[i]) }));
  wxS.data = { cond: wmo(c.weather_code), isDay: !!c.is_day, t: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]),
    hum: Math.round(c.relative_humidity_2m), wind: Math.round(c.wind_speed_10m), rain: j.daily.precipitation_probability_max[0] | 0, fahr: wxS.fahr, hours, place: p.name, at: Date.now(), localTime: c.time.slice(11, 16) };
  wxRender(); wxSend();
  klog(`wx: ${wxS.data.t}${wxS.fahr ? 'F' : 'C'} ${WX_NAMES[wxS.data.cond]}, ${p.name}`);
}
// The weather tab prints the same `curl wttr.in` report as the charm (drawn by charm.js), and animates it.
function wxRender(){
  const d = wxS.data, p = wxS.place;
  if (!d && p) { $('wxOut').textContent = `$ curl wttr.in/${p.name.toLowerCase().replace(/ /g, '+')}\nfetching...`; return; }
  if (window.wxReportHTML) $('wxOut').innerHTML = window.wxReportHTML(d, p && [p.name, p.country].filter(Boolean).join(', '));
  else $('wxOut').textContent = d ? `${d.place}: ${WX_NAMES[d.cond]}, ${d.t}` : 'no place yet. search for a city or use your location.';
}
window.wxRender = wxRender;
setInterval(() => { if ($('wxOut').offsetParent && !document.hidden) wxRender(); }, 250);
function wxSend(){
  const d = wxS.data; if (!d || !rxChar) return;
  const i8 = v => Math.max(-128, Math.min(127, v)) & 255;
  const head = [d.cond, d.isDay ? 1 : 0, i8(d.t), i8(d.feels), i8(d.hi), i8(d.lo), Math.min(255, d.hum), Math.min(255, d.wind), Math.min(100, d.rain), d.fahr ? 1 : 0, d.hours.length];
  d.hours.forEach(h => head.push(h.h, h.cond, i8(h.t)));
  write(packet(CMD.WEATHER, head, ascii(d.place).slice(0, 22))).catch(() => {});
}
$('wxFind').onclick = act(async () => {
  const q = $('wxQ').value.trim(); if (!q) return;
  const r = await wxGeocode(q), box = $('wxResults'); box.innerHTML = '';
  if (!r.length) { hud('No place by that name'); return; }
  if (r.length === 1) { wxSetPlace(r[0]); await wxFetch(); return; }
  r.forEach(p => { const b = document.createElement('button'); b.className = 'btn plain sm'; b.textContent = [p.name, p.region, p.country].filter(Boolean).join(', '); b.onclick = act(async () => { wxSetPlace(p); await wxFetch(); }); box.append(b); });
});
$('wxQ').addEventListener('keydown', e => { if (e.key === 'Enter') $('wxFind').click(); });
$('wxHere').onclick = act(() => new Promise((ok, bad) => navigator.geolocation.getCurrentPosition(async pos => {
  wxSetPlace({ name: 'my location', country: '', region: '', lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) });
  try { await wxFetch(); ok(); } catch (e) { bad(e); }
}, () => bad(new Error('Location not allowed')), { timeout: 10000 })));
$('wxUnit').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === (wxS.fahr ? 'f' : 'c')));
seg('wxUnit', v => { wxS.fahr = v === 'f'; localStorage.setItem('o_wxF', wxS.fahr ? '1' : '0'); wxFetch().catch(() => {}); });
$('wxShow').onclick = act(async () => { if (!wxS.data) await wxFetch(); wxSend(); gotoMode(MODE.WEATHER); });
$('wxRefresh').onclick = act(wxFetch);
wxRender();
if (wxS.place) wxFetch().catch(() => {});
setInterval(() => { if (wxS.place) wxFetch().catch(() => {}); }, 15 * 60000);
