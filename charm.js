// A working copy of the charm's screen. It draws the same deck and blocks as firmware 8.2,
// follows the controls on this page, and opens a block when you tap it.
(() => {
  const $ = id => document.getElementById(id);
  const cv = $('heroCv'), c = cv.getContext('2d'), rig = $('rig');
  const W = 240, H = 280, ui = window.ui;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MONO = 'ui-monospace, Menlo, Consolas, "Courier New", monospace';
  const THEMES = ['#00E5FF', '#FF2BD6', '#FFB000', '#39FF14', '#FF3B30', '#C8DCFF'];
  const VOID = '#03050c';
  const val = id => $(id).value;
  let frame = 0, glitch = 0, tiltX = 0, ACC = THEMES[0];

  // ── tilt toward the pointer (or with the phone) ──
  let rx = 0, ry = 0, trx = 0, tryy = 0;
  addEventListener('pointermove', e => {
    if (calm) return;
    const r = rig.getBoundingClientRect();
    tryy = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 420));
    trx = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 420));
  }, { passive: true });
  addEventListener('deviceorientation', e => { if (e.gamma != null && !calm) { tryy = Math.max(-1, Math.min(1, e.gamma / 40)); trx = Math.max(-1, Math.min(1, (e.beta - 45) / 40)); } });
  window.kickCharm = (n = 3) => { if (!calm) glitch = Math.max(glitch, Math.round(n)); };

  // ── drawing helpers, named after the firmware's ──
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mixk = (h, k) => { const [r, g, b] = rgb(h); return `rgb(${r * k | 0},${g * k | 0},${b * k | 0})`; };
  const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const dim = (x, y, w, h, a) => R(x, y, w, h, `rgba(0,0,0,${a})`);
  function T(s, x, y, size, col) {            // top-left anchored, 6 px per character like the charm's font
    s = String(s); c.font = `bold ${10 * size}px ${MONO}`; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = col;
    c.fillText(s, x, y - size, s.length * 6 * size);
  }
  const TC = (s, y, size, col) => T(s, (W - String(s).length * 6 * size) / 2, y, size, col);
  function line(x0, y0, x1, y1, col) { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x0 + .5, y0 + .5); c.lineTo(x1 + .5, y1 + .5); c.stroke(); }
  function circle(x, y, r, col, fill) { c.beginPath(); c.arc(x, y, r, 0, 7); if (fill) { c.fillStyle = col; c.fill(); } else { c.strokeStyle = col; c.lineWidth = 1; c.stroke(); } }
  function hudPanel(x, y, w, h, col, a) {
    if (a) dim(x, y, w, h, a);
    c.strokeStyle = col; c.lineWidth = 1; c.beginPath();
    c.moveTo(x + 6.5, y + .5); c.lineTo(x + w - .5, y + .5); c.lineTo(x + w - .5, y + h - 6.5); c.lineTo(x + w - 6.5, y + h - .5); c.lineTo(x + .5, y + h - .5); c.lineTo(x + .5, y + 6.5); c.closePath(); c.stroke();
  }
  function brackets(x, y, w, h, k, col) {
    c.strokeStyle = col; c.lineWidth = 1; c.beginPath();
    [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]].forEach(([px, py, sx, sy]) => { c.moveTo(px + .5 + sx * k, py + .5); c.lineTo(px + .5, py + .5); c.lineTo(px + .5, py + .5 + sy * k); });
    c.stroke();
  }
  const SEG7 = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F];
  function segDigit(x, y, w, h, t, d, on, off) {
    const m = d >= 0 && d <= 9 ? SEG7[d] : 0x40, vl = ((h - 3 * t) / 2 | 0) - 2, hl = w - 2 * t - 2, yg = y + t + vl + 2, yd = yg + t + vl + 2;
    R(x + t + 1, y, hl, t, m & 1 ? on : off); R(x + w - t, y + t + 1, t, vl, m & 2 ? on : off); R(x + w - t, yg + t + 1, t, vl, m & 4 ? on : off);
    R(x + t + 1, yd, hl, t, m & 8 ? on : off); R(x, yg + t + 1, t, vl, m & 16 ? on : off); R(x, y + t + 1, t, vl, m & 32 ? on : off); R(x + t + 1, yg, hl, t, m & 64 ? on : off);
  }
  function segTime(x, y, w, h, t, hh, mm, colon, on, off) {
    segDigit(x, y, w, h, t, hh / 10 | 0, on, off); segDigit(x + w + t, y, w, h, t, hh % 10, on, off);
    const cx = x + 2 * w + 2 * t;
    R(cx, y + (h / 3 | 0) - (t >> 1), t, t, colon ? on : off); R(cx, y + (2 * h / 3 | 0) - (t >> 1), t, t, colon ? on : off);
    segDigit(cx + 2 * t, y, w, h, t, mm / 10 | 0, on, off); segDigit(cx + 3 * t + w, y, w, h, t, mm % 10, on, off);
  }
  const pad = n => String(n).padStart(2, '0');
  function topBar(label, showTime) {
    dim(0, 0, W, 23, .5); T(label, 34, 9, 1, ACC);
    const d = new Date();
    if (showTime) T(pad(d.getHours()) + ':' + pad(d.getMinutes()), 105, 9, 1, '#fff');
    const on = document.body.classList.contains('connected');
    for (let i = 0; i < 3; i++) R(148 + i * 4, 15 - i * 2, 3, 2 + i * 2, on ? ACC : '#5a5a6e');
    const bt = (ui.bat || 76) + '%'; T(bt, 214 - bt.length * 6, 9, 1, ui.charging ? '#34c759' : ACC);
  }
  function marquee(s, chars, div) { if (s.length <= chars) return s; const loop = s + '   '; const off = (frame / div | 0) % loop.length; return (loop + loop).slice(off, off + chars); }
  const song = () => ({ title: $('spTitle').textContent || val('mTitle') || '', artist: $('spArtist').textContent || val('mArtist') || '' });
  const eq = (i, n) => ui.playing ? Math.abs(Math.sin(frame * 0.3 + i * 0.9) * Math.sin(i * 1.7 + frame * 0.11)) : 0.06;

  // ── backdrops ──
  const stars = Array.from({ length: 60 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }));
  const flakes = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.5 }));
  const cols = Array.from({ length: 24 }, () => ({ y: Math.random() * -30, v: 0.15 + Math.random() * 0.3 }));
  const nodes = Array.from({ length: 16 }, () => ({ x: 10 + Math.random() * 220, y: 10 + Math.random() * 260, vx: Math.random() * .8 - .4, vy: Math.random() * .8 - .4 }));
  function grad(a, b) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, a); g.addColorStop(1, b); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  function background(bg) {
    const t = frame;
    if (bg === 9) {
      R(0, 0, W, H, VOID);
      for (const n of nodes) { n.x += n.vx + tiltX * .4; n.y += n.vy; if (n.x < 4 || n.x > 235) { n.vx = -n.vx; n.x = Math.max(4, Math.min(235, n.x)); } if (n.y < 4 || n.y > 275) { n.vy = -n.vy; n.y = Math.max(4, Math.min(275, n.y)); } }
      for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) { const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d2 = dx * dx + dy * dy; if (d2 < 6400) { c.globalAlpha = 1 - d2 / 6400; line(nodes[i].x | 0, nodes[i].y | 0, nodes[j].x | 0, nodes[j].y | 0, ACC); } }
      c.globalAlpha = 1; for (const n of nodes) R((n.x | 0) - 1, (n.y | 0) - 1, 3, 3, ACC);
    } else if (bg === 10) {
      R(0, 0, W, H, '#000'); for (let y = 10; y < H; y += 20) for (let x = 10; x < W; x += 20) R(x, y, 1, 1, mixk(ACC, .45));
      const sy = (t * 2) % (H + 60) - 30; for (let k = 0; k < 24; k++) R(0, sy - k, W, 1, mixk(ACC, .37 - k * .015));
    } else if (bg === 1) {
      R(0, 0, W, H, '#040212');
      for (const s of stars) { s.z -= 0.012; if (s.z <= 0.05) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; } const b = 255 * (1 - s.z); R(120 + tiltX * 40 + s.x / s.z * 120, 140 + s.y / s.z * 140, s.z < 0.3 ? 2 : 1, s.z < 0.3 ? 2 : 1, `rgb(${b | 0},${b | 0},${Math.min(255, b + 60) | 0})`); }
    } else if (bg === 2) {
      const g = c.createLinearGradient(0, 0, 0, 170); g.addColorStop(0, '#14063c'); g.addColorStop(1, '#ff5aaa'); c.fillStyle = g; c.fillRect(0, 0, W, 170);
      const sg = c.createLinearGradient(0, 66, 0, 170); sg.addColorStop(0, '#ffe65a'); sg.addColorStop(1, '#ff508c'); circle(120, 118, 52, sg, true);
      for (let y = 124 + (t / 3 % 10); y < 170; y += 10) R(60, y, 120, 3, '#b03a8e');
      R(0, 170, W, 110, '#0e0428'); c.strokeStyle = '#5adcff'; c.lineWidth = 1; c.beginPath();
      for (let i = 0; i < 9; i++) { const k = (i + (t % 20) / 20) / 9, y = 170 + k * k * 110; c.moveTo(0, y); c.lineTo(W, y); }
      for (let i = -8; i <= 8; i++) { c.moveTo(120 + i * 14, 170); c.lineTo(120 + i * 90, H); }
      c.stroke(); R(0, 170, W, 1.5, '#f472b6');
    } else if (bg === 3) {
      R(0, 0, W, H, '#000'); c.font = `bold 10px ${MONO}`; c.textAlign = 'left'; c.textBaseline = 'top';
      cols.forEach((col, i) => { col.y += col.v; if (col.y > 40) { col.y = Math.random() * -12; col.v = 0.15 + Math.random() * 0.3; } for (let k = 0; k < 12; k++) { const row = (col.y | 0) - k; if (row < 0 || row > 28) continue; c.fillStyle = k === 0 ? '#c8ffdc' : `rgb(0,${220 - k * 18},${50 - k * 4})`; c.fillText(String.fromCharCode(33 + (i * 31 + row * 17 + (t >> 4)) % 90), i * 10, row * 10); } });
    } else if (bg === 4 || bg === 5) {
      R(0, 0, W, H, bg === 4 ? '#2e1065' : '#28083c');
      (bg === 4 ? ['#ff5ad2', '#5ad2ff', '#ffe14a', '#7be36b'] : ['#ff8c3c', '#ff3c78', '#ffe178', '#ff8c3c']).forEach((col, i) => {
        const x = 120 + Math.sin(t * 0.021 + i * 2.1) * 80, y = 140 + Math.cos(t * 0.017 + i * 1.3) * 100, r = bg === 4 ? 130 : 46 + i * 8;
        const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(bg === 4 ? 1 : 0.75, bg === 4 ? 'transparent' : col); g.addColorStop(1, 'transparent');
        c.globalAlpha = bg === 4 ? 0.75 : 1; c.fillStyle = g; c.fillRect(0, 0, W, H);
      });
      c.globalAlpha = 1;
    } else if (bg === 6) {
      grad('#08143c', '#285aa0');
      for (const f of flakes) { f.x += tiltX * f.r * 1.4 + (Math.random() - 0.5) * 0.6; f.y += f.r * 0.9; if (f.y > H) f.y -= H; if (f.x < 0) f.x += W; if (f.x > W) f.x -= W; R(f.x, f.y, f.r, f.r, '#fff'); }
    } else if (bg === 7) {
      const off = (t % 80) / 2; for (let ty = -1; ty < 8; ty++) for (let tx = -1; tx < 7; tx++) R(tx * 40 + off, ty * 40 + off, 40, 40, (tx + ty) & 1 ? '#ffaad7' : '#aae1ff');
    } else if (bg === 8) c.drawImage($('photoCv'), 0, 0);
    else {
      grad('#2e1065', '#0c4a6e');
      [[24, 52], [210, 70], [40, 230], [200, 214], [120, 40], [18, 150], [224, 150], [90, 250]].forEach(([x, y], i) => { const p = (t + i * 9) % 40, r = p < 20 ? p / 5 : (40 - p) / 5; if (r > 0.5) { R(x - r, y - 0.5, 2 * r, 1.5, '#c8b4ff'); R(x - 0.5, y - r, 1.5, 2 * r, '#c8b4ff'); } });
    }
  }

  // ── the deck: a live tmux session (same layout as the firmware's drawDeck) ──
  // The classic 5x7 GLCD font the charm draws with (Adafruit GFX, BSD licence), so the preview matches pixel for pixel.
  const FONT = Uint8Array.from(atob('AAAAAAA+W09bPj5rT2s+HD58PhwYPH48GBxXfVccHF5/XhwAGDwYAP/nw+f/ABgkGAD/59vn/zBIOgYOJil5KSZAfwUFB0B/BSU/WjznPFp/PhwcCAgcHD5/FCJ/IhRfXwBfXwYJfwF/AGaJlWpgYGBgYJSi/6KUCAR+BAgQIH4gEAgIKhwICBwqCAgeEBAQEAweDB4MMDg+ODAGDj4OBgAAAAAAAABfAAAABwAHABR/FH8UJCp/KhIjEwhkYjZJViBQAAgHAwAAHCJBAABBIhwAKhx/HCoICD4ICACAcDAACAgICAgAAGBgACAQCAQCPlFJRT4AQn9AAHJJSUlGIUFJTTMYFBJ/ECdFRUU5PEpJSTFBIREJBzZJSUk2RklJKR4AABQAAABANAAAAAgUIkEUFBQUFABBIhQIAgFZCQY+QV1ZTnwSERJ8f0lJSTY+QUFBIn9BQUE+f0lJSUF/CQkJAT5BQVFzfwgICH8AQX9BACBAQT8BfwgUIkF/QEBAQH8CHAJ/fwQIEH8+QUFBPn8JCQkGPkFRIV5/CRkpRiZJSUkyAwF/AQM/QEBAPx8gQCAfP0A4QD9jFAgUYwMEeAQDYVlJTUMAf0FBQQIECBAgAEFBQX8EAgECBEBAQEBAAAMHCAAgVFR4QH8oREQ4OERERCg4REQofzhUVFQYAAh+CQIYpKSceH8IBAR4AER9QAAgQEA9AH8QKEQAAEF/QAB8BHgEeHwIBAR4OERERDj8GCQkGBgkJBj8fAgEBAhIVFRUJAQEP0QkPEBAIHwcIEAgHDxAMEA8RCgQKERMkJCQfERkVExEAAg2QQAAAHcAAABBNggAAgECBAI8JiMmPB6hoWESOkBAIHo4VFRVWSFVVXlBIlRUeEIhVVR4QCBUVXlADB5SchI5VVVVWTlUVFRZOVVUVFgAAEV8QQACRX1CAAFFfEB9EhESffAoJSjwfFRVRQAgVFR8VHwKCX9JMklJSTI6REREOjJKSEgwOkFBIXo6QkAgeACdoKB9PUJCQj09QEBAPTwk/yQkSH5JQ2YrL/wvK/8JKfYgwIh+CQMgVFR5QQAARH1BMEhISjI4QEAiegB6CgpyfQ0ZMX0mKSkvKCYpKSkmMEhNQCA4CAgICAgICAg4LxDIrLovECg0+gAAewAACBQqFCIiFCoUCFUAVQBVqlWqVar/Vf9V/wAAAP8AEBAQ/wAUFBT/ABAQ/wD/EBDwEPAUFBT8ABQU9wD/AAD/AP8UFPQE/BQUFxAfEBAfEB8UFBQfABAQEPAAAAAAHxAQEBAfEBAQEPAQAAAA/xAQEBAQEBAQEP8QAAAA/xQAAP8A/wAAHxAXAAD8BPQUFBcQFxQU9AT0AAD/APcUFBQUFBQU9wD3FBQUFxQQEB8QHxQUFPQUEBDwEPAAAB8QHwAAAB8UAAAA/BQAAPAQ8BAQ/xD/FBQU/xQQEBAfAAAAAPAQ///////w8PDw8P///wAAAAAA//8PDw8PDzhERDhE/EpKSjR+AgIGBgJ+An4CY1VJQWM4REQ8BEB+IB4gBgJ+AgKZpeelmRwqSSocTHIBckwwSk1NMDBIeEgwvGJaRj0+SUlJAH4BAQF+KioqKipERF9EREBRSkRAQERKUUAAAP8BA+CA/wAACAhrawg2EjYkNgAGCQkGAAAYGAAAABAQADBA/wEBAB8BAR4AGR0XEgA8PDw8AAAAAAA='), ch => ch.charCodeAt(0));
  const atlas = {};
  function glyphs(col, size) {
    const k = col + size; if (atlas[k]) return atlas[k];
    const o = document.createElement('canvas'); o.width = 256 * 6 * size; o.height = 8 * size; const x = o.getContext('2d'); x.fillStyle = col;
    for (let ch = 0; ch < 256; ch++) for (let i = 0; i < 5; i++) { let l = FONT[ch * 5 + i]; for (let j = 0; j < 8; j++, l >>= 1) if (l & 1) x.fillRect((ch * 6 + i) * size, j * size, size, size); }
    return (atlas[k] = o);
  }
  function G(s, x, y, size, col) {                 // text exactly as the charm draws it
    const a = glyphs(col, size); s = String(s);
    for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i) & 255; c.drawImage(a, ch * 6 * size, 0, 6 * size, 8 * size, x + i * 6 * size, y, 6 * size, 8 * size); }
  }
  const TX = [2, 2, 152, 2, 92, 10, 41, 72, 104, 135, 167, 198], TY = [15, 81, 81, 141, 141, 258, 258, 258, 258, 258, 258, 258], TW = [236, 146, 86, 86, 146, 31, 31, 32, 31, 32, 31, 32], TH = [62, 56, 56, 54, 54, 22, 22, 22, 22, 22, 22, 22];
  const TMODE = [0, 4, 5, 6, 1, 2, 3, 7, 9, 10, 13, 14];
  const TCMD = ['date', 'np', 'ps pet', 'imu --scope', 'cat motd', 'img', 'sng', 'id', 'eye', 'jbx', 'tty', 'cc'];
  const TOPEN = ['clock', 'audio', 'pet', 'rng', 'motd', 'img', 'sing', 'id', 'eyes', 'jukebox', 'tty', 'claude'];
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const SPR = [
    ['K..........K', 'KK........KK', 'KBK......KBK', 'KBBKKKKKKBBK', 'KBBBBBBBBBBK', 'KBBKBBBBKBBK', 'KBBKBBBBKBBK', 'KBPBBKKBBPBK', 'KBBBBBBBBBBK', '.KBBBBBBBBK.', '..KBBBBBBK..', '...KKKKKK...'],
    ['...KKKKKK...', '..KBBBBBBK..', '.KBBBBBBBBK.', 'KBBBBBBBBBBK', 'KBBKBBBBKBBK', 'KBBKBBBBKBBK', 'KBBBBBBBBBBK', 'KBPBBBBBBPBK', 'KBBBBKKBBBBK', 'KBBBBBBBBBBK', 'KBKBBKKBBKBK', 'KK.KK..KK.KK'],
    ['.KKK....KKK.', 'KWWKK..KKWWK', 'KWKWKKKKWKWK', 'KBBBBBBBBBBK', 'KBBBBBBBBBBK', 'KBPBBBBBBPBK', 'KBBKBBBBKBBK', 'KBBBKKKKBBBK', 'KBBBBBBBBBBK', '.KBBBBBBBBK.', 'KBBK....KBBK', 'KKK......KKK']];
  function sprite(ox, oy, sc) {
    const col = val('petCol'), spr = SPR[+$('petSp').value] || SPR[0];
    spr.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') R(ox + x * sc, oy + y * sc, sc, sc, ch === 'K' ? '#1e1432' : ch === 'W' ? '#fff' : ch === 'P' ? '#f472b6' : col); }));
  }
  const TTY_TEXT = '#cdd6e0', TTY_DIM = '#606a78', TTY_BG = '#04060a';
  const boot = performance.now();
  const klog = [];
  const charmLog = window.charmLog = msg => { klog.push({ t: performance.now() - boot, s: String(msg).replace(/[^\x20-\x7e]/g, '?').slice(0, 31) }); if (klog.length > 8) klog.shift(); };
  ['kernel: larp-os 8.2 up', 'imu: qmi8658 online', 'fs: ffat mounted', 'rtc: clock ok'].forEach(charmLog);
  const typing = { cmd: '', at: 0, tile: -1 };
  const scope = new Array(74).fill(0); let scopeHead = 0, lastTilt = 0;
  const bar = (f, n, fill, head, empty) => { const k = Math.round(Math.max(0, Math.min(1, f)) * (n - 2)); let s = '['; for (let i = 0; i < n - 2; i++) s += i < k - 1 ? fill : i === k - 1 ? head : empty; return s + ']'; };
  const uptime = ms => { const s = ms / 1000 | 0; return s >= 86400 ? `${s / 86400 | 0}d${pad((s / 3600 | 0) % 24)}h` : s >= 3600 ? `${s / 3600 | 0}h${pad((s / 60 | 0) % 60)}m` : `${s / 60 | 0}m${pad(s % 60)}s`; };
  function pane(i, active) {
    const x = TX[i], y = TY[i];
    c.strokeStyle = active ? ACC : mixk(ACC, .2); c.lineWidth = 1; c.strokeRect(x + .5, y + .5, TW[i] - 1, TH[i] - 1);
    R(x + 6, y - 4, (TCMD[i].length + 4) * 6, 9, TTY_BG);
    G('$', x + 9, y - 3, 1, active ? ACC : TTY_DIM); G(TCMD[i], x + 21, y - 3, 1, active ? '#fff' : ACC);
  }
  function deckRun(i) { if (i < 0 || typing.tile >= 0) return; typing.cmd = 'open ' + TOPEN[i]; typing.at = performance.now(); typing.tile = i; }
  function deck() {
    const now = performance.now(), up = now - boot, d = new Date(), on = document.body.classList.contains('connected');
    if (typing.tile >= 0 && now - typing.at >= typing.cmd.length * 18 + 160) { const i = typing.tile; typing.tile = -1; typing.cmd = ''; charmLog('sh: open ' + TOPEN[i]); window.charmGoto(TMODE[i]); }
    const act = typing.tile, LOW = mixk(ACC, .2);
    R(0, 0, W, H, TTY_BG);
    // prompt
    G('larp@charm', 16, 3, 1, ACC); G(':~$', 76, 3, 1, TTY_TEXT);
    const typed = act >= 0 ? Math.min(typing.cmd.length, (now - typing.at) / 18 | 0) : 0;
    G(typing.cmd.slice(0, typed), 100, 3, 1, '#fff');
    if ((now / 450 | 0) % 2 || act >= 0) R(100 + typed * 6, 2, 6, 9, ACC);
    const bt = (ui.charging ? '+' : '') + (ui.bat || 76) + '%', bcol = ui.charging ? '#34c759' : TTY_TEXT;
    if (act < 0) G(bt, 224 - bt.length * 6, 3, 1, bcol);
    // $ date
    let x = TX[0], y = TY[0]; pane(0, act === 0);
    G(pad(d.getHours()) + ((now / 500 | 0) % 2 ? ':' : ' ') + pad(d.getMinutes()), x + 6, y + 11, 4, '#fff');
    G(':' + pad(d.getSeconds()), x + 128, y + 25, 2, ACC);
    const tz = -new Date().getTimezoneOffset(), tzs = (tz < 0 ? '-' : '+') + (Math.abs(tz) / 60 | 0) + ':' + pad(Math.abs(tz) % 60);
    G(`${DAYS[d.getDay()]} ${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}  utc${tzs}`.toLowerCase(), x + 6, y + 47, 1, TTY_DIM);
    const cx = x + 172;
    [['up', uptime(up), TTY_TEXT], ['bat', '3.98v', bcol], ['ble', on ? 'up' : 'down', on ? ACC : TTY_DIM], ['stp', (($('stepCount') || {}).textContent || '0').replace(/[^0-9]/g, '') || '0', TTY_TEXT]]
      .forEach(([k, v, col], i) => { G(k, cx, y + 10 + i * 11, 1, TTY_DIM); G(v, cx + 24, y + 10 + i * 11, 1, col); });
    // $ np
    x = TX[1]; y = TY[1]; pane(1, act === 1);
    const s = song();
    if (s.title) {
      G('>', x + 6, y + 9, 1, ACC); G(marquee(s.title, 21, 8), x + 16, y + 9, 1, '#fff'); G(marquee(s.artist, 21, 11), x + 16, y + 20, 1, ACC);
      const p = ((frame / 30) % 210) / 210; G(bar(p, 22, '=', '>', '-'), x + 6, y + 31, 1, TTY_TEXT);
      const sec = p * 210 | 0; G(`${sec / 60 | 0}:${pad(sec % 60)}/3:30`, x + 6, y + 42, 1, TTY_DIM);
      for (let i = 0; i < 8; i++) { const h = 1 + (eq(i) * 8 | 0); R(x + 92 + i * 6, y + 50 - h, 4, h, ACC); }
    } else { G('> idle', x + 6, y + 9, 1, TTY_TEXT); G('waiting on /dev/np', x + 6, y + 20, 1, TTY_DIM); G(bar(0, 22, '=', '>', '-'), x + 6, y + 31, 1, TTY_DIM); }
    // $ ps pet
    x = TX[2]; y = TY[2]; pane(2, act === 2);
    sprite(x + 7 + Math.round(tiltX * 5), y + 10 - (Math.abs(Math.sin(frame * 0.18)) * 3 | 0), 2);
    G((val('petName') || 'pet').slice(0, 7), x + 38, y + 10, 1, '#fff'); G(['cat', 'ghost', 'frog'][+$('petSp').value] || 'cat', x + 38, y + 21, 1, TTY_DIM);
    G('mood 82%', x + 6, y + 33, 1, TTY_TEXT); G(bar(0.82, 12, '#', '#', '.'), x + 6, y + 43, 1, ACC);
    // $ imu --scope: the pointer stands in for the motion sensor
    x = TX[3]; y = TY[3]; pane(3, act === 3);
    scope[scopeHead] = Math.max(-13, Math.min(13, Math.round((tiltX - lastTilt) * 260 + tiltX * 6))); lastTilt = tiltX; scopeHead = (scopeHead + 1) % 74;
    const sx = x + 6, sy = y + 22;
    for (let i = 0; i < 74; i += 4) R(sx + i, sy, 1, 1, LOW);
    for (let k = -12; k <= 12; k += 6) R(sx - 2, sy + k, 1, 1, LOW);
    c.strokeStyle = ACC; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i < 74; i++) { const yy = sy - scope[(scopeHead + i) % 74] + .5; i ? c.lineTo(sx + i + .5, yy) : c.moveTo(sx + .5, yy); }
    c.stroke();
    G('|a| ' + (1 + Math.abs(tiltX - lastTilt) * 4).toFixed(2) + 'g', x + 6, y + 41, 1, TTY_TEXT);
    // $ cat motd
    x = TX[4]; y = TY[4]; pane(4, act === 4);
    const msg = (val('txt') || ' ').replace(/\n/g, ' ');
    G(marquee(msg, 11, 5), x + 6, y + 12, 2, '#fff');
    const by = msg.length + ' bytes'; G(by, x + 6, y + 37, 1, TTY_DIM);
    if ((now / 450 | 0) % 2) R(x + 6 + (by.length + 1) * 6, y + 36, 6, 9, ACC);
    // $ dmesg -w
    c.strokeStyle = LOW; c.strokeRect(2.5, 199.5, 235, 54); R(8, 195, 78, 9, TTY_BG); G('$', 11, 196, 1, TTY_DIM); G('dmesg -w', 23, 196, 1, ACC);
    const shown = klog.slice(-4);
    shown.forEach((l, k) => {
      const ly = 206 + k * 11, newest = k === shown.length - 1, txt = newest ? l.s.slice(0, (now - boot - l.t) / 28 | 0) : l.s;
      G('[' + (l.t / 1000).toFixed(1).padStart(6) + ']', 7, ly, 1, TTY_DIM);
      const ci = txt.indexOf(':');
      if (ci > 0) { G(txt.slice(0, ci + 1), 61, ly, 1, ACC); G(txt.slice(ci + 1), 61 + (ci + 1) * 6, ly, 1, newest ? '#fff' : TTY_TEXT); } else G(txt, 61, ly, 1, newest ? '#fff' : TTY_TEXT);
    });
    // tmux status bar
    R(0, 258, W, 22, ACC);
    for (let i = 0; i < 7; i++) {
      const k = 5 + i, wx = TX[k], a = act === k;
      if (a) R(wx, 258, TW[k], 22, TTY_BG);
      if (i) R(wx, 261, 1, 16, a ? ACC : TTY_BG);
      G(TCMD[k], wx + ((TW[k] - TCMD[k].length * 6) / 2 | 0) + 1, 265, 1, a ? ACC : TTY_BG);
    }
  }

  // ── full-screen blocks ──
  const HN = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
  const bounce = { x: 40, y: 60, vx: 1.6, vy: 1.2, col: '#fff' };
  function clock() {
    background(ui.bg); topBar('//CHRONO', false);
    const d = new Date(), date = DAYS[d.getDay()] + ' ' + pad(d.getDate()) + ' ' + MON[d.getMonth()];
    if (ui.face === 1) {
      circle(120, 140, 98, ACC); circle(120, 140, 97, ACC);
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, r0 = i % 3 ? 88 : 82; line(120 + Math.sin(a) * r0, 140 - Math.cos(a) * r0, 120 + Math.sin(a) * 95, 140 - Math.cos(a) * 95, '#fff'); }
      const hand = (a, len, col, w) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(120, 140); c.lineTo(120 + Math.sin(a) * len, 140 - Math.cos(a) * len); c.stroke(); };
      hand((d.getHours() % 12 + d.getMinutes() / 60) * Math.PI / 6, 50, '#fff', 5); hand((d.getMinutes() + d.getSeconds() / 60) * Math.PI / 30, 76, ACC, 3); hand(d.getSeconds() * Math.PI / 30, 86, '#fff', 1);
      R(116, 136, 9, 9, ACC); TC(date, 248, 1, '#fff');
    } else if (ui.face === 2) {
      let m5 = Math.round(d.getMinutes() / 5) * 5, h = d.getHours(); const to = m5 > 30; if (to) h++; if (m5 === 60) m5 = 0;
      const k = to && m5 ? 60 - m5 : m5, pre = { 5: 'five', 10: 'ten', 15: 'quarter', 20: 'twenty', 25: 'twenty five', 30: 'half' }[k];
      if (!k) { TC(HN[h % 12], 108, 4, '#fff'); TC("o'clock", 152, 3, ACC); } else { TC(pre, 90, 3, ACC); TC(to ? 'to' : 'past', 126, 3, '#fff'); TC(HN[h % 12], 162, 4, '#fff'); }
    } else if (ui.face === 3) {
      const b = bounce; b.x += b.vx; b.y += b.vy; let hit = false;
      if (b.x < 0 || b.x > W - 154) { b.vx = -b.vx; hit = true; } if (b.y < 26 || b.y > H - 60) { b.vy = -b.vy; hit = true; }
      if (hit) b.col = `hsl(${Math.random() * 360 | 0} 100% 65%)`;
      T(pad(d.getHours()) + ':' + pad(d.getMinutes()), b.x, b.y, 5, b.col);
    } else {
      dim(8, 74, 224, 102, .5); brackets(8, 74, 224, 102, 12, ACC);
      segTime(16, 86, 42, 78, 8, d.getHours(), d.getMinutes(), d.getMilliseconds() < 500, '#fff', mixk(ACC, .16));
      TC(date, 188, 2, ACC); for (let i = 0; i < 60; i++) R(20 + (i * 200 / 60 | 0), 214, 2, 6, i <= d.getSeconds() ? '#fff' : mixk(ACC, .45));
    }
  }
  function layout(s) {                         // same wrapping as the charm: biggest size that fits
    for (let sz = 6; sz >= 1; sz--) {
      const max = 220 / (6 * sz) | 0, lines = [];
      for (const para of s.split('\n')) { let ln = ''; for (let w of para.split(' ')) { while (w.length > max) { if (ln) { lines.push(ln); ln = ''; } lines.push(w.slice(0, max)); w = w.slice(max); } if (!ln) ln = w; else if (ln.length + 1 + w.length <= max) ln += ' ' + w; else { lines.push(ln); ln = w; } } lines.push(ln); }
      if (lines.length * (8 * sz + 4) <= 200 || sz === 1) return { sz, lines };
    }
  }
  let typeAt = 0, lastStyle = -1;
  function text() {
    const fg = val('txtFg'), bg = val('txtBg'), style = +$('txtStyle').value, s = (val('txt') || ' ').slice(0, 300);
    if (style !== lastStyle) { lastStyle = style; typeAt = frame; }
    if (style === 3) {
      R(0, 0, W, H, '#000'); topBar('//MSG', true);
      const { sz, lines } = layout(s), lh = 8 * sz + 4; let y = (H - lines.length * lh) / 2 + 4, shown = (frame - typeAt) / 2 | 0, count = 0, cx = 10, cy = y;
      for (const ln of lines) { if (count >= shown) break; const part = ln.slice(0, shown - count); T(part, 10, y, sz, fg); cx = 10 + part.length * 6 * sz; cy = y; count += ln.length + 1; y += lh; }
      if (frame % 36 < 18) R(cx, cy, 5 * sz, 7 * sz, fg);
      if (shown > count + 90) typeAt = frame;
      return;
    }
    R(0, 0, W, H, bg);
    if (style === 1) { const one = s.replace(/\n/g, ' '), w = one.length * 36; T(one, W - (frame * 5) % (w + W), 116, 6, fg); return; }
    const { sz, lines } = layout(s), lh = 8 * sz + 4; let y = (H - lines.length * lh) / 2 + 4;
    lines.forEach((ln, li) => {
      const x = (W - ln.length * 6 * sz) / 2;
      if (style === 2) [...ln].forEach((ch, i) => T(ch, x + i * 6 * sz, y, sz, `hsl(${(i * 25 + li * 40 + frame * 6) % 360} 100% 60%)`));
      else T(ln, x, y, sz, fg);
      y += lh;
    });
  }
  function empty(label, big, l1) { R(0, 0, W, H, VOID); topBar(label, true); brackets(34, 84, 172, 100, 14, ACC); TC(big, 106, 2, ACC); TC(l1, 138, 1, '#fff'); TC('from the app', 152, 1, '#fff'); }
  const photo = () => $('sendPhoto').disabled && !ui.photoShown ? empty('//IMG', 'NO IMAGE', 'send a photo') : c.drawImage($('photoCv'), 0, 0);
  function music() {
    const s = song();
    if (ui.artReady) c.drawImage($('artCv'), 0, 0);
    else { R(0, 0, W, H, VOID); const beat = ui.playing ? Math.sin(frame * 0.35) * 3 + 3 : 1; for (let i = 0; i < 6; i++) circle(120, 108, 20 + i * 14 + beat, mixk(ACC, .8 - i * .12)); const a = frame * (ui.playing ? 0.08 : 0); line(120, 108, 120 + Math.cos(a) * 96, 108 + Math.sin(a) * 96, ACC); R(116, 104, 9, 9, ACC); }
    const g = c.createLinearGradient(0, 140, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.92)'); c.fillStyle = g; c.fillRect(0, 140, W, 140);
    topBar(ui.playing ? '//AUDIO' : '//PAUSED', true);
    const title = s.title || 'NO SIGNAL', tw = title.length * 12;
    c.save(); c.beginPath(); c.rect(0, 180, W, 30); c.clip();
    if (tw <= 212) T(title, 14, 190, 2, '#fff'); else { const o = (frame * 2) % (tw + 60); T(title, 14 - o, 190, 2, '#fff'); T(title, 14 - o + tw + 60, 190, 2, '#fff'); }
    c.restore();
    T((s.artist || (s.title ? '' : 'play something on your phone')).slice(0, 35), 14, 212, 1, ACC);
    const p = s.title ? ((frame / 900) % 1) : 0, w = Math.max(2, 212 * p | 0);
    R(14, 228, 212, 2, '#46465a'); R(14, 227, w, 4, ACC); R(12 + w, 224, 3, 10, '#fff');
    T('0:' + pad(p * 59 | 0), 14, 240, 1, '#fff'); T(val('mLen') || '', 226 - (val('mLen') || '').length * 6, 240, 1, '#fff');
    for (let i = 0; i < 20; i++) { const h = 2 + (eq(i) * 16 | 0); R(60 + i * 6, 258 - h, 4, h, ACC); }
  }
  function floor(hz, col) { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); for (let i = 0; i < 9; i++) { const y = hz + (i / 9) ** 2 * (H - hz); c.moveTo(0, y); c.lineTo(W, y); } for (let i = -8; i <= 8; i++) { c.moveTo(120 + i * 14, hz); c.lineTo(120 + i * 90, H); } c.stroke(); }
  function pet() {
    grad(VOID, mixk(val('petCol'), .2)); floor(204, mixk(ACC, .2)); topBar('//DAEMON', true);
    TC((val('petName') || 'pet').slice(0, 12), 34, 3, '#fff');
    const b = Math.abs(Math.sin(frame * 0.18)) * 14 | 0, lean = Math.round(tiltX * 24);
    c.fillStyle = mixk(ACC, .2); c.beginPath(); c.ellipse(120 + lean, 200, 46 - b, 6, 0, 0, 7); c.fill();
    sprite(60 + lean, 74 - b, 10);
    for (let i = 0; i < 10; i++) R(51 + i * 14, 226, 11, 8, i < 7 ? ACC : mixk(ACC, .2));
    TC('STATE: HAPPY', 242, 1, '#fff');
  }

  // ── minigames (same rules as the firmware): tic-tac-toe, rock-paper-scissors, reflex ──
  const TOYT = ['< ORACLE >', '< DICE >', '< COIN >', '< TIC-TAC-TOE >', '< R-P-S >', '< REFLEX >'];
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const ttt = { b: Array(9).fill(0), win: 0, line: -1, charm: false, youStart: false, at: 0, score: [0, 0, 0] };
  const ttCheck = b => { for (let i = 0; i < 8; i++) { const [a, c, d] = LINES[i]; if (b[a] && b[a] === b[c] && b[a] === b[d]) return [b[a], i]; } return [b.includes(0) ? 0 : 3, -1]; };
  function mm(b, charm, depth) {
    const [r] = ttCheck(b); if (r === 2) return 10 - depth; if (r === 1) return depth - 10; if (r === 3) return 0;
    let best = charm ? -100 : 100;
    for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = charm ? 2 : 1; const v = mm(b, !charm, depth + 1); b[i] = 0; best = charm ? Math.max(best, v) : Math.min(best, v); }
    return best;
  }
  function ttPick() {
    const e = ttt.b.map((v, i) => v ? -1 : i).filter(i => i >= 0);
    if (e.length === 9) return [4, 0, 2, 6, 8][Math.random() * 5 | 0];
    if (Math.random() < 0.22) return e[Math.random() * e.length | 0];
    let best = -1e9, at = e[0];
    for (const i of e) { ttt.b[i] = 2; const v = mm(ttt.b, false, 1) * 10 + Math.random() * 3; ttt.b[i] = 0; if (v > best) { best = v; at = i; } }
    return at;
  }
  const ttNew = () => { ttt.b.fill(0); ttt.win = 0; ttt.line = -1; ttt.youStart = !ttt.youStart; ttt.charm = !ttt.youStart; ttt.at = performance.now() + 600; };
  const ttEnd = w => { ttt.win = w; ttt.charm = false; ttt.score[w === 1 ? 0 : w === 2 ? 1 : 2]++; charmLogGame(`game: ttt, ${w === 1 ? 'you win' : w === 2 ? 'charm wins' : 'draw'}`); };
  function ttTap(x, y) {
    if (ttt.win || ttt.b.every(v => !v) && ttt.charm) { if (ttt.win) ttNew(); return; }
    if (ttt.charm || x < 30 || x >= 210 || y < 58 || y >= 238) return;
    const c = ((y - 58) / 60 | 0) * 3 + ((x - 30) / 60 | 0); if (ttt.b[c]) return;
    ttt.b[c] = 1; const [r, l] = ttCheck(ttt.b); ttt.line = l;
    if (r) ttEnd(r); else { ttt.charm = true; ttt.at = performance.now() + 380 + Math.random() * 420; }
  }
  function drawTtt(now) {
    if (ttt.charm && !ttt.win && now >= ttt.at) { ttt.b[ttPick()] = 2; ttt.charm = false; const [r, l] = ttCheck(ttt.b); ttt.line = l; if (r) ttEnd(r); }
    const DIM = mixk(ACC, .45);
    for (let k = 1; k < 3; k++) { R(30 + k * 60 - 1, 62, 2, 172, DIM); R(34, 58 + k * 60 - 1, 172, 2, DIM); }
    ttt.b.forEach((v, i) => {
      const cx = 60 + (i % 3) * 60, cy = 88 + (i / 3 | 0) * 60, lit = ttt.line >= 0 && LINES[ttt.line].includes(i) && (now / 250 | 0) % 2;
      if (v === 1) { c.strokeStyle = lit ? ACC : '#fff'; c.lineWidth = 5; c.lineCap = 'butt'; c.beginPath(); c.moveTo(cx - 17, cy - 17); c.lineTo(cx + 17, cy + 17); c.moveTo(cx + 17, cy - 17); c.lineTo(cx - 17, cy + 17); c.stroke(); }
      else if (v === 2) { c.strokeStyle = lit ? '#fff' : ACC; c.lineWidth = 5; c.beginPath(); c.arc(cx, cy, 17, 0, 7); c.stroke(); }
    });
    const msg = ttt.win === 1 ? 'you win!' : ttt.win === 2 ? 'i win :)' : ttt.win === 3 ? 'draw' : ttt.charm ? 'thinking..' : 'your move';
    G(msg, 120 - msg.length * 3, 244, 1, ttt.win === 1 ? '#34c759' : ttt.win ? ACC : '#fff');
    const sc = `you ${ttt.score[0]}  me ${ttt.score[1]}  draw ${ttt.score[2]}`; G(sc, 120 - sc.length * 3, 256, 1, DIM);
  }
  const RPSN = ['rock', 'paper', 'scissors'];
  const rps = { you: -1, me: -1, at: 0, scored: 0, score: [0, 0, 0] };
  const rpsPlay = k => { if (rps.you >= 0 && performance.now() - rps.at < 1000) return; rps.you = k; rps.me = Math.random() * 3 | 0; rps.at = performance.now(); };
  function rpsIcon(k, cx, cy, col) {
    if (k === 0) { circle(cx, cy, 24, col, true); }
    else if (k === 1) { R(cx - 20, cy - 26, 40, 52, col); for (let i = 0; i < 4; i++) R(cx - 14, cy - 16 + i * 10, 28, 1, VOID); }
    else { c.strokeStyle = col; c.lineWidth = 5; c.beginPath(); c.moveTo(cx - 18, cy - 24); c.lineTo(cx + 10, cy + 10); c.moveTo(cx + 18, cy - 24); c.lineTo(cx - 10, cy + 10); c.stroke(); c.lineWidth = 3; c.beginPath(); c.arc(cx - 12, cy + 18, 7, 0, 7); c.moveTo(cx + 19, cy + 18); c.arc(cx + 12, cy + 18, 7, 0, 7); c.stroke(); }
  }
  function drawRps(now) {
    G('you', 51, 58, 2, '#fff'); G('me', 168, 58, 2, ACC);
    const el = now - rps.at, counting = rps.you >= 0 && el < 900;
    if (rps.you < 0) { rpsIcon(0, 60, 116, mixk(ACC, .2)); rpsIcon(0, 180, 116, mixk(ACC, .2)); TC('pick one', 166, 2, '#fff'); }
    else if (counting) { const bob = Math.abs(Math.sin(el * 0.021)) * 14 | 0; rpsIcon(0, 60, 112 - bob, '#fff'); rpsIcon(0, 180, 112 - bob, ACC); TC(['rock..', 'paper..', 'scissors..'][Math.min(2, el / 300 | 0)], 166, 2, '#fff'); }
    else {
      rpsIcon(rps.you, 60, 116, '#fff'); rpsIcon(rps.me, 180, 116, ACC);
      const r = (rps.you - rps.me + 3) % 3;
      if (rps.scored !== rps.at) { rps.scored = rps.at; rps.score[r === 1 ? 0 : r === 2 ? 1 : 2]++; charmLogGame(`game: rps, ${r === 1 ? 'you win' : r === 2 ? 'charm wins' : 'draw'}`); }
      const vs = `${RPSN[rps.you]} vs ${RPSN[rps.me]}`; G(vs, 120 - vs.length * 3, 152, 1, mixk(ACC, .45));
      TC(r === 1 ? 'YOU WIN' : r === 2 ? 'I WIN' : 'DRAW', 168, 2, r === 1 ? '#34c759' : r === 2 ? ACC : '#fff');
    }
    RPSN.forEach((n, k) => { const x = 14 + k * 74, sel = rps.you === k && !counting; if (sel) R(x, 200, 64, 32, ACC); else hudPanel(x, 200, 64, 32, ACC, .75); G(n, x + (64 - n.length * 6) / 2, 212, 1, sel ? '#000' : '#fff'); });
    const sc = `you ${rps.score[0]}  me ${rps.score[1]}  draw ${rps.score[2]}`; G(sc, 120 - sc.length * 3, 248, 1, mixk(ACC, .45));
  }
  const rf = { st: 'idle', goAt: 0, shown: 0, ms: 0, best: +(localStorage.getItem('o_rfbest') || 0) };
  const rfStart = () => { rf.st = 'wait'; rf.goAt = performance.now() + 1400 + Math.random() * 2600; rf.shown = 0; };
  function rfTap(t) {
    if (rf.st === 'wait') rf.st = 'early';
    else if (rf.st === 'go') { if (!rf.shown || t < rf.shown) { rf.st = 'early'; return; } rf.ms = Math.round(t - rf.shown); rf.st = 'done'; if (!rf.best || rf.ms < rf.best) { rf.best = rf.ms; try { localStorage.setItem('o_rfbest', rf.best); } catch (_) {} } }
    else rfStart();
  }
  function drawReflex(now) {
    if (rf.st === 'wait' && now >= rf.goAt) rf.st = 'go';
    const DIM = mixk(ACC, .45);
    if (rf.st === 'wait') { TC('wait for it...', 140, 2, '#fff'); for (let i = 0; i < 3; i++) R(108 + i * 10, 172, 6, 6, (now / 300 | 0) % 3 === i ? ACC : mixk(ACC, .2)); }
    else if (rf.st === 'go') { R(0, 50, W, 200, ACC); TC('TAP!', 130, 5, '#000'); if (!rf.shown) rf.shown = now; }
    else if (rf.st === 'done') { TC(rf.ms + 'ms', 112, 4, '#fff'); TC(rf.ms < 220 ? 'lightning' : rf.ms < 280 ? 'quick' : rf.ms < 380 ? 'not bad' : 'sleepy?', 156, 2, ACC); TC('tap to go again', 188, 1, DIM); }
    else if (rf.st === 'early') { TC('too soon!', 128, 3, '#ef4444'); TC('tap to try again', 168, 1, DIM); }
    else { TC('tap when the', 116, 2, '#fff'); TC('screen lights up', 138, 2, '#fff'); TC('tap to start', 178, 1, DIM); }
    if (rf.best) TC(`best ${rf.best}ms`, 252, 1, rf.st === 'go' ? '#000' : DIM);
  }
  const charmLogGame = m => { if (window.charmLog) window.charmLog(m); };
  window.toyPreviewTap = (x, y, t) => {
    const k = ui.toy;
    if (y < 54) { window.charmSetToy && window.charmSetToy((k + 1) % 6); return; }
    if (k === 3) ttTap(x, y); else if (k === 4) { if (y >= 196 && y < 236) rpsPlay(Math.min(2, Math.max(0, (x - 14) / 74 | 0))); } else if (k === 5) rfTap(t);
    else window.charmGoto(8);
  };
  window.toyPreviewNew = k => { if (k === 3) ttNew(); else if (k === 4) rpsPlay(Math.random() * 3 | 0); else if (k === 5) rfStart(); };
  function toy() {
    const k = ui.toy; R(0, 0, W, H, VOID); for (let y = 50; y < H; y += 20) for (let x = 10; x < W; x += 20) R(x, y, 1, 1, mixk(ACC, .45));
    const now = performance.now();
    if (k === 3) drawTtt(now); else if (k === 4) drawRps(now); else if (k === 5) drawReflex(now);
    else if (k === 0) { circle(120, 160, 92, '#000', true); circle(120, 160, 92, ACC); circle(120, 160, 86, mixk(ACC, .2)); circle(120, 164, 60, mixk(ACC, .22), true); circle(120, 164, 60, ACC); TC('shake', 146, 2, '#fff'); TC('me', 166, 2, '#fff'); }
    else if (k === 1) {
      [[26, [0, 2, 4, 6, 8]], [126, [0, 8]]].forEach(([x, pips]) => { c.strokeStyle = ACC; c.strokeRect(x + 5.5, 105.5, 88, 88); R(x, 100, 88, 88, '#fff'); pips.forEach(i => R(x + 22 * (1 + i % 3) - 8, 100 + 22 * (1 + (i / 3 | 0)) - 8, 16, 16, '#000')); });
      TC('= 7', 208, 4, ACC);
    } else { circle(120, 150, 72, '#be8214', true); c.fillStyle = '#ffc83c'; c.beginPath(); c.ellipse(120, 150, 66 * Math.abs(Math.cos(frame * 0.03)), 66, 0, 0, 7); c.fill(); TC('shake to flip', 234, 2, '#fff'); }
    topBar('//RNG', true); if (!(k === 5 && rf.st === 'go')) TC(TOYT[k] || TOYT[0], 30, 2, ACC);
  }
  function card() {
    const a = val('cAcc'), name = (val('cName') || '').slice(0, 20), sub = (val('cSub') || '').slice(0, 24);
    R(0, 0, W, H, VOID); topBar('//ID', true); hudPanel(12, 32, 216, 112, a, 0); R(12, 38, 4, 100, a);
    T('OPERATOR', 26, 42, 1, mixk(a, .65)); T(name, 26, 58, name.length <= 10 ? 3 : name.length <= 16 ? 2 : 1, '#fff'); T(sub, 26, 90, sub.length <= 16 ? 2 : 1, a);
    let h = 2166136261; for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    for (let x = 26, i = 0; x < 214; i++) { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; const w = 1 + ((h >>> 28) & 3); if (!(i & 1)) R(x, 116, Math.min(w, 214 - x), 18, a); x += w; }
    for (let i = 0; i < 3; i++) { const on = i < (frame / 8 | 0) % 4; circle(120, 198, 14 + i * 11, on ? a : mixk(a, .25)); circle(120, 198, 15 + i * 11, on ? a : mixk(a, .25)); }
    R(115, 193, 11, 11, '#fff'); TC('>> TAP PHONE HERE <<', 244, 1, '#fff');
  }
  function ticker() { const s = song(); if (!ui.playing || !s.title) return; dim(44, 260, 152, 13, .75); T('♪', 48, 263, 1, ACC); T(marquee(s.title + (s.artist ? ' - ' + s.artist : ''), 22, 7), 58, 263, 1, '#fff'); }
  // ── eyes ──
  function lg(x, y0, y1, stops) { const g = x.createLinearGradient(0, y0, 0, y1); stops.forEach(([p, col]) => g.addColorStop(p, col)); return g; }
  const NEU = { w: 62, h: 74, rad: 18, lidT: 0, slope: 0, lidB: 0 };
  const EX = [{}, { lidB: 0.5 }, { lidB: 0.62, h: 66 }, { lidT: 0.3, slope: 0.42, h: 66 }, { lidT: 0.36, slope: -0.55, h: 64 }, { w: 70, h: 86, rad: 33 }, { lidT: 0.62, slope: 0.12 },
    { lidT: 0.46, lidB: 0.1 }, { L: { lidT: 0.52 }, R: { lidT: 0.16, h: 70 } }, { L: { lidB: 0.5 }, R: { h: 9, rad: 4 } }, {}, { w: 50, h: 50, rad: 25 }];
  const ey = { L: { ...NEU }, R: { ...NEU }, lx: 0, ly: 0, tx: 0, ty: 0, sac: 0, blink: 0, nextBlink: 0, shown: -1, idle: 0, idleUntil: 0, nextIdle: 0, TL: { ...NEU }, TR: { ...NEU } };
  function eyes() {
    const now = performance.now();
    let want = ui.expr !== 255 && ui.exprAt && now - ui.exprAt < 10000 ? ui.expr : null;
    if (want == null) {
      if (ui.jbSong >= 0 || window.previewNotes) want = (frame / 40 | 0) % 2 ? 1 : 2;
      else { if (now > ey.nextIdle) { ey.idle = [0, 1, 8, 7, 5, 9, 1, 0][Math.random() * 8 | 0]; ey.idleUntil = now + 1400 + Math.random() * 1800; ey.nextIdle = now + 5000 + Math.random() * 6000; } want = now < ey.idleUntil ? ey.idle : 0; }
    }
    if (want !== ey.shown) { ey.shown = want; const e = EX[want] || {}; ey.TL = { ...NEU, ...e, ...(e.L || {}) }; ey.TR = { ...NEU, ...e, ...(e.R || {}) }; delete ey.TL.L; delete ey.TL.R; delete ey.TR.L; delete ey.TR.R; }
    if (now > ey.sac) { if (Math.random() < 0.33) { ey.tx = 0; ey.ty = 0; } else { ey.tx = Math.random() * 52 - 26; ey.ty = Math.random() * 32 - 16; } ey.sac = now + 900 + Math.random() * 2300; }
    if (Math.abs(tryy) > 0.05 || Math.abs(trx) > 0.05) { ey.tx = Math.max(-30, Math.min(30, tryy * 60)); ey.ty = Math.max(-20, Math.min(20, trx * 40)); }
    if (ey.shown === 6) ey.ty = 10;
    ey.lx += (ey.tx - ey.lx) * 0.32; ey.ly += (ey.ty - ey.ly) * 0.32;
    for (const k of Object.keys(NEU)) { ey.L[k] += (ey.TL[k] - ey.L[k]) * 0.28; ey.R[k] += (ey.TR[k] - ey.R[k]) * 0.28; }
    if (now > ey.nextBlink) { ey.blink = now; ey.nextBlink = now + (Math.random() < 0.2 ? 280 : 2200 + Math.random() * 3800); }
    const el = now - ey.blink, bf = el < 90 ? 1 - el / 90 * 0.92 : el < 180 ? 0.08 + (el - 90) / 90 * 0.92 : 1;
    const bgFill = '#000';
    c.fillStyle = bgFill; c.fillRect(0, 0, W, H);
    for (let y = 10; y < H; y += 20) for (let x = 10; x < W; x += 20) R(x, y, 1, 1, '#001a34');
    let cy = 140 + ey.ly; if (ey.shown === 2) cy += Math.sin(now / 1000 * 22) * 3; if (ui.playing) cy += Math.sin(now / 1000 * 7.5) * 3;
    if (ey.shown === 10) {
      const s = 30 * (1 + 0.1 * Math.sin(now / 1000 * 9));
      [70, 170].forEach(x0 => { const x = x0 + ey.lx; c.save(); c.shadowColor = '#ff3c9a'; c.shadowBlur = 16; c.fillStyle = '#ff50a0'; c.beginPath();
        c.moveTo(x, cy + s * 0.9); c.bezierCurveTo(x - s * 1.6, cy - s * 0.1, x - s * 0.8, cy - s * 1.3, x, cy - s * 0.45); c.bezierCurveTo(x + s * 0.8, cy - s * 1.3, x + s * 1.6, cy - s * 0.1, x, cy + s * 0.9); c.fill(); c.restore(); });
      return;
    }
    const t = now / 1000, dz = ey.shown === 11;
    [[ey.L, 70, true, dz ? Math.cos(t * 8) * 12 : 0, dz ? Math.sin(t * 8) * 12 : 0], [ey.R, 170, false, dz ? Math.cos(-t * 8 + 1) * 12 : 0, dz ? Math.sin(-t * 8 + 1) * 12 : 0]].forEach(([e, x0, left, dx, dy]) => {
      const w = e.w * (1 + (left ? -1 : 1) * ey.lx * 0.004), h = Math.max(3, e.h * (e.h > 12 ? bf : 1)), x = x0 + ey.lx + dx, y = cy + dy, r = Math.min(e.rad, w / 2, h / 2);
      c.save(); c.shadowColor = '#0060ff'; c.shadowBlur = 18;
      c.fillStyle = lg(c, y - h / 2, y + h / 2, [[0, '#aaecff'], [1, '#1478ff']]); c.beginPath(); c.roundRect(x - w / 2, y - h / 2, w, h, r); c.fill(); c.restore();
      c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(x - w * 0.18, y - h * 0.25, w * 0.15, h * 0.1, 0, 0, 7); c.fill();
      c.fillStyle = bgFill;
      if (e.lidT > 0.01 || Math.abs(e.slope) > 0.01) { c.beginPath(); c.moveTo(x - w / 2 - 20, y - h / 2 - 30); for (let i = -1.3; i <= 1.31; i += 0.1) { const u = left ? -i : i; c.lineTo(x + i * w / 2, y + (-1 + 2 * e.lidT + e.slope * u) * h / 2); } c.lineTo(x + w / 2 + 20, y - h / 2 - 30); c.fill(); }
      if (e.lidB > 0.01) { c.beginPath(); c.moveTo(x - w / 2 - 20, y + h / 2 + 30); for (let i = -1.3; i <= 1.31; i += 0.1) c.lineTo(x + i * w / 2, y + h / 2 - e.lidB * h * (1 - 0.85 * i * i)); c.lineTo(x + w / 2 + 20, y + h / 2 + 30); c.fill(); }
    });
  }

  // ── jukebox (deck), torch, charging (deck) ──
  function jukeDeck() {
    R(0, 0, W, H, VOID); topBar('//JUKEBOX', true);
    const playing = ui.jbSong >= 0 ? ui.jbSong : (window.previewNotes ? window.previewNotes.song : -1);
    const cat = +(localStorage.getItem('o_songcat') || 0), cats = window.SONG_CATS || [];
    hudPanel(10, 27, 220, 19, ACC, .5); TC((cats[cat] || '').toUpperCase(), 33, 1, '#fff'); T('<', 18, 33, 1, ACC); T('>', 216, 33, 1, ACC);
    (window.SONGS || []).map((sg, i) => [sg, i]).filter(([sg]) => sg.cat === cat).forEach(([sg, i], k) => { const y = 50 + k * 17; if (i === playing) R(14, y, 212, 15, mixk(ACC, .33)); T(String(k + 1).padStart(2, '0') + ' ' + sg.name.toUpperCase().slice(0, 28), 20, y + 4, 1, i === playing ? '#fff' : '#b9b9c0'); if (i === playing) T('>', 212, y + 4, 1, ACC); });
    const py = 192; hudPanel(10, py, 220, 58, ACC, .5); T(playing >= 0 ? 'E5' : '--', 20, py + 10, 3, playing >= 0 ? '#fff' : mixk(ACC, .45));
    if (playing >= 0) for (let i = 0; i < 20; i++) { const h = 4 + Math.abs(Math.sin(i * 1.7 + frame * 0.2)) * 26; R(100 + i * 6, py + 36 - h, 4, h, ACC); }
    if (playing >= 0) { T('+' + ui.jbQueue + ' QUEUED', 20, py + 48, 1, '#fff'); T('STOP', 132, py + 48, 1, ACC); T('SKIP >', 184, py + 48, 1, ACC); } else T('TAP A SONG TO PLAY OR QUEUE', 20, py + 48, 1, '#fff');
  }
  function torch() { R(0, 0, W, H, ['#ffffff', '#ffce96', '#ff0000', '#78e6ff'][ui.torch || 0]); }
  function chargeDeck() {
    R(0, 0, W, H, VOID); topBar('//POWER', true);
    const p = ui.bat || 76, col = '#34c759', s = String(p), x = (W - (s.length * 42 - 8 + 30)) / 2;
    [...s].forEach((ch, i) => segDigit(x + i * 42, 48, 34, 64, 7, +ch, col, mixk(col, .14))); T('%', x + s.length * 42, 88, 3, col);
    hudPanel(22, 132, 186, 52, col, .5); R(208, 148, 8, 20, col);
    for (let i = 0; i < 10; i++) R(30 + i * 17, 140, 14, 36, i < Math.ceil(p / 10) - ((frame / 12 | 0) % 2 && i === Math.ceil(p / 10) - 1 ? 1 : 0) ? col : mixk(col, .16));
    TC('CHARGING  4.05V', 244, 1, '#fff');
  }
  const sing = () => window.Sing && window.singShow && window.singShow.lines.length ? Sing.draw(c, window.singShow, window.singClock()) : deck();

  // ── tty: a kaomoji that lives in the terminal (same as the firmware's drawTty) ──
  const TFACE = ['(o_o)', '(^_^)', '(^o^)', '(\x03_\x03)', '(T_T)', '(>_<)', '(O_O)', '(-_-)', '(-.-)', '(\xAA_\xAA)', '(^_-)', '(@_@)', '(^_^)'];
  const TMOOD = ['idle', 'happy', 'giggling', 'in love', 'sad', 'grumpy', 'surprised', 'sleepy', 'bored', 'suspicious', 'cheeky', 'dizzy', 'vibing'];
  const tt = { face: 0, until: 0, next: 0, blink: 0, nextBlink: 0, look: 0, lookUntil: 0, thought: 'booting feelings... ok', at: 0, nextThought: 0,
    rain: Array.from({ length: 40 }, () => ({ y: -Math.random() * 280, spd: 1 + Math.random() * 3 | 0, len: 4 + Math.random() * 8 | 0 })) };
  function ttyThink(now) {
    const steps = (($('stepCount') || {}).textContent || '0').replace(/[^0-9]/g, '') || '0', s = song(), h = new Date().getHours(), pick = Math.random() * 9 | 0;
    const pool = [`${steps} steps today. legs: noted`, `uptime ${uptime(now - boot)}. still here`, 'compiling dreams... 0 errors',
      document.body.classList.contains('connected') ? 'your phone is close. nice' : 'no phone nearby. just us', "grep -r 'meaning' /life", 'sudo make me a sandwich',
      (val('petName') || 'pet') + ' says hi', 'rm -rf /worries ... done', 'waiting for a ping'];
    tt.thought = h < 5 && Math.random() < .5 ? `it's ${pad(h)}:${pad(new Date().getMinutes())}. why are we awake` : s.title && ui.playing && pick < 3 ? 'now playing: ' + s.title : pool[pick];
    tt.at = now; tt.nextThought = now + 7000 + Math.random() * 5000;
  }
  window.ttyPoke = dbl => { const now = performance.now(); tt.face = dbl ? 3 : [1, 2, 6, 10][Math.random() * 4 | 0]; tt.until = now + (dbl ? 3500 : 2500); };
  function tty() {
    const now = performance.now(), h = new Date().getHours(), night = h >= 23 || h < 6;
    if (now > tt.until) {
      if (night) tt.face = 7; else if (ui.playing && song().title) tt.face = 12;
      else if (now > tt.next) { tt.face = [0, 0, 1, 8, 9, 10, 0, 1][Math.random() * 8 | 0]; tt.next = now + 4000 + Math.random() * 5000; if (Math.random() < .33) { tt.look = Math.random() < .5 ? 1 : -1; tt.lookUntil = now + 1400; } }
    }
    if (now > tt.nextBlink) { tt.blink = now; tt.nextBlink = now + 2200 + Math.random() * 3500; }
    if (now > tt.nextThought) ttyThink(now);
    R(0, 0, W, H, TTY_BG);
    const LOW = mixk(ACC, .2), DIMA = mixk(ACC, .45);
    tt.rain.forEach((d, c) => {
      d.y += d.spd; if (d.y - d.len * 8 > H) { d.y = -Math.random() * 120; d.spd = 1 + Math.random() * 3 | 0; d.len = 4 + Math.random() * 8 | 0; }
      for (let k = 0; k < d.len; k++) { const yy = d.y - k * 8 | 0; if (yy < 0 || yy > H) continue; G(String.fromCharCode(33 + ((c * 7 + (yy >> 3) + (now / 300 | 0)) % 90)), c * 6, yy, 1, k ? LOW : DIMA); }
    });
    R(12, 14, 216, 14, TTY_BG); G('larp@charm', 16, 18, 1, ACC); G(':~$', 76, 18, 1, TTY_TEXT); G('./tty --face', 100, 18, 1, '#fff');
    let face = TFACE[tt.face]; const blink = now - tt.blink < 140 && tt.face !== 7 && tt.face !== 11;
    if (blink) face = face[0] + '-' + face[2] + '-' + face[4];
    if (tt.face === 11 && (now / 160 | 0) % 2) face = '(%_%)';
    const bob = Math.round(Math.sin(now / (tt.face === 7 ? 700 : 380)) * 3), lx = (now < tt.lookUntil ? tt.look * 10 : 0) + (tt.face === 11 ? Math.round(Math.sin(now / 90) * 6) : 0);
    R(30, 82, 180, 50, TTY_BG); G(face, 45 + lx, 90 + bob, 5, tt.face === 3 ? '#ff5a96' : '#fff');
    if (tt.face === 7) for (let i = 0; i < 3; i++) { const p = (now / 1800 + i / 3) % 1; G(i % 2 ? 'Z' : 'z', 196 + p * 14 | 0, 86 - p * 34 | 0, 1 + i % 2, ACC); }
    if (tt.face === 12) { G('\x0E', 200, 84 + Math.round(Math.sin(now / 300) * 5), 2, ACC); G('\x0E', 22, 112 - Math.round(Math.sin(now / 260) * 5), 2, ACC); }
    R(10, 148, 220, 44, TTY_BG); G('mood:', 16, 152, 1, TTY_DIM); G(TMOOD[tt.face], 52, 152, 1, ACC);
    const sh = tt.thought.slice(0, (now - tt.at) / 35 | 0);
    G('>', 16, 166, 1, ACC); G(sh.slice(0, 33), 28, 166, 1, TTY_TEXT); if (sh.length > 33) G(sh.slice(33, 66), 28, 177, 1, TTY_TEXT);
    const cl = sh.length > 33 ? 1 : 0; if ((now / 450 | 0) % 2) R(28 + (sh.length - cl * 33) * 6, 165 + cl * 11, 6, 9, ACC);
    R(10, 236, 220, 12, TTY_BG); G('tap: poke  2x: love  shake: @_@', 28, 238, 1, TTY_DIM);
  }

  // ── cc: an homage to Claude Code, working away on the charm (same as the firmware's drawClaude) ──
  const CC = { o: '#d97757', text: '#e8e8e8', dim: '#8c8c96', green: '#50c878', red: '#f05a5a', bg: '#0c0c0e' };
  const VERBS = ['Noodling', 'Pondering', 'Percolating', 'Tinkering', 'Musing', 'Brewing', 'Cogitating', 'Spelunking', 'Whirring', 'Simmering', 'Untangling', 'Booping'];
  const cc = { log: [], script: [], pos: 0, state: 'rest', at: 0, session: 0, verb: 0 };
  function ccPlan(which) {
    const steps = (($('stepCount') || {}).textContent || '0').replace(/[^0-9]/g, '') || '0', s = song(), bat = ui.bat || 76, up = uptime(performance.now() - boot);
    const S = (k, think, t) => ({ k, think, t: String(t) });
    let sc;
    if (which === 'hi') sc = [S('user', 0, 'hi claude'), S('text', 900, 'Hi! I\'m keeping an eye on the'), S('text', 0, `charm. Uptime ${up}.`)];
    else {
      const n = cc.session++ % 5;
      sc = n === 0 ? [S('user', 0, 'make the deck more cli'), S('tool', 1600, 'Read(LarpCharm.ino)'), S('res', 300, 'Read 4180 lines'), S('tool', 2400, 'Update(drawDeck)'), S('res', 300, '+212 -98'), S('text', 1200, 'Done. Home is a tmux session.')]
        : n === 1 ? [S('user', 0, `why is my battery at ${bat}%?`), S('tool', 1400, 'Bash(cat /sys/pwr)'), S('res', 300, `3.98v, ${ui.charging ? 'charging' : 'on battery'}`), S('text', 1300, ui.charging ? 'It\'s charging. Full soon.' : bat < 30 ? `Up ${up}. Plug me in soon.` : `Up ${up}. Plenty left.`)]
        : n === 2 ? [S('user', 0, 'how many steps today?'), S('tool', 1200, 'Read(/dev/imu)'), S('res', 300, steps + ' steps'), S('text', 1100, +steps > 6000 ? 'Big day. Your legs earned it.' : 'Short walk later? I\'ll count.')]
        : n === 3 && s.title ? [S('user', 0, 'what\'s playing?'), S('tool', 1100, 'Read(/dev/np)'), S('res', 300, s.title), S('text', 900, 'Good pick.')]
        : n === 3 ? [S('user', 0, 'fix the flaky timer'), S('tool', 1500, 'Grep("timerEndAt")'), S('res', 300, 'Found 9 matches'), S('tool', 2000, 'Bash(pio test)'), S('res', 300, '12 passed'), S('text', 900, 'Fixed an overflow at 49 days.')]
        : [S('user', 0, 'commit and push'), S('tool', 1300, 'Bash(git commit -am ...)'), S('res', 300, '1 file changed'), S('tool', 1400, 'Bash(git push)'), S('res', 300, 'main -> main'), S('text', 800, 'Pushed.')];
    }
    if (cc.log.length) cc.log.push({ k: 'gap', t: '' });
    cc.script = sc; cc.pos = 0; cc.state = 'type'; cc.at = performance.now(); cc.verb = Math.random() * 12 | 0;
  }
  window.ccPoke = () => { if (cc.state === 'rest') { ccPlan('hi'); ccPose('wave', 2200); } };
  function ccStar(cx, cy, ph, col) {
    const a = [0, 1, 2, 3, 3, 2][ph % 6]; R(cx, cy, 1, 1, col);
    if (a >= 1) { R(cx - a, cy, 2 * a + 1, 1, col); R(cx, cy - a, 1, 2 * a + 1, col); }
    if (a >= 2) for (let k = 1; k < a; k++) [[-k, -k], [k, k], [k, -k], [-k, k]].forEach(([dx, dy]) => R(cx + dx, cy + dy, 1, 1, col));
  }

  // the critter itself, on a 16x10 grid of s-pixel cells (same as the firmware's ccCritter)
  function critter(x0, y0, s, eyes, look, arms, legs, now) {
    const B = CC.o, E = CC.bg, rect = (cx, cy, w, h, col) => R(x0 + cx * s, y0 + cy * s, w * s, h * s, col);
    rect(2, 0, 12, 8, B);
    const flap = arms === 1 && (now / 200 | 0) % 2;
    rect(0, arms === 3 ? 1 : flap ? 3 : 4, 2, 2, B);
    rect(14, arms === 3 ? 1 : arms === 2 ? ((now / 180 | 0) % 2 ? 1 : 2) : flap ? 5 : 4, 2, 2, B);
    [3, 5, 10, 12].forEach((lx, k) => rect(lx, 8, 1, legs === 3 || (legs === 1 && k % 2) || (legs === 2 && !(k % 2)) ? 1 : 2, B));
    [4, 11].forEach(ex => {
      const x = ex + look;
      if (eyes === 'shut') rect(x, 3, 1, 1, E);
      else if (eyes === 'happy') { rect(ex - 1, 3, 1, 1, E); rect(ex, 2, 1, 1, E); rect(ex + 1, 3, 1, 1, E); }
      else if (eyes === 'dizzy') [[-1, 2], [1, 2], [0, 3], [-1, 4], [1, 4]].forEach(([a, b]) => rect(ex + a, b, 1, 1, E));
      else if (eyes === 'down') rect(ex, 3, 1, 2, E);
      else if (eyes === 'up') rect(ex + 1, 1, 1, 2, E);
      else rect(x, 2, 1, 2, E);
    });
  }
  // the mascot in the welcome box (same as the firmware's ccMascot)
  const cm = { pose: 'idle', until: 0, at: 0, blink: 0, nextBlink: 0, look: 0, lookUntil: 0 };
  const ccPose = (p, ms) => { cm.pose = p; cm.at = performance.now(); cm.until = cm.at + ms; };
  function ccMascot(x0, y0, s) {
    const now = performance.now();
    if (now > cm.until) cm.pose = 'idle';
    if (now > cm.nextBlink) { cm.blink = now; cm.nextBlink = now + 2400 + Math.random() * 3000; }
    const L = window.ccBridge && window.ccBridge();
    const busy = L ? (L.state === 'thinking' || L.state === 'tool') : (cc.state === 'think' || cc.state === 'stream') && cc.pos < cc.script.length, typing = !L && cc.state === 'type';
    if (!busy && !typing && now > cm.lookUntil && Math.random() < 1 / 160) { cm.look = Math.random() < .5 ? 1 : -1; cm.lookUntil = now + 1200; }
    let dy = 0, dx = 0;
    if (busy) dy = -((now / 140 | 0) % 2);
    else if (cm.pose === 'happy' || cm.pose === 'wave') { const p = (now - cm.at) / 450; if (p < 1) dy = -Math.round(Math.sin(p * Math.PI) * 3); }
    else dy = (now / 1100 | 0) % 2;
    if (cm.pose === 'dizzy') dx = Math.round(Math.sin(now / 70) * 1.6);
    x0 += dx * s; y0 += dy * s;
    const blink = now - cm.blink < 130;
    critter(x0, y0, s, cm.pose === 'happy' ? 'happy' : cm.pose === 'dizzy' ? 'dizzy' : blink ? 'shut' : typing ? 'down' : busy ? 'up' : 'open',
      now < cm.lookUntil ? cm.look : 0, cm.pose === 'wave' ? 2 : busy ? 1 : 0, busy ? 1 + (now / 160 | 0) % 2 : 0, now);
  }
  const ccBox = (x, y, w, h, col) => { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.roundRect(x + .5, y + .5, w - 1, h - 1, 6); c.stroke(); };
  // the critter, popped out to full screen: a pocket pet (same as the firmware's drawCcBig)
  const cb = { big: false, t: 0, x: 0, vx: 0, y: 0, vy: 0, target: 0, walking: false, say: '', sayUntil: 0, happyUntil: 0, touchAt: 0, love: 50, decay: 0, hearts: [] };
  const CB_S = 9, CB_G = 204;
  const cbSpeak = (t, ms) => { cb.say = t; cb.sayUntil = performance.now() + ms; };
  const cbJump = v => { if (cb.y < 1) cb.vy = v; };
  function cbPet() {
    const now = performance.now(); cb.happyUntil = now + 1400; cbSpeak(['hehe', '*boop*', '<3', 'again!', ':)', 'purr?', 'hi!', 'yay'][Math.random() * 8 | 0], 1300);
    cb.love = Math.min(100, cb.love + 8);
    for (let k = 0; k < 3; k++) cb.hearts.push({ x: 120 + cb.x + Math.random() * 80 - 40, y: CB_G - 10 * CB_S - cb.y - 22, vy: -1.2 - Math.random(), life: 50 });
  }
  window.cbOpen = () => { Object.assign(cb, { big: true, x: 0, vx: 0, y: 0, vy: 0, walking: false, touchAt: performance.now() }); cbSpeak('hi!', 1600); cb.happyUntil = performance.now() + 1200; };
  window.cbClose = () => { cb.big = false; };
  window.cbIsBig = () => cb.big;
  window.cbTap = (x, y, dbl) => {
    cb.touchAt = performance.now();
    const cx = 120 + cb.x, top = CB_G - 10 * CB_S - cb.y;
    if (dbl) { cbJump(9.5); cbSpeak('wheee', 900); return; }
    if (Math.abs(x - cx) < 8 * CB_S + 6 && y > top - 10 && y < CB_G + 6) return cbPet();
    cb.target = Math.max(-36, Math.min(36, x - 120)); cb.walking = true;
  };
  window.cbSwipe = dir => { cb.touchAt = performance.now(); if (dir === 'up') { cbJump(11); return; } cb.target = dir === 'left' ? -36 : 36; cb.walking = true; };
  function drawCcBig() {
    const now = performance.now(), bored = now - cb.touchAt > 9000, asleep = now - cb.touchAt > 20000;
    if (cb.walking) { cb.vx = Math.max(-2.6, Math.min(2.6, (cb.target - cb.x) * 0.12)); if (Math.abs(cb.target - cb.x) < 1.5) { cb.walking = false; cb.vx = 0; } }
    else { if (!asleep) cb.vx += tiltX * 0.55; cb.vx *= 0.86; }
    cb.x = Math.max(-36, Math.min(36, cb.x + cb.vx));
    if (cb.y > 0 || cb.vy > 0) { cb.y += cb.vy; cb.vy -= 0.85; if (cb.y <= 0) { cb.y = 0; cb.vy = 0; } }
    if (now - cb.decay > 3000) { cb.decay = now; if (cb.love > 0) cb.love--; }
    R(0, 0, W, H, CC.bg); G('swipe down to go back', 57, 16, 1, CC.dim);
    for (let x = 14; x < 226; x += 6) R(x, CB_G + 10, 3, 1, '#45454b');
    const s = CB_S, x0 = 120 - 8 * s + Math.round(cb.x), y0 = CB_G - 10 * s - Math.round(cb.y);
    const moving = Math.abs(cb.vx) > 0.4, air = cb.y > 0.5, happy = now < cb.happyUntil;
    c.fillStyle = '#281e1c'; c.beginPath(); c.ellipse(120 + cb.x, CB_G + 3, Math.max(20, 62 - cb.y * 0.6), 4, 0, 0, 7); c.fill();
    const bob = asleep ? (now / 900 | 0) % 2 : (!moving && !air) ? (now / 1100 | 0) % 2 : 0;
    if (now > cm.nextBlink) { cm.blink = now; cm.nextBlink = now + 2400 + Math.random() * 3000; }
    const look = moving ? Math.sign(cb.vx) : Math.abs(tiltX) > 0.25 ? Math.sign(tiltX) : 0;
    const eyes = asleep ? 'shut' : happy ? 'happy' : now - cm.blink < 130 ? 'shut' : bored ? 'down' : 'open';
    critter(x0, y0 + Math.round(bob * s / 3), s, eyes, look, air ? 3 : happy ? 2 : moving ? 1 : 0, air ? 3 : moving ? 1 + (now / 140 | 0) % 2 : 0, now);
    if (asleep) for (let i = 0; i < 3; i++) { const p = (now / 1800 + i / 3) % 1; G(i % 2 ? 'z' : 'Z', Math.min(x0 + 11 * s + p * 10 | 0, 214), y0 - 8 - p * 40 | 0, 1 + i % 2, CC.o); }
    cb.hearts = cb.hearts.filter(h => (h.y += h.vy, --h.life) > 0); cb.hearts.forEach(h => G('\x03', h.x - 6 | 0, h.y | 0, 2, '#ff6e96'));
    if (now < cb.sayUntil && !asleep) {
      const w = cb.say.length * 12 + 24, bx = Math.max(14, Math.min(226 - w, 120 + cb.x - w / 2 | 0)), by = Math.max(30, y0 - 40);
      R(bx, by, w, 26, CC.bg); ccBox(bx, by, w, 26, CC.o); circle(bx + 9.5, by + 13.5, 2, CC.text, true); G(cb.say, bx + 16, by + 6, 2, CC.text);
    } else if (bored && !asleep && (now / 4000 | 0) % 2) G('...', 120 + cb.x - 9 | 0, y0 - 16, 1, CC.dim);
    G('mood', 28, 232, 1, CC.dim); G(bar(cb.love / 100, 22, '#', '#', '.'), 58, 232, 1, cb.love > 30 ? CC.o : CC.red);
    G('tap: pet  2x: jump  swipe: walk', 27, 250, 1, '#4c4c52');
  }
  function drawCcPop(t) {
    const e = 1 - Math.pow(1 - t, 3), bx = 12 * (1 - e), by = 14 * (1 - e), bw = 216 + 24 * e, bh = 58 + 222 * e;
    R(bx, by, bw, bh, CC.bg); ccBox(bx, by, bw, bh, CC.o);
    const s = Math.max(3, Math.round(3 + (CB_S - 3) * (e + Math.sin(t * Math.PI) * 0.25 * e)));
    critter(21 + (120 - 8 * CB_S - 21) * e | 0, 31 + (CB_G - 10 * CB_S - 31) * e | 0, s, 'happy', 0, 3, 3, performance.now());
  }

  // live: the real Claude Code session from larp-bridge (window.ccBridge), same pages as the charm
  const CLN = { offline: 'offline', ready: 'ready', thinking: 'thinking', tool: 'running', perm: 'needs you', waiting: 'your turn', done: 'done' };
  let ccPage = 0;
  window.ccPageStep = d => { ccPage = (ccPage + 3 + d) % 3; };
  window.ccPageNow = () => ccPage;
  function ccTabs(live) {
    ['session', 'status', 'launch'].forEach((t, i) => { const x = [51, 105, 153][i]; G(t, x, 3, 1, i === ccPage ? CC.o : '#4c4c52'); if (i === ccPage) R(x, 11, t.length * 6 - 1, 1, CC.o); });
    circle(196.5, 6.5, 2, live ? CC.green : '#4c4c52', true);
  }
  function ccStatusPage(L) {
    G('Status', 18, 22, 2, CC.o);
    const s = L ? L.status : { ctx: 0, cost: 0, durationMs: 0, linesAdded: 0, linesRemoved: 0 }, se = L ? L.session : {};
    const mins = Math.round((s.durationMs || 0) / 60000);
    const rows = [['Version', se.version || '-'], ['Session', se.name || (se.id || '-').slice(0, 8)], ['cwd', se.cwd || '-'], ['Model', se.model || '-'],
      ['Context', bar((s.ctx || 0) / 100, 12, '#', '#', '.') + ' ' + (s.ctx | 0) + '%'], ['Cost', '$' + (s.cost || 0).toFixed(2)], ['Time', mins >= 60 ? `${mins / 60 | 0}h ${pad(mins % 60)}m` : mins + 'm'], ['Lines', ''],
      ['State', L ? (L.state === 'tool' && L.tool ? L.tool : CLN[L.state]) : '-']];
    rows.forEach(([k, v], i) => {
      const y = 46 + i * 17; G(k, 18, y, 1, CC.dim);
      if (k === 'Lines') { const a = '+' + (s.linesAdded | 0); G(a, 84, y, 1, CC.green); G('-' + (s.linesRemoved | 0), 90 + a.length * 6, y, 1, CC.red); }
      else G(String(v).slice(0, 24), 84, y, 1, k === 'Context' ? CC.o : CC.text);
    });
    if (L) G('bridge linked', 18, 204, 1, CC.green); else { G('not linked. on your computer run', 18, 200, 1, CC.dim); G('node larp-bridge/bridge.mjs', 18, 212, 1, CC.text); }
    ccMascot(160, 224, 3);
  }
  let launchHit = -1, launchAt = 0;
  function ccLaunchPage(L) {
    G('Launch', 18, 22, 2, CC.o); G('starts in Terminal on your laptop', 18, 42, 1, CC.dim);
    if (!L || !L.presets.length) { G('no bridge linked yet', 60, 120, 1, CC.text); G('node larp-bridge/bridge.mjs', 39, 136, 1, CC.dim); ccMascot(96, 180, 3); return; }
    L.presets.slice(0, 6).forEach((n, i) => {
      const y = 58 + i * 30, hit = launchHit === i && performance.now() - launchAt < 700;
      if (hit) { c.fillStyle = CC.o; c.beginPath(); c.roundRect(14, y, 212, 25, 6); c.fill(); } else ccBox(14, y, 212, 25, '#3c3c44');
      G('>', 24, y + 9, 1, hit ? CC.bg : CC.o); G(n.slice(0, 22), 36, y + 9, 1, hit ? CC.bg : CC.text);
    });
  }
  window.ccPreviewTap = (x, y) => {
    const L = window.ccBridge && window.ccBridge();
    if (L && L.perm) { if (y >= 180 && y < 232) window.ccAnswerFromPreview(x >= 120); return true; }
    if (ccPage === 2) { if (L) for (let i = 0; i < Math.min(6, L.presets.length); i++) if (y >= 58 + i * 30 && y < 83 + i * 30) { launchHit = i; launchAt = performance.now(); window.ccLaunchFromPreview(i); } return true; }
    return ccPage === 1;
  };
  function ccPermCard(L) {
    const p = L.perm;
    R(0, 0, W, H, CC.bg); ccBox(8, 10, 224, 252, CC.o); R(20, 6, 74, 9, CC.bg); G('permission', 26, 7, 1, CC.o);
    ccPose('wave', 500); ccMascot(88, 24, 4);
    G('Claude wants to use', 63, 72, 1, CC.dim);
    G(p.tool, 120 - p.tool.length * 6, 86, 2, '#fff');
    let d = p.detail; for (let k = 0, y = 110; k < 4 && d; k++, y += 11) { let line = d.slice(0, 34); if (k === 3 && d.length > 34) line = line.slice(0, 31) + '...'; G(line, 120 - line.length * 3, y, 1, CC.text); d = d.slice(34); }
    if (p.project) { const t = 'in ' + p.project; G(t, 120 - t.length * 3, 160, 1, CC.dim); }
    ccBox(20, 186, 92, 40, CC.red); ccBox(128, 186, 92, 40, CC.green);
    G('deny', 42, 199, 2, CC.red); G('allow', 144, 199, 2, CC.green);
    G('or answer on your laptop', 48, 238, 1, CC.dim);
  }
  function claude() {
    const now = performance.now(), L = window.ccBridge && window.ccBridge();
    if (L && L.perm) return ccPermCard(L);
    cb.t += ((cb.big ? 1 : 0) - cb.t) * 0.22; if (Math.abs(cb.t - (cb.big ? 1 : 0)) < 0.02) cb.t = cb.big ? 1 : 0;
    if (cb.big && cb.t >= 1) return drawCcBig();
    if (!L) {
      if (!cc.script.length) ccPlan();
      const st = cc.script[cc.pos];
      if (cc.state === 'type') { if (!st || st.k !== 'user') { cc.state = 'think'; cc.at = now; } else if (now - cc.at > st.t.length * 55 + 500) { cc.log.push({ k: 'user', t: st.t }); cc.pos++; cc.state = 'think'; cc.at = now; } }
      else if (cc.state === 'think') { if (cc.pos >= cc.script.length) { cc.state = 'rest'; cc.at = now; ccPose('happy', 2200); } else if (now - cc.at > cc.script[cc.pos].think) { cc.state = 'stream'; cc.at = now; cc.log.push({ k: cc.script[cc.pos].k, t: '' }); } }
      else if (cc.state === 'stream') { const cur = cc.script[cc.pos], n = Math.min(cur.t.length, (now - cc.at) / 14 | 0); cc.log[cc.log.length - 1].t = cur.t.slice(0, n); if (n >= cur.t.length) { cc.pos++; cc.state = 'think'; cc.at = now; if (cc.pos < cc.script.length && cc.script[cc.pos].k !== 'res') cc.verb = Math.random() * 12 | 0; } }
      else if (now - cc.at > 5000) ccPlan();
      while (cc.log.length > 13) cc.log.shift();
    } else if (now - (cc.verbAt || 0) > 5000) { cc.verbAt = now; cc.verb = Math.random() * 12 | 0; }
    R(0, 0, W, H, CC.bg);
    ccTabs(!!L);
    if (ccPage === 1) return ccStatusPage(L);
    if (ccPage === 2) return ccLaunchPage(L);
    ccBox(12, 14, 216, 58, CC.o); ccMascot(21, 31, 3); ccStar(80, 25, 4, CC.o);
    G('Welcome to', 88, 22, 1, CC.text); G('Claude Code!', 88, 33, 1, '#fff');
    if (L) { G((L.session.model || 'claude').slice(0, 22), 80, 47, 1, CC.dim); G(('cwd: ' + (L.session.project || '?')).slice(0, 22), 80, 58, 1, CC.dim); }
    else { G('/help for help', 80, 47, 1, CC.dim); G('cwd: /larp/charm (demo)', 80, 58, 1, CC.dim); }
    const log = L ? L.log : cc.log;
    const thinking = L ? (L.state === 'thinking' || L.state === 'tool') : (cc.state === 'think' && cc.pos < cc.script.length);
    const rows = thinking ? 12 : 13, lines = log.slice(-rows);
    let yy = 80 + (rows - lines.length) * 11;
    lines.forEach((l, i) => {
      if (l.k === 'user') { G('>', 16, yy, 1, CC.dim); G(l.t.slice(0, 33), 28, yy, 1, CC.dim); }
      else if (l.k === 'text') { circle(19.5, yy + 3.5, 2, CC.text, true); G(l.t.slice(0, 33), 28, yy, 1, CC.text); }
      else if (l.k === 'tool') {
        const running = i === lines.length - 1 && (L ? L.state === 'tool' : (cc.state === 'stream' || (thinking && cc.script[cc.pos].k === 'res')));
        circle(19.5, yy + 3.5, 2, running && (now / 300 | 0) % 2 ? CC.dim : CC.green, true);
        const p = l.t.indexOf('('); if (p > 0) { G(l.t.slice(0, p), 28, yy, 1, '#fff'); G(l.t.slice(p, 33), 28 + p * 6, yy, 1, CC.dim); } else G(l.t.slice(0, 33), 28, yy, 1, '#fff');
      } else if (l.k === 'res' || l.k === 'err') {
        R(30, yy, 1, 4, CC.dim); R(30, yy + 4, 4, 1, CC.dim);
        if (l.k === 'err') G(l.t.slice(0, 31), 40, yy, 1, CC.red);
        else if (l.t[0] === '+') { const m = l.t.indexOf('-'); G(m > 0 ? l.t.slice(0, m) : l.t, 40, yy, 1, CC.green); if (m > 0) G(l.t.slice(m), 40 + m * 6, yy, 1, CC.red); } else G(l.t.slice(0, 31), 40, yy, 1, CC.dim);
      }
      yy += 11;
    });
    if (thinking) {
      const secs = (L ? L.elapsed + (now - (L.at || now)) / 1000 : (now - cc.at) / 1000) + 1 | 0;
      ccStar(19, yy + 3, (now / 120 | 0) % 6, CC.o);
      G((L && L.state === 'tool' ? `Running... (${secs}s, esc to stop)` : `${VERBS[cc.verb]}... (${secs}s, esc to stop)`).slice(0, 33), 28, yy, 1, CC.o);
    }
    ccBox(12, 232, 216, 22, L && L.state === 'waiting' ? CC.o : CC.dim); G('>', 20, 239, 1, CC.text);
    const cur = cc.script[cc.pos];
    if (!L && cc.state === 'type' && cur && cur.k === 'user') { const n = Math.min(cur.t.length, (now - cc.at) / 55 | 0); G(cur.t.slice(0, n), 32, 239, 1, CC.text); R(32 + n * 6, 238, 6, 9, CC.text); }
    else { G(!L ? 'Try "make the charm cuter"' : L.state === 'waiting' || L.state === 'done' ? 'your turn, on the laptop' : L.state === 'offline' ? 'session ended' : 'Claude is working...', 32, 239, 1, '#4c4c52'); if ((now / 500 | 0) % 2) R(32, 238, 1, 9, CC.text); }
    G(L ? CLN[L.state] : '? for shortcuts', 18, 260, 1, L && L.state === 'done' ? CC.green : CC.dim);
    if (cb.t > 0.01) drawCcPop(cb.t);
  }

  const scenes = { 0: clock, 1: text, 2: photo, 3: sing, 4: music, 5: pet, 6: toy, 7: card, 8: deck, 9: eyes, 10: jukeDeck, 11: torch, 12: chargeDeck, 13: tty, 14: claude };
  // Quest: frames rendered by the firmware itself (desktop simulator), packed in one sheet.
  // d00..d10 day village, n00..n10 night village, then the screens behind the doors.
  // ── tap a block to open it, tap again to go back ──
  let drag = null;
  cv.addEventListener('pointerdown', e => { drag = { x0: e.clientX, y0: e.clientY, moved: false }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} });
  cv.addEventListener('pointermove', e => {
    if (drag && (Math.abs(e.clientX - drag.x0) > 6 || Math.abs(e.clientY - drag.y0) > 6)) drag.moved = true;
  });
  cv.addEventListener('pointerup', e => {
    const d = drag; drag = null;
    if (d && !d.moved) tapAt(e);
    else if (d && ui.mode === 14 && !window.cbIsBig() && Math.abs(e.clientX - d.x0) > 24 && Math.abs(e.clientX - d.x0) > Math.abs(e.clientY - d.y0)) window.ccPageStep(e.clientX < d.x0 ? 1 : -1);
    else if (d && ui.mode === 14 && window.cbIsBig()) {                       // swipes for the popped-out critter
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (Math.abs(dy) > Math.abs(dx)) { if (dy > 24) window.cbClose(); else if (dy < -24) window.cbSwipe('up'); }
      else if (Math.abs(dx) > 24) window.cbSwipe(dx < 0 ? 'left' : 'right');
    }
  });
  cv.addEventListener('pointercancel', () => { drag = null; });
  function tapAt(e) {
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    if (ui.mode === 6 && ui.toy >= 3) return window.toyPreviewTap(x, y, performance.now());
    if (ui.mode === 13) { const n = performance.now(); window.ttyPoke(n - (tapAt.last || 0) < 350); tapAt.last = n; return; }   // poke the face
    if (ui.mode === 14) {
      const n = performance.now(), dbl = n - (tapAt.last || 0) < 350; tapAt.last = n;
      if (window.cbIsBig()) return window.cbTap(x, y, dbl);
      if (window.ccPreviewTap(x, y)) return;
      if (window.ccPageNow() === 0 && x >= 14 && x <= 74 && y >= 22 && y <= 68) return window.cbOpen();      // the little critter: pop it out
      return window.ccPoke();
    }
    if (ui.mode !== 8) return window.charmGoto(8);
    for (let i = 0; i < 12; i++) if (x >= TX[i] - 2 && x < TX[i] + TW[i] + 2 && y >= TY[i] - 2 && y < (i >= 5 ? H : TY[i] + TH[i] + 3)) return deckRun(i);
  }

  let shownMode = ui.mode, zoom = null;       // zoom: { ti, s, opening }
  function tick() {
    frame++;
    rx += (trx - rx) * 0.08; ry += (tryy - ry) * 0.08; tiltX = ry;
    if (!calm) rig.style.transform = `rotateX(${(-rx * 9).toFixed(2)}deg) rotateY(${(ry * 13).toFixed(2)}deg)`;
    const s = song(), [r, g, b] = rgb(val('mColor') || '#f472b6'), mx = Math.max(r, g, b);
    ACC = ui.playing && s.title && mx >= 40 ? `rgb(${r * 255 / mx | 0},${g * 255 / mx | 0},${b * 255 / mx | 0})` : THEMES[ui.theme] || THEMES[0];
    if (ACC[0] !== '#') ACC = '#' + ACC.match(/\d+/g).map(v => (+v).toString(16).padStart(2, '0')).join('');

    if (ui.mode !== shownMode && !zoom) {
      const opening = shownMode === 8, ti = TMODE.indexOf(opening ? ui.mode : shownMode);
      if (ti >= 0 && (opening || ui.mode === 8) && !calm) zoom = { ti, s: 0, opening, to: ui.mode }; else { shownMode = ui.mode; glitch = Math.max(glitch, 3); }
    }
    c.save(); c.globalAlpha = 1;
    try {
      if (zoom) {
        deck(); zoom.s++;
        let t = zoom.s / 7; t = 1 - (1 - t) * (1 - t); if (!zoom.opening) t = 1 - t;
        const i = zoom.ti, x = TX[i] * (1 - t), y = TY[i] * (1 - t), w = TW[i] + (W - TW[i]) * t, h = TH[i] + (H - TH[i]) * t;
        R(x, y, w, h, '#000'); c.strokeStyle = ACC; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
        if (zoom.s >= 7) { shownMode = zoom.to; zoom = null; glitch = Math.max(glitch, 3); }
      } else {
        {
          (scenes[shownMode] || deck)();
          if ([0, 5, 6, 7].includes(shownMode)) ticker();
        }
        if (![2, 3, 4, 11].includes(shownMode) && $('optFx').checked) { c.fillStyle = 'rgba(0,0,0,.22)'; for (let y = 1; y < H; y += 2) c.fillRect(0, y, W, 1); }
      }
    } catch (e) { /* one bad frame must not stop the preview */ }
    c.restore();
    if (glitch > 0) {
      glitch--;
      for (let k = 0; k < 5; k++) { const y = Math.random() * (H - 16) | 0, h = 2 + Math.random() * 12 | 0, off = (Math.random() * 56 - 28) | 0; c.drawImage(cv, 0, y, W, h, off, y, W, h); }
      R(0, Math.random() * H | 0, W, 1, ACC);
    } else if (shownMode === 8 && !calm && $('optFx').checked && Math.random() < 1 / 220) glitch = 2;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
