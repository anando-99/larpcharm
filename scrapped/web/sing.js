// Sing-along: the same show the charm plays, drawn in the browser.
// This is a line-by-line port of the firmware's sing-along renderer (pencil layer, kitten, scenes), drawing into a
// 240x280 RGB565 frame exactly like the charm, with the very same lettering bitmaps (sing-font.js).
// A show is { bpm, theme, hat, blips, ink: '#rrggbb', lines: [{ text, face, prop, scene, color: '#rrggbb' | null }] }.
(() => {
  const FACES = ['Happy', 'In love', 'Sad', 'Shy', 'Grumpy', 'Surprised', 'Excited', 'Dreamy', 'Singing', 'Cheeky'];
  const PROPS = ['Nothing', 'Gift', 'Heart', 'Star', 'Candy cane', 'Microphone'];
  const THEMES = ['Christmas', 'Love', 'Party', 'Plain'];
  const SCENES = ['Surprise me', 'Words round the kitten', 'Just words', 'Peekaboo', 'Kitten strolls by', 'One big word at a time', 'Hide and seek', 'Hop on the words', 'Speech bubble'];
  const F = { HAPPY: 0, LOVE: 1, SAD: 2, SHY: 3, GRUMPY: 4, SURPRISED: 5, EXCITED: 6, DREAMY: 7, SINGING: 8, CHEEKY: 9 };
  const P = { NONE: 0, GIFT: 1, HEART: 2, STAR: 3, CANE: 4, MIC: 5 };
  const SS = { AUTO: 0, RING: 1, WORDS: 2, PEEK: 3, STROLL: 4, BIG: 5, HIDE: 6, HOP: 7, BUBBLE: 8, COUNT: 9 };
  const ST = { XMAS: 0, LOVE: 1, PARTY: 2, PLAIN: 3 };
  const W = 240, H = 280, MAXW = 32;

  // ───── guessing a face and a prop from the words ─────
  const RULES = [
    [F.SAD, /\b(sad|cry|crying|tears?|alone|lonely|miss|missing|lost|sorry|goodbye|broken|blue)\b/],
    [F.GRUMPY, /\b(don'?t|not|no|won'?t|never|nothing|can'?t|stop|hate|without|nope)\b/],
    [F.LOVE, /\b(love|loving|you|mine|own|heart|kiss|darling|dear|baby|honey|forever|together|favourite|favorite)\b/],
    [F.SURPRISED, /\?|\b(oh|what|really|suddenly|surprise|whoa)\b/],
    [F.EXCITED, /!|\b(yay|wow|party|happy|merry|joy|fun|dance|best|hooray)\b/],
    [F.DREAMY, /\b(wish|dream|dreaming|hope|night|sleep|stars?|moon|someday|imagine|snow)\b/],
    [F.SHY, /\b(shy|blush|cute|smile|hold|hug|close|next to|sitting)\b/],
    [F.SINGING, /\b(sing|singing|song|la|music|melody|tune)\b/],
    [F.CHEEKY, /\b(hehe|lol|haha|silly|naughty|wink|cheeky)\b/],
  ];
  const PROP_RULES = [
    [P.GIFT, /\b(gifts?|presents?|toys?|box|wrap\w*|bows?)\b/],
    [P.HEART, /\b(love|heart|kiss|you|darling|baby|favourite|favorite)\b/],
    [P.STAR, /\b(stars?|wish\w*|night|sky|shine|bright|merry)\b/],
    [P.CANE, /\b(christmas|santa|candy|sweet|treats?|stocking|sleigh|tree|tinsel)\b/],
    [P.MIC, /\b(sing|singing|song|music|la)\b/],
  ];
  function guess(text, i){
    const t = ' ' + text.toLowerCase() + ' ';
    let face = -1, best = 0;
    for (const [f, re] of RULES) { const n = (t.match(new RegExp(re.source, 'g')) || []).length; if (n > best) { best = n; face = f; } }
    if (face < 0) face = i % 2 ? F.SINGING : F.HAPPY;
    let prop = P.NONE;
    for (const [p, re] of PROP_RULES) if (re.test(t)) { prop = p; break; }
    return { face, prop, scene: SS.AUTO, color: null };
  }
  // plain ASCII only (the charm's lettering has no other glyphs), lines of at most 64 characters
  function clean(s){
    return s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
            .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
  }
  function splitLines(raw){
    const out = [];
    for (const l of raw.split(/\r?\n/)) {
      let s = clean(l);
      while (s.length > 64) { let k = s.lastIndexOf(' ', 64); if (k < 20) k = 64; out.push(s.slice(0, k).trim()); s = s.slice(k).trim(); }
      if (s) out.push(s);
    }
    return out.slice(0, 24);
  }
  const c565 = (r, g, b) => ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
  const hex565 = h => { const n = parseInt((h || '#36343e').slice(1), 16); return c565(n >> 16 & 255, n >> 8 & 255, n & 255); };
  // version 2: "LSHW" 2 bpm theme flags n inkHi inkLo, then n x [face prop scene(|0x80 own colour) colHi colLo len text]
  function encode(show){
    const enc = new TextEncoder(), parts = [];
    let n = 11;
    for (const l of show.lines) { const b = enc.encode(l.text.slice(0, 64)); parts.push([l, b]); n += 6 + b.length; }
    const out = new Uint8Array(n), ink = hex565(show.ink);
    out.set([76, 83, 72, 87, 2, show.bpm, show.theme, (show.blips ? 1 : 0) | (show.hat ? 2 : 0), show.lines.length, ink >> 8, ink & 255]);
    let o = 11;
    for (const [l, b] of parts) {
      const col = l.color ? hex565(l.color) : ink;
      out.set([l.face, l.prop, (l.scene || 0) | (l.color ? 0x80 : 0), col >> 8, col & 255, b.length], o); o += 6;
      out.set(b, o); o += b.length;
    }
    return out;
  }

  // ───── the port ─────
  const r8 = c => ((c >> 11) & 0x1F) << 3, g8 = c => ((c >> 5) & 0x3F) << 2, b8 = c => (c & 0x1F) << 3;
  const mix565 = (a, b, t) => c565(r8(a) + Math.trunc((r8(b) - r8(a)) * t / 255), g8(a) + Math.trunc((g8(b) - g8(a)) * t / 255), b8(a) + Math.trunc((b8(b) - b8(a)) * t / 255));
  const COL_WHITE = 0xFFFF;
  const S_GRAPH = c565(54, 52, 62);
  const K_PINK = c565(240, 116, 158), K_RED = c565(222, 62, 72), K_BLUE = c565(92, 148, 228), K_YEL = c565(238, 182, 36), K_GRN = c565(64, 158, 92);
  const roundf = v => v < 0 ? -Math.round(-v) : Math.round(v);
  const imul = Math.imul;
  let sBoil = 0;
  function sHash(x){ x >>>= 0; x ^= x >>> 16; x = imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16; return x >>> 0; }
  const sJit = (a, b) => (sHash(a * 7919 + b * 104729 + sBoil * 31337) & 1023) / 511.5 - 1;
  const sHf = (a, b) => (sHash(a * 7919 + b * 104729) & 65535) / 65536;
  let sRs = 1;
  function sRf(){ sRs ^= sRs << 13; sRs >>>= 0; sRs ^= sRs >>> 17; sRs ^= sRs << 5; sRs >>>= 0; return (sRs >>> 8) / 16777216; }
  const sRr = (a, b) => a + (b - a) * sRf();
  function sFnv(s){ let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) & 255; h = imul(h, 16777619) >>> 0; } return h >>> 0; }
  const sClamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const sEase = p => { p = sClamp(p, 0, 1); return p * p * (3 - 2 * p); };
  const sinf = Math.sin, cosf = Math.cos, sqrtf = Math.sqrt, fabsf = Math.abs, fmodf = (a, b) => a % b, fminf = Math.min, fmaxf = Math.max;

  let FB = null, show = null;
  const sLayer = new Uint8Array(W * H), sGrain = new Uint8Array(64 * 64), sPaper = new Uint16Array(W * H);
  const SW_W = 360, SW_H = 100, sWord = new Uint8Array(SW_W * SW_H);
  let sPaperTheme = -1, sPaperCol = 0xFFFF;
  let sDx0 = W, sDy0 = H, sDx1 = -1, sDy1 = -1, sClipY = 9999, sMeasure = false, sMeasured = 0, sBudget = -1;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const h = sHash(x * 73 + y * 9187 + 11), h2 = sHash(((x + y) & 63) * 131 + (y >> 2) * 7 + 5);
    const v = 168 + (h & 63) + (h2 & 31) - (((h >>> 8) & 15) === 0 ? 60 : 0);
    sGrain[y * 64 + x] = sClamp(v, 90, 255);
  }

  function pSeg(x0, y0, x1, y1, w, a){
    let dx = x1 - x0, dy = y1 - y0; const L = sqrtf(dx * dx + dy * dy);
    if (sMeasure) { sMeasured += L + 0.5; return; }
    if (sBudget >= 0) {
      if (sBudget <= 0) return;
      const need = L + 0.5;
      if (need > sBudget) { const f = sBudget / need; x1 = x0 + dx * f; y1 = y0 + dy * f; dx = x1 - x0; dy = y1 - y0; }
      sBudget -= need; if (sBudget < 0) sBudget = 0;
    }
    if (w < 1) w = 1;
    const R = w * 0.5 + 0.5;
    let bx0 = Math.floor(fminf(x0, x1) - R), bx1 = Math.ceil(fmaxf(x0, x1) + R);
    let by0 = Math.floor(fminf(y0, y1) - R), by1 = Math.ceil(fmaxf(y0, y1) + R);
    if (bx0 < 0) bx0 = 0; if (by0 < 0) by0 = 0; if (bx1 > W - 1) bx1 = W - 1; if (by1 > H - 1) by1 = H - 1;
    if (by1 >= sClipY) by1 = Math.ceil(sClipY) - 1;
    if (bx0 > bx1 || by0 > by1) return;
    const L2 = dx * dx + dy * dy, inv = L2 > 1e-4 ? 1 / L2 : 0, R2 = R * R;
    for (let y = by0; y <= by1; y++) {
      const ro = y * W, py = y - y0;
      for (let x = bx0; x <= bx1; x++) {
        const px = x - x0; let t = (px * dx + py * dy) * inv;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const ex = px - t * dx, ey = py - t * dy, d2 = ex * ex + ey * ey;
        if (d2 >= R2) continue;
        let c = R - sqrtf(d2); if (c > 1) c = 1;
        const v = (c * a) | 0;
        if (v > sLayer[ro + x]) sLayer[ro + x] = v;
      }
    }
    if (bx0 < sDx0) sDx0 = bx0; if (bx1 > sDx1) sDx1 = bx1; if (by0 < sDy0) sDy0 = by0; if (by1 > sDy1) sDy1 = by1;
  }
  function pFlush(col, alpha){
    if (sDx1 < 0) return;
    for (let y = sDy0; y <= sDy1; y++) {
      const ro = y * W, go = (y & 63) << 6;
      for (let x = sDx0; x <= sDx1; x++) {
        let a = sLayer[ro + x];
        if (!a) continue;
        sLayer[ro + x] = 0;
        a = (a * sGrain[go + (x & 63)]) >> 8; a = (a * alpha) >> 8;
        if (a) FB[ro + x] = mix565(FB[ro + x], col, a);
      }
    }
    sDx0 = W; sDy0 = H; sDx1 = -1; sDy1 = -1;
  }
  function pFill(xs, ys, n, col){
    if (sMeasure || sBudget >= 0) return;
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < n; i++) { mn = fminf(mn, ys[i]); mx = fmaxf(mx, ys[i]); }
    let y0 = Math.ceil(mn), y1 = Math.floor(mx);
    if (y0 < 0) y0 = 0; if (y1 > H - 1) y1 = H - 1; if (y1 >= sClipY) y1 = Math.ceil(sClipY) - 1;
    for (let y = y0; y <= y1; y++) {
      const xv = [];
      for (let i = 0; i < n && xv.length < 16; i++) {
        const j = (i + 1) % n, ya = ys[i], yb = ys[j];
        if ((ya <= y && yb > y) || (yb <= y && ya > y)) xv.push(xs[i] + (y - ya) * (xs[j] - xs[i]) / (yb - ya));
      }
      xv.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xv.length; k += 2) {
        let xa = Math.ceil(xv[k]), xb = Math.floor(xv[k + 1]);
        if (xa < 0) xa = 0; if (xb > W - 1) xb = W - 1;
        for (let x = xa; x <= xb; x++) FB[y * W + x] = col;
      }
    }
  }
  function pHatch(xs, ys, n, gap, w, a, seed){
    const c = 0.7071, s = -0.7071;
    let vmn = 1e9, vmx = -1e9;
    for (let i = 0; i < n; i++) { const v = -xs[i] * s + ys[i] * c; vmn = fminf(vmn, v); vmx = fmaxf(vmx, v); }
    let k = 0;
    for (let v = vmn + gap * 0.5; v < vmx; v += gap, k++) {
      const uv = [];
      for (let i = 0; i < n && uv.length < 16; i++) {
        const j = (i + 1) % n, va = -xs[i] * s + ys[i] * c, vb = -xs[j] * s + ys[j] * c;
        if ((va <= v && vb > v) || (vb <= v && va > v)) {
          const f = (v - va) / (vb - va), x = xs[i] + (xs[j] - xs[i]) * f, y = ys[i] + (ys[j] - ys[i]) * f;
          uv.push(x * c + y * s);
        }
      }
      uv.sort((p, q) => p - q);
      for (let q = 0; q + 1 < uv.length; q += 2) {
        const u0 = uv[q] + 0.6 + sJit(seed, k) * 0.7, u1 = uv[q + 1] - 0.6 + sJit(seed + 1, k) * 0.7;
        if (u1 <= u0) continue;
        pSeg(u0 * c - v * s, u0 * s + v * c, u1 * c - v * s, u1 * s + v * c, w, a);
      }
    }
  }

  // ───── the kitten's frame ─────
  let kTx = 120, kTy = 200, kC = 1, kS = 0, kSc = 1, kFlip = false, kOx = 0, kOy = 0, kHc = 1, kHs = 0;
  function kSub(ox, oy, ang){ kOx = ox; kOy = oy; kHc = cosf(ang); kHs = sinf(ang); }
  function kP(x, y){
    let lx = kOx + x * kHc - y * kHs; const ly = kOy + x * kHs + y * kHc;
    if (kFlip) lx = -lx;
    return [kTx + (lx * kC - ly * kS) * kSc, kTy + (lx * kS + ly * kC) * kSc];
  }
  function kLine(x0, y0, x1, y1, w, a){ const [X0, Y0] = kP(x0, y0), [X1, Y1] = kP(x1, y1); pSeg(X0, Y0, X1, Y1, w * kSc, a); }
  function kDot(x, y, r, a){ const [X, Y] = kP(x, y); pSeg(X, Y, X, Y, 2 * r * kSc, a); }
  function kArc(cx, cy, rx, ry, a0, sweep, w, a, seed){
    let n = Math.trunc(fabsf(sweep) * fmaxf(rx, ry) * kSc / 3.2); if (n < 4) n = 4; if (n > 40) n = 40;
    let px = 0, py = 0;
    for (let i = 0; i <= n; i++) {
      const t = a0 + sweep * i / n, j = 1 + 0.045 * sJit(seed, i % 40);
      const x = cx + cosf(t) * rx * j, y = cy + sinf(t) * ry * j;
      if (i) kLine(px, py, x, y, w, a);
      px = x; py = y;
    }
  }
  function kLoop(cx, cy, rx, ry, w, seed){ kArc(cx, cy, rx, ry, sHf(seed, 1) * 6.2832, 6.2832 + 0.42, w, 235, seed); }
  function kPoly(lx, ly, n){ const X = [], Y = []; for (let i = 0; i < n; i++) { const [a, b] = kP(lx[i], ly[i]); X.push(a); Y.push(b); } return [X, Y]; }
  function kFillEll(cx, cy, rx, ry){ const X = [], Y = []; for (let i = 0; i < 16; i++) { const t = i * 0.3927, [a, b] = kP(cx + cosf(t) * rx, cy + sinf(t) * ry); X.push(a); Y.push(b); } pFill(X, Y, 16, sPaperCol); }
  function kHatchEll(cx, cy, rx, ry, gap, a, seed){ const X = [], Y = []; for (let i = 0; i < 12; i++) { const t = i * 0.5236, [p, q] = kP(cx + cosf(t) * rx, cy + sinf(t) * ry); X.push(p); Y.push(q); } pHatch(X, Y, 12, gap, 1.15, a, seed); }
  function kBez(x0, y0, x1, y1, x2, y2, x3, y3, w0, w1, n){
    let px = x0, py = y0;
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
      const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
      kLine(px, py, x, y, w0 + (w1 - w0) * t, 235);
      px = x; py = y;
    }
  }
  function kHeartPts(x, y, r){
    const lx = [], ly = [];
    for (let i = 0; i < 12; i++) {
      const t = i * 0.5236, hx = 16 * Math.pow(sinf(t), 3), hy = -(13 * cosf(t) - 5 * cosf(2 * t) - 2 * cosf(3 * t) - cosf(4 * t));
      lx.push(x + hx * r / 16); ly.push(y + hy * r / 16);
    }
    return [lx, ly];
  }
  function kHeart(x, y, r, col, alpha, seed){
    const [lx, ly] = kHeartPts(x, y, r), [X, Y] = kPoly(lx, ly, 12);
    pHatch(X, Y, 12, 2.0, 1.2, 230, seed); pFlush(col, alpha);
    for (let i = 0; i < 12; i++) kLine(lx[i], ly[i], lx[(i + 1) % 12], ly[(i + 1) % 12], 1.4, 235);
    pFlush(col, alpha);
  }
  function kStar(x, y, r, spin, col, alpha, seed){
    const lx = [], ly = [];
    for (let i = 0; i < 10; i++) { const a = spin - 1.5708 + i * 0.6283, rr = (i & 1) ? r * 0.45 : r; lx.push(x + cosf(a) * rr); ly.push(y + sinf(a) * rr); }
    const [X, Y] = kPoly(lx, ly, 10);
    pHatch(X, Y, 10, 1.8, 1.2, 230, seed); pFlush(col, alpha);
    for (let i = 0; i < 10; i++) kLine(lx[i], ly[i], lx[(i + 1) % 10], ly[(i + 1) % 10], 1.3, 235);
    pFlush(mix565(col, S_GRAPH, 110), alpha);
  }
  function kSpark(x, y, r, col, alpha){
    kLine(x - r, y, x + r, y, 1.3, 235); kLine(x, y - r, x, y + r, 1.3, 235);
    kLine(x - r * 0.45, y - r * 0.45, x + r * 0.45, y + r * 0.45, 1.0, 200); kLine(x - r * 0.45, y + r * 0.45, x + r * 0.45, y - r * 0.45, 1.0, 200);
    pFlush(col, alpha);
  }
  function caneP(x, y, i){
    if (i <= 5) return [x + 3, y + 13 - i * 4.4];
    const a = 3.1416 * (i - 5) / 5; return [x - 1.4 + cosf(a) * 4.4, y - 9 - sinf(a) * 4.4];
  }
  function kProp(p, x, y, t){
    switch (p) {
      case P.GIFT: {
        const r = sinf(t * 2) * 0.08, lx = [], ly = [];
        for (let i = 0; i < 4; i++) { const a = r + 0.7854 + i * 1.5708; lx.push(x + cosf(a) * 9.5); ly.push(y + sinf(a) * 9.5); }
        const [X, Y] = kPoly(lx, ly, 4); pFill(X, Y, 4, sPaperCol);
        pHatch(X, Y, 4, 2.0, 1.2, 230, 501); pFlush(K_RED, 255);
        for (let i = 0; i < 4; i++) kLine(lx[i], ly[i], lx[(i + 1) % 4], ly[(i + 1) % 4], 1.5, 235);
        kLine((lx[0] + lx[1]) / 2, (ly[0] + ly[1]) / 2, (lx[2] + lx[3]) / 2, (ly[2] + ly[3]) / 2, 2.2, 235);
        kLine((lx[1] + lx[2]) / 2, (ly[1] + ly[2]) / 2, (lx[3] + lx[0]) / 2, (ly[3] + ly[0]) / 2, 2.2, 235);
        const bx = (lx[2] + lx[3]) / 2, by = (ly[2] + ly[3]) / 2;
        kArc(bx - 3.5, by - 3, 3.5, 2.6, 0, 6.2832, 1.3, 235, 502); kArc(bx + 3.5, by - 3, 3.5, 2.6, 0, 6.2832, 1.3, 235, 503);
        pFlush(S_GRAPH, 255);
        break;
      }
      case P.HEART: kHeart(x, y, 9 + sinf(t * 8) * 1.0, K_PINK, 255, 504); break;
      case P.STAR: kStar(x, y, 10, sinf(t * 3) * 0.3, K_YEL, 255, 505); break;
      case P.CANE: {
        let px = x + 3, py = y + 13;
        for (let i = 1; i <= 10; i++) { const [qx, qy] = caneP(x, y, i); if (i % 2) kLine(px, py, qx, qy, 3.4, 240); px = qx; py = qy; }
        pFlush(K_RED, 255);
        px = x + 3; py = y + 13;
        for (let i = 1; i <= 10; i++) {
          const [qx, qy] = caneP(x, y, i);
          let nx = -(qy - py), ny = qx - px; const nl = sqrtf(nx * nx + ny * ny) + 1e-3; nx = nx / nl * 2.2; ny = ny / nl * 2.2;
          kLine(px + nx, py + ny, qx + nx, qy + ny, 1.0, 220); kLine(px - nx, py - ny, qx - nx, qy - ny, 1.0, 220);
          px = qx; py = qy;
        }
        pFlush(S_GRAPH, 255);
        break;
      }
      case P.MIC:
        kLine(x, y + 3, x - 2, y + 15, 2.8, 240);
        kArc(x, y - 2, 4.8, 4.8, 0, 6.2832, 1.5, 235, 506);
        kLine(x - 3.5, y - 3, x + 3.5, y - 3, 1.0, 170); kLine(x - 3.5, y - 0.5, x + 3.5, y - 0.5, 1.0, 170); kLine(x, y - 6, x, y + 2, 1.0, 170);
        pFlush(S_GRAPH, 255);
        break;
    }
  }
  function kHat(t){
    if (show.theme === ST.PARTY) {
      const lx = [-9, 8, 1 + sinf(t * 2) * 2], ly = [-11, -13, -33], [X, Y] = kPoly(lx, ly, 3);
      pFill(X, Y, 3, sPaperCol);
      pHatch(X, Y, 3, 2.2, 1.2, 220, 611); pFlush(K_BLUE, 255);
      for (let k = 1; k < 4; k++) { const f = k / 4; kLine(lx[0] + (lx[2] - lx[0]) * f, ly[0] + (ly[2] - ly[0]) * f, lx[1] + (lx[2] - lx[1]) * f, ly[1] + (ly[2] - ly[1]) * f, 1.6, 230); }
      pFlush(K_YEL, 255);
      kLine(lx[0], ly[0], lx[2], ly[2], 1.5, 235); kLine(lx[1], ly[1], lx[2], ly[2], 1.5, 235); kLine(lx[0], ly[0], lx[1], ly[1], 1.3, 235);
      pFlush(S_GRAPH, 255);
      kHatchEll(lx[2], ly[2] - 1, 3, 3, 1.5, 230, 612); pFlush(K_PINK, 255);
      return;
    }
    const flop = sinf(t * 2.2) * 2;
    const lx = [-14, -4, 9, 18 + flop, 12], ly = [-9, -26, -27, -18 + flop * 0.5, -12], [X, Y] = kPoly(lx, ly, 5);
    pFill(X, Y, 5, sPaperCol);
    pHatch(X, Y, 5, 1.9, 1.2, 235, 613); pFlush(K_RED, 255);
    for (let i = 0; i < 4; i++) kLine(lx[i], ly[i], lx[i + 1], ly[i + 1], 1.5, 235);
    const bx = [-16, 14, 14, -16], by = [-13.5, -16, -9.5, -7], [BX, BY] = kPoly(bx, by, 4);
    pFill(BX, BY, 4, sPaperCol);
    for (let i = 0; i < 4; i++) kLine(bx[i], by[i], bx[(i + 1) % 4], by[(i + 1) % 4], 1.4, 225);
    kFillEll(lx[3] + 1, ly[3] + 2, 3.8, 3.8);
    kArc(lx[3] + 1, ly[3] + 2, 3.8, 3.8, 0, 6.6, 1.4, 225, 614);
    pFlush(S_GRAPH, 255);
  }

  const K_SIT = 0, K_WALK = 1, K_JUMP = 2, K_PEEK = 3;
  function kitten(face, prop, pose, t, beatPh, talk, u){
    const G = S_GRAPH;
    kSub(0, 0, 0);
    const sq = Math.pow(1 - sClamp(beatPh, 0, 1), 3);
    const blink = fmodf(t + 0.37 * u, 3.3) < 0.14;
    const tailSw = face === F.GRUMPY ? sinf(t * 9) * 4 : face === F.DREAMY ? sinf(t * 1.2) * 6 : sinf(t * 2.6) * 5;
    let headX = 0, headY = -36, tilt = 0;
    const propHeld = prop !== P.NONE && pose !== K_WALK && pose !== K_PEEK;
    const pawCheek = face === F.SHY && pose === K_SIT;
    if (pose === K_SIT) {
      const bry = 12 * (1 - 0.07 * sq), brx = 12.5 * (1 + 0.07 * sq);
      kBez(9, -4, 24, -3, 27 + tailSw * 0.3, -18, 19 + tailSw, -27, 2.8, 2.0, 8);
      pFlush(G, 255);
      kFillEll(0, -bry, brx, bry);
      kLoop(0, -bry, brx, bry, 1.7, 720);
      kFillEll(-5, -2.2, 4, 2.7); kArc(-5, -2.2, 4, 2.7, 3.3, 3.4, 1.5, 235, 721);
      if (!propHeld) { kFillEll(5, -2.2, 4, 2.7); kArc(5, -2.2, 4, 2.7, 3.3, 3.4, 1.5, 235, 722); }
      pFlush(G, 255);
      headY = -2 * bry - 11;
      tilt = face === F.DREAMY ? sinf(t * 1.6) * 0.16 : face === F.SHY ? -0.12 + sinf(t * 2) * 0.04 : sinf(beatPh * 3.1416) * 0.07 * (Math.trunc(u) % 2 ? 1 : -1);
    } else if (pose === K_WALK) {
      const step = t * 9;
      kBez(-14, -14, -24, -16, -27 + tailSw * 0.3, -26, -22 + tailSw * 0.6, -34, 2.6, 2.0, 8);
      pFlush(G, 255);
      for (let k = 0; k < 4; k++) { const lx = -9 + k * 6, sw = sinf(step + (k % 2) * 3.1416) * 3; kLine(lx, -8, lx + sw, -0.8, 2.0, 235); }
      pFlush(G, 255);
      kFillEll(0, -13, 16, 9.5);
      kLoop(0, -13, 16, 9.5, 1.7, 723);
      pFlush(G, 255);
      headX = 13; headY = -28; tilt = sinf(step) * 0.05;
    } else if (pose === K_PEEK) {
      tilt = sinf(t * 2) * 0.09;
    } else if (pose === K_JUMP) {
      kBez(8, -12, 20, -8, 26 + tailSw * 0.4, -22, 20 + tailSw, -32, 2.6, 2.0, 8);
      pFlush(G, 255);
      kFillEll(-5, -2, 3.4, 3); kArc(-5, -2, 3.4, 3, 0, 6.6, 1.4, 235, 724);
      kFillEll(5, -2, 3.4, 3); kArc(5, -2, 3.4, 3, 0, 6.6, 1.4, 235, 725);
      kFillEll(0, -15, 11, 14);
      kLoop(0, -15, 11, 14, 1.7, 726);
      kLine(-8, -22, -15, -34, 2.0, 235); kDot(-15.5, -35, 2.2, 235);
      if (!propHeld) { kLine(8, -22, 15, -34, 2.0, 235); kDot(15.5, -35, 2.2, 235); }
      pFlush(G, 255);
      headY = -41;
    }
    kSub(headX, headY, tilt);
    let earSp = 0, earL = 1;
    if (face === F.SAD) { earSp = 0.55; earL = 0.85; }
    else if (face === F.GRUMPY) { earSp = 0.42; earL = 0.85; }
    else if (face === F.SURPRISED) { earSp = -0.08; earL = 1.15; }
    else if (face === F.EXCITED) earSp = sinf(t * 14) * 0.1;
    const twitch = fmodf(t, 4.1) < 0.18 ? 0.22 : 0;
    const ex = [[], []], ey = [[], []];
    for (let e = 0; e < 2; e++) {
      const s = e ? 1 : -1, b1x = s * 14.5, b1y = -5.5, b2x = s * 4.5, b2y = -12.8, mx = (b1x + b2x) / 2, my = (b1y + b2y) / 2;
      const tx = s * 14, ty = -24 * earL, a = s * (earSp + (e ? twitch : 0)), ca = cosf(a), sa = sinf(a), rx = tx - mx, ry = ty - my;
      ex[e] = [b1x, mx + rx * ca - ry * sa, b2x]; ey[e] = [b1y, my + rx * sa + ry * ca, b2y];
    }
    kFillEll(0, 0, 17, 14);
    for (let e = 0; e < 2; e++) { const [X, Y] = kPoly(ex[e], ey[e], 3); pFill(X, Y, 3, sPaperCol); }
    for (let e = 0; e < 2; e++) {
      const cx = (ex[e][0] + ex[e][1] + ex[e][2]) / 3, cy = (ey[e][0] + ey[e][1] + ey[e][2]) / 3, lx = [], ly = [];
      for (let k = 0; k < 3; k++) { lx.push(cx + (ex[e][k] - cx) * 0.55); ly.push(cy + (ey[e][k] - cy) * 0.55 + 1); }
      const [X, Y] = kPoly(lx, ly, 3); pHatch(X, Y, 3, 1.7, 1.0, 200, 730 + e);
    }
    const bigBlush = face === F.SHY || face === F.LOVE;
    if (face !== F.GRUMPY) for (let s = -1; s <= 1; s += 2) kHatchEll(s * 10.5, 4.8, bigBlush ? 3.6 : 2.8, bigBlush ? 2.4 : 1.8, 1.5, bigBlush ? 230 : 170, 740 + s);
    if (face === F.LOVE) for (let s = -1; s <= 1; s += 2) { const [lx, ly] = kHeartPts(s * 6.5, -0.5, 3.6 + sinf(t * 10) * 0.4), [X, Y] = kPoly(lx, ly, 12); pHatch(X, Y, 12, 1.3, 1.0, 240, 745 + s); }
    pFlush(K_PINK, 255);
    kLoop(0, 0, 17, 14, 1.8, 750);
    for (let e = 0; e < 2; e++) { kLine(ex[e][0], ey[e][0], ex[e][1], ey[e][1], 1.7, 235); kLine(ex[e][1], ey[e][1], ex[e][2], ey[e][2], 1.7, 235); }
    for (let s = -1; s <= 1; s += 2) { kLine(s * 11.5, 2.5, s * 20, 0.8, 1.05, 200); kLine(s * 11.5, 5, s * 19.5, 6.8, 1.05, 200); }
    const EX = 6.5;
    switch (face) {
      case F.LOVE: for (let s = -1; s <= 1; s += 2) { const [lx, ly] = kHeartPts(s * EX, -0.5, 3.6 + sinf(t * 10) * 0.4); for (let i = 0; i < 12; i++) kLine(lx[i], ly[i], lx[(i + 1) % 12], ly[(i + 1) % 12], 1.1, 230); } break;
      case F.SHY: case F.SINGING:
        for (let s = -1; s <= 1; s += 2) kArc(s * EX, 1, 2.8, 2.4, 3.5, 2.4, 1.6, 235, 760 + s);
        if (face === F.SHY) for (let s = -1; s <= 1; s += 2) for (let k = 0; k < 3; k++) kLine(s * 9 + k * 1.8 - 1, 3.4, s * 9 + k * 1.8 - 2.2, 6.2, 0.9, 170);
        break;
      case F.DREAMY: for (let s = -1; s <= 1; s += 2) kArc(s * EX, -0.5, 2.8, 2.2, 0.3, 2.5, 1.6, 235, 762 + s); break;
      case F.SURPRISED: for (let s = -1; s <= 1; s += 2) { kArc(s * EX, -0.5, 3.6, 3.9, 0, 6.6, 1.4, 235, 764 + s); kDot(s * EX + 0.4, 0, 1.5, 240); } break;
      case F.EXCITED: for (let s = -1; s <= 1; s += 2) { const x = s * EX; kLine(x - s * 2.8, -3, x + s * 2, -0.3, 1.6, 235); kLine(x + s * 2, -0.3, x - s * 2.8, 2.4, 1.6, 235); } break;
      case F.GRUMPY: for (let s = -1; s <= 1; s += 2) { kLine(s * 3, -3.4, s * 10, -1.2, 1.5, 235); if (!blink) kDot(s * EX, 1, 1.5, 240); } break;
      case F.CHEEKY:
        if (blink) kLine(-EX - 2, 0, -EX + 2, 0, 1.5, 235); else kDot(-EX, 0, 1.9, 240);
        kLine(EX - 2.6, -2.4, EX + 2.2, 0, 1.5, 235); kLine(EX + 2.2, 0, EX - 2.6, 2.2, 1.5, 235);
        break;
      default:
        for (let s = -1; s <= 1; s += 2) {
          const yy = face === F.SAD ? 1 : 0;
          if (blink) kLine(s * EX - 2.2, yy, s * EX + 2.2, yy, 1.5, 235); else kDot(s * EX, yy, 1.9, 240);
          if (face === F.SAD) kLine(s * 3.4, -4.6, s * 9.6, -3.1, 1.3, 225);
        }
        break;
    }
    const my = 5;
    switch (face) {
      case F.SAD:
        if (talk > 0.25) kArc(0, my + 2.6, 1.8, 1.2 + talk * 1.4, 0, 6.6, 1.3, 235, 770);
        else kArc(0, my + 4.2, 3, 2.2, 3.5, 2.4, 1.4, 235, 771);
        break;
      case F.GRUMPY: kLine(-3.2, my + 2.6, -1, my + 1.6, 1.3, 235); kLine(-1, my + 1.6, 1, my + 2.6, 1.3, 235); kLine(1, my + 2.6, 3.2, my + 1.6, 1.3, 235); break;
      case F.SURPRISED: kArc(0, my + 3, 2 + talk * 0.6, 2.4 + talk * 1.2, 0, 6.6, 1.3, 235, 772); break;
      case F.EXCITED: case F.SINGING: {
        const h = 2.4 + talk * 2.2 + (face === F.SINGING ? 1 : 0);
        kArc(0, my + 1.2, 3.2, h, 0, 3.1416, 1.4, 235, 773); kLine(-3.2, my + 1.2, 3.2, my + 1.2, 1.3, 235);
        break;
      }
      case F.DREAMY: kArc(0, my + 2.2, 1.2, 1 + talk, 0, 6.6, 1.2, 225, 774); break;
      default:
        kArc(-1.6, my, 1.6, 1.7, 0.2, 2.7, 1.3, 235, 775); kArc(1.6, my, 1.6, 1.7, 0.2, 2.7, 1.3, 235, 776);
        if (talk > 0.25) kArc(0, my + 3.4, 1.6, 0.8 + talk * 1.6, 0, 6.6, 1.2, 235, 777);
        break;
    }
    pFlush(G, 255);
    if (face === F.CHEEKY) { kHatchEll(1.2, my + 4.2, 1.8, 2.2, 1.1, 240, 778); pFlush(K_PINK, 255); kArc(1.2, my + 4.2, 1.8, 2.2, 0, 3.4, 1.1, 225, 779); pFlush(G, 255); }
    if (show.hat && (show.theme === ST.XMAS || show.theme === ST.PARTY) && fabsf(kS) < 0.5 && kC > 0) kHat(t);
    kSub(0, 0, 0);
    if (pose === K_PEEK) {
      for (let s = -1; s <= 1; s += 2) { kFillEll(s * 9.5, -20, 4.4, 3.1); kArc(s * 9.5, -20, 4.4, 3.1, 0, 6.6, 1.5, 235, 790 + s); kLine(s * 9.5 - 1, -18.5, s * 9.5 - 1, -17.2, 1.0, 200); kLine(s * 9.5 + 1.2, -18.5, s * 9.5 + 1.2, -17.2, 1.0, 200); }
      pFlush(G, 255);
    } else if (pose === K_SIT && pawCheek) {
      kFillEll(-11, headY + 6, 3.6, 3); kArc(-11, headY + 6, 3.6, 3, 0, 6.6, 1.4, 235, 792); pFlush(G, 255);
    }
    if (propHeld) {
      const px = pose === K_JUMP ? 17 : 13, py = pose === K_JUMP ? -36 : -17 - sinf(beatPh * 3.1416) * 3;
      kProp(prop, px + 6, py - 9, t);
      kFillEll(px, py, 3.8, 3); kArc(px, py, 3.8, 3, 0, 6.6, 1.4, 235, 793); pFlush(G, 255);
    }
    kSub(headX, headY, 0);
    switch (face) {
      case F.LOVE: for (let i = 0; i < 2; i++) { const p = fmodf(t * 0.55 + i * 0.5, 1); kHeart(16 + i * 6 + sinf(t * 3 + i) * 3, -14 - p * 34, 3.4, K_PINK, (255 * (1 - p)) | 0, 800 + i); } break;
      case F.SAD: for (let s = -1; s <= 1; s += 2) { const p = fmodf(t * 1.1 + (s > 0 ? 0.5 : 0), 1); kHatchEll(s * 7.5, 4 + p * 10, 1.4, 2.0, 1.0, 250, 805 + s); kArc(s * 7.5, 4 + p * 10, 1.4, 2.0, 0, 6.6, 0.9, 220, 807 + s); pFlush(K_BLUE, (255 * (1 - p * 0.7)) | 0); } break;
      case F.GRUMPY: for (let k = 0; k < 4; k++) { const a = k * 1.5708 + 0.785; kArc(17 + cosf(a) * 3.4, -14 + sinf(a) * 3.4, 2.2, 2.2, a + 2.4, 1.6, 1.4, 235, 810 + k); } pFlush(K_RED, 255); break;
      case F.SURPRISED: { const j = sinf(t * 20) * 0.6; kLine(22 + j, -24, 21 + j, -13, 2.2, 240); kDot(20.6 + j, -8.5, 1.6, 240); pFlush(K_RED, 255); break; }
      case F.EXCITED: { const SX = [-26, 27, 22], SY = [-8, -16, 8]; for (let k = 0; k < 3; k++) { const p = 0.55 + 0.45 * sinf(t * 6 + k * 2.1); kSpark(SX[k], SY[k], 3.4 * p, K_YEL, 255); } break; }
      case F.DREAMY: for (let i = 0; i < 2; i++) {
          const p = fmodf(t * 0.4 + i * 0.5, 1), x = 17 + p * 12, y = -14 - p * 26, r = 2.4 + p * 1.6;
          kLine(x - r, y - r, x + r, y - r, 1.2, 230); kLine(x + r, y - r, x - r, y + r, 1.2, 230); kLine(x - r, y + r, x + r, y + r, 1.2, 230);
          pFlush(S_GRAPH, (255 * (1 - p)) | 0);
        } break;
      case F.SINGING: for (let i = 0; i < 2; i++) {
          const p = fmodf(t * 0.6 + i * 0.5, 1), x = 20 + i * 8 + sinf(t * 4 + i) * 2, y = -8 - p * 30;
          kDot(x, y, 2, 240); kLine(x + 1.8, y, x + 1.8, y - 9, 1.2, 235); kLine(x + 1.8, y - 9, x + 5.5, y - 6.5, 1.2, 235);
          pFlush(S_GRAPH, (255 * (1 - p)) | 0);
        } break;
      case F.CHEEKY: { const p = 0.5 + 0.5 * sinf(t * 5); kSpark(19, -10, 2.4 * p + 0.8, K_YEL, 255); break; }
    }
    kSub(0, 0, 0);
  }
  function kittenDraw(face, prop, pose, t, beatPh, talk, u, reveal){
    if (reveal <= 0.01) return;
    if (reveal < 0.999) { sMeasure = true; sMeasured = 0; kitten(face, prop, pose, t, beatPh, talk, u); sMeasure = false; sBudget = sMeasured * reveal; }
    kitten(face, prop, pose, t, beatPh, talk, u);
    sBudget = -1;
  }

  // ───── words ─────
  const SP_MPX = 30, SP_LPX = 44;
  const FONTS = [null, null];
  function fontLoad(){
    if (FONTS[0]) return;
    ['P_M', 'P_L'].forEach((k, i) => {
      const f = window.SING_FONTS[k], bin = atob(f.bmp), bmp = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) bmp[j] = bin.charCodeAt(j);
      const g = f.glyphs.map(a => ({ off: a[0], w: a[1], h: a[2], dx: a[3], dy: a[4], adv: a[5] }));
      FONTS[i] = { first: f.first, last: f.last, bmp, g };
    });
    for (let fi = 0; fi < 2; fi++) {
      const Fn = FONTS[fi], Hg = glyph(Fn, 'H'), gg = glyph(Fn, 'g');
      sCapH[fi] = -Hg.dy; sDesc[fi] = gg.dy + gg.h;
      let mn = 0, mx = 0;
      for (const q of Fn.g) { if (!q.w) continue; mn = Math.min(mn, q.dy); mx = Math.max(mx, q.dy + q.h); }
      sTop[fi] = mn; sBot[fi] = mx;
    }
  }
  const sCapH = [0, 0], sDesc = [0, 0], sTop = [0, 0], sBot = [0, 0];
  function glyph(Fn, ch){ let c = ch.charCodeAt(0); if (c < Fn.first || c > Fn.last) c = 63; return Fn.g[c - Fn.first]; }
  const pFi = sz => sz >= 36 ? 1 : 0, pPx = sz => sz >= 36 ? SP_LPX : SP_MPX;
  function pAdv(Fn, s){ let w = 0; for (const ch of s) w += glyph(Fn, ch).adv; return w; }

  let lays = [], laysKey = '', sL = null, sTxt = '';
  const wW = (i, sz) => pAdv(FONTS[pFi(sz)], sTxt.substr(sL.w[i].st, sL.w[i].len)) * sz / pPx(sz);
  const rowH = sz => { const f = pFi(sz); return (sCapH[f] + sDesc[f] * 0.55) * sz / pPx(sz) + sz * 0.16; };
  const capOf = sz => sCapH[pFi(sz)] * sz / pPx(sz);

  function flowBlock(bx0, by0, bx1, by1, maxSz, minSz, ang, jitA, jitXY, extraRow){
    const nw = sL.nw;
    for (let sz = maxSz; sz >= minSz - 0.01; sz -= 2) {
      const gap = sz * 0.3, rh = rowH(sz) + extraRow, bw = bx1 - bx0;
      let x = 0, row = 0, ok = true; const rowW = [], rowOf = [];
      for (let i = 0; i < nw; i++) {
        const w = wW(i, sz);
        if (w > bw) { ok = false; break; }
        if (x > 0 && x + gap + w > bw) { row++; x = 0; }
        rowOf[i] = row; x += (x > 0 ? gap : 0) + w; rowW[row] = x;
      }
      if (!ok) continue;
      const rows = row + 1, th = rows * rh - extraRow;
      if (th > by1 - by0) continue;
      const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, y0 = cy - th / 2 + (rh - extraRow) / 2, xs = [];
      for (let r = 0; r < rows; r++) xs[r] = cx - rowW[r] / 2;
      const ca = cosf(ang), sa = sinf(ang); let mnx = 999, mxx = -999;
      for (let i = 0; i < nw; i++) {
        const r = rowOf[i], w = wW(i, sz), x = xs[r] + w / 2, y = y0 + r * rh;
        xs[r] += w + gap;
        mnx = fminf(mnx, x - w / 2); mxx = fmaxf(mxx, x + w / 2);
        const dx = x - cx, dy = y - cy, Wd = sL.w[i];
        Wd.x = cx + dx * ca - dy * sa + sRr(-jitXY, jitXY);
        Wd.y = cy + dx * sa + dy * ca + sRr(-jitXY, jitXY);
        Wd.ang = ang + sRr(-jitA, jitA); Wd.sz = sz;
      }
      sL.rows = rows; sL.top = y0 - capOf(sz) / 2;
      sL.bub = [mnx, sL.top, mxx, y0 + (rows - 1) * rh + capOf(sz) / 2 + sDesc[pFi(sz)] * sz / pPx(sz) * 0.5];
      return sz;
    }
    return 0;
  }
  function ringLayout(cx, cy, rx, ry, T){
    const nw = sL.nw;
    for (let sz = 40; sz >= 22; sz -= 2) {
      const gap = sz * 0.3; let need = 0;
      for (let i = 0; i < nw; i++) need += wW(i, sz) + (i ? gap : 0);
      const dt = 0.02, half = need / 2; let acc = 0, th = -1.5708;
      let ds = 0;
      while (acc < half && th > -1.5708 - 2.5) { th -= dt; ds = dt * sqrtf(rx * rx * sinf(th) * sinf(th) + ry * ry * cosf(th) * cosf(th)); acc += ds; }
      if (acc < half) continue;
      th += dt * (acc - half) / ds;
      let pos = 0, fits = true;
      for (let i = 0; i < nw; i++) {
        const w = wW(i, sz), target = pos + w / 2; let a = th, s = 0;
        let st = 0;
        while (s < target) { a += dt; st = dt * sqrtf(rx * rx * sinf(a) * sinf(a) + ry * ry * cosf(a) * cosf(a)); s += st; }
        if (st > 0) a -= dt * (s - target) / st;
        const Wd = sL.w[i];
        Wd.x = cx + cosf(a) * rx; Wd.y = cy + sinf(a) * ry;
        Wd.ang = sClamp(Math.atan2(ry * cosf(a), -rx * sinf(a)), -1, 1);
        Wd.sz = sz;
        const ex = fabsf(cosf(Wd.ang)) * w / 2 + fabsf(sinf(Wd.ang)) * sz * 0.4;
        if (Wd.x - ex < 2 || Wd.x + ex > W - 2 || Wd.y < T + 6 || Wd.y > 262) fits = false;
        pos += w + gap;
      }
      if (fits) return true;
    }
    return false;
  }
  function sSplit(text){
    const w = [];
    for (let i = 0; i < text.length && w.length < MAXW;) {
      while (text[i] === ' ') i++;
      if (i >= text.length) break;
      const st = i; while (i < text.length && text[i] !== ' ') i++;
      w.push({ st, len: i - st, x: 0, y: 0, ang: 0, sz: 30 });
    }
    return w;
  }
  const sWords = text => text.split(' ').filter(Boolean).length > MAXW ? MAXW : text.split(' ').filter(Boolean).length;

  function sceneLayout(li, sc){
    const L = sL, nw = L.nw, T = show.theme === ST.XMAS ? 34 : 16;
    L.scene = sc; L.cat = true; L.flip = false; L.ar = 0; L.as = 1; L.clipY = 9999; L.edge = 0;
    L.sit = sc === SS.RING || sc === SS.BIG || sc === SS.HOP || sc === SS.BUBBLE;
    switch (sc) {
      case SS.WORDS: L.cat = false; return flowBlock(12, T, 228, 258, 60, 20, sRr(-0.16, 0.16), 0.14, 6, 4) > 0;
      case SS.RING: {
        L.as = sRr(1.4, 1.65); L.ax = 120 + sRr(-16, 16); L.ay = sRr(222, 246); L.flip = sRf() < 0.5;
        const cy = L.ay - 46 * L.as, rx = sRr(70, 82), ry = sRr(72, 86);
        return ringLayout(L.ax, cy, rx, fminf(cy - T - 8, ry), T);
      }
      case SS.PEEK: {
        const r = sRf(); L.edge = r < 0.5 ? 0 : r < 0.68 ? 1 : r < 0.86 ? 2 : 3;
        L.as = sRr(1.6, 1.95); const h = 58 * L.as;
        if (L.edge === 0) { L.ax = sRr(64, 176); L.ay = H + 19 * L.as; return flowBlock(14, T, 226, H - h - 4, 50, 18, sRr(-0.1, 0.1), 0.06, 3, 0) > 0; }
        if (L.edge === 1) { L.ar = 1.5708; L.ax = -19 * L.as; L.ay = sRr(80, 200); return flowBlock(h + 2, T, 228, 262, 46, 18, sRr(-0.1, 0.1), 0.06, 3, 0) > 0; }
        if (L.edge === 2) { L.ar = -1.5708; L.ax = W + 19 * L.as; L.ay = sRr(80, 200); return flowBlock(12, T, W - h - 2, 262, 46, 18, sRr(-0.1, 0.1), 0.06, 3, 0) > 0; }
        L.ar = 3.1416; L.ax = sRr(64, 176); L.ay = -19 * L.as; return flowBlock(14, h + 4, 226, 262, 50, 18, sRr(-0.1, 0.1), 0.06, 3, 0) > 0;
      }
      case SS.STROLL: {
        L.flip = sRf() < 0.5; L.as = sRr(1.25, 1.45); L.ay = sRr(250, 264);
        L.ax = L.flip ? W + 40 : -40; L.bx = L.flip ? -40 : W + 40; L.by = L.ay;
        return flowBlock(14, T, 226, L.ay - 46 * L.as, 50, 18, sRr(-0.14, 0.14), 0.08, 4, 2) > 0;
      }
      case SS.BIG: {
        L.cat = sRf() < 0.65;
        const yl = T + 28, yh = L.cat ? 160 : 214;
        for (let i = 0; i < nw; i++) {
          let sz = 74, w = wW(i, SP_LPX) * 74 / SP_LPX;
          if (w > 214) { sz = 74 * 214 / w; w = 214; }
          if (sz < 12) sz = 12;
          const Wd = L.w[i]; Wd.sz = sz;
          Wd.x = sRr(14 + w / 2, 226 - w / 2); if (w >= 212) Wd.x = 120;
          Wd.y = sRr(yl, yh); Wd.ang = sRr(-0.24, 0.24);
        }
        L.ax = sRf() < 0.5 ? 62 : 178; L.ay = 264; L.bx = 240 - L.ax; L.by = 264; L.as = 1.3;
        return true;
      }
      case SS.HIDE: {
        if (!flowBlock(14, 118, 226, 262, 52, 18, 0, 0.04, 2, 0)) return false;
        L.as = sRr(1.45, 1.7); L.ax = sRr(64, 176); L.clipY = L.top + 3; L.ay = L.clipY + 19 * L.as;
        return true;
      }
      case SS.HOP: {
        if (!flowBlock(14, T + 46, 226, 262, 40, 18, 0, 0.08, 4, 34)) return false;
        if (L.rows > 4) return false;
        L.as = 0.85;
        return true;
      }
      case SS.BUBBLE: {
        L.flip = sRf() < 0.5; L.as = 1.3; L.ax = L.flip ? 178 : 62; L.ay = 266;
        if (!flowBlock(28, T + 10, 212, 158, 42, 18, 0, 0.05, 2, 0)) return false;
        L.bub[0] -= 12; L.bub[1] -= 12; L.bub[2] += 12; L.bub[3] += 10;
        return true;
      }
    }
    return false;
  }
  function buildLayouts(){
    fontLoad();
    lays = [];
    let prev = -1, withCat = 0;
    show.lines.forEach((ln, li) => {
      sTxt = ln.text;
      sL = { w: sSplit(sTxt), nw: 0, rows: 0, top: 0, bub: [0, 0, 0, 0], scene: 0, cat: true, sit: false, flip: false, ax: 0, ay: 0, ar: 0, as: 1, bx: 0, by: 0, clipY: 9999, edge: 0 };
      sL.nw = sL.w.length;
      const h = (sFnv(sTxt) ^ imul(li, 0x9E3779B9)) >>> 0;
      sRs = h || 1;
      const nw = sL.nw;
      let sc = ln.scene || 0;
      if (sc === SS.AUTO) {
        const C1 = [SS.BIG, SS.HOP, SS.PEEK, SS.RING, SS.BIG], C3 = [SS.RING, SS.BIG, SS.HOP, SS.PEEK, SS.WORDS, SS.HIDE];
        const C7 = [SS.RING, SS.PEEK, SS.HIDE, SS.BUBBLE, SS.STROLL, SS.WORDS, SS.HOP], C9 = [SS.PEEK, SS.BUBBLE, SS.STROLL, SS.WORDS, SS.HIDE];
        const C = nw <= 1 ? C1 : nw <= 3 ? C3 : nw <= 7 ? C7 : C9, cn = C.length;
        let k = Math.trunc(sRf() * cn);
        const f = ln.face, want = f === F.EXCITED ? SS.HOP : f === F.SHY ? SS.HIDE : f === F.SINGING ? SS.BUBBLE : f === F.DREAMY ? SS.STROLL : 255;
        if (want !== 255 && sRf() < 0.5) for (let q = 0; q < cn; q++) if (C[q] === want) k = q;
        sc = C[k];
        if (sc === prev) sc = C[(k + 1) % cn];
        if (withCat >= 3) sc = nw <= 3 ? SS.BIG : SS.WORDS;
      }
      if (!sceneLayout(li, sc)) { sRs = h || 1; if (!sceneLayout(li, SS.PEEK) && !sceneLayout(li, SS.WORDS)) { sceneLayout(li, SS.BIG); sL.cat = false; } }
      if (sc === SS.BIG && withCat >= 3) sL.cat = false;
      withCat = sL.cat ? withCat + 1 : 0;
      prev = sL.scene;
      lays.push(sL);
    });
  }

  let sWbW = 0, sWbH = 0, sWbBase = 0, sWbAdv = 0;
  function renderWord(Fn, fi, s, seed){
    const pad = 4;
    sWbBase = pad - sTop[fi]; sWbH = sWbBase + sBot[fi] + pad + 1;
    if (sWbH > SW_H) sWbH = SW_H;
    sWbW = Math.min(SW_W, pad + pAdv(Fn, s) + pad + 4);
    for (let y = 0; y < sWbH; y++) sWord.fill(0, y * SW_W, y * SW_W + sWbW);
    let x = pad;
    for (let k = 0; k < s.length; k++) {
      const g = glyph(Fn, s[k]);
      const jx = roundf(sJit(seed * 31 + k, 5) * 0.8), jy = roundf(sJit(seed * 31 + k, 6) * 1.0), rb = (g.w + 1) >> 1;
      for (let j = 0; j < g.h; j++) {
        const yy = sWbBase + g.dy + j + jy;
        if (yy < 0 || yy >= sWbH) continue;
        const ro = yy * SW_W;
        for (let i = 0; i < g.w; i++) {
          const xx = x + g.dx + i + jx;
          if (xx < 0 || xx >= sWbW) continue;
          let v = Fn.bmp[g.off + j * rb + (i >> 1)];
          v = ((i & 1) ? (v & 15) : (v >> 4)) * 17;
          if (v > sWord[ro + xx]) sWord[ro + xx] = v;
        }
      }
      x += g.adv;
    }
    sWbAdv = x - pad;
  }
  function blitWord(x, y, ang, sc, alpha, reveal, fi){
    const c = cosf(ang), s = sinf(ang), ax = 4 + sWbAdv / 2, ay = sWbBase - sCapH[fi] / 2;
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (let k = 0; k < 4; k++) {
      const cu = ((k & 1) ? sWbW : 0) - ax, cv = ((k & 2) ? sWbH : 0) - ay;
      const X = x + (cu * c - cv * s) * sc, Y = y + (cu * s + cv * c) * sc;
      mnx = fminf(mnx, X); mxx = fmaxf(mxx, X); mny = fminf(mny, Y); mxy = fmaxf(mxy, Y);
    }
    const x0 = Math.max(0, Math.floor(mnx)), x1 = Math.min(W - 1, Math.ceil(mxx)), y0 = Math.max(0, Math.floor(mny));
    let y1 = Math.min(H - 1, Math.ceil(mxy));
    if (y1 >= sClipY) y1 = Math.ceil(sClipY) - 1;
    const uMax = 4 + sWbAdv * reveal + 2, isc = 1 / sc, A = Math.trunc(alpha * 256);
    if (A <= 0) return;
    let any = false;
    for (let py = y0; py <= y1; py++) {
      const dy = py - y, ro = py * W;
      for (let px = x0; px <= x1; px++) {
        const dx = px - x, u = ax + (dx * c + dy * s) * isc, v = ay + (-dx * s + dy * c) * isc;
        if (u < 0 || v < 0 || u >= sWbW - 1 || v >= sWbH - 1 || u > uMax) continue;
        const iu = u | 0, iv = v | 0, fu = u - iu, fv = v - iv, p = iv * SW_W + iu;
        const val = (sWord[p] * (1 - fu) + sWord[p + 1] * fu) * (1 - fv) + (sWord[p + SW_W] * (1 - fu) + sWord[p + SW_W + 1] * fu) * fv;
        const vv = ((val | 0) * A) >> 8;
        if (vv > sLayer[ro + px]) { sLayer[ro + px] = vv > 255 ? 255 : vv; any = true; }
      }
    }
    if (any) { if (x0 < sDx0) sDx0 = x0; if (x1 > sDx1) sDx1 = x1; if (y0 < sDy0) sDy0 = y0; if (y1 > sDy1) sDy1 = y1; }
  }
  function drawWord(li, i, x, y, ang, sz, alpha, reveal){
    const Wd = lays[li].w[i], fi = pFi(sz);
    renderWord(FONTS[fi], fi, show.lines[li].text.substr(Wd.st, Wd.len), li * 64 + i);
    blitWord(x, y, ang, sz / pPx(sz), alpha, reveal, fi);
  }
  function singWords(li, u, t, dur){
    const L = lays[li], n = L.nw;
    const fade = 1 - sClamp((u - (dur - 0.6)) / 0.6, 0, 1);
    const drx = sinf(t * 0.6 + li) * 3, dry = cosf(t * 0.5 + li * 2) * 2.5;
    if (L.scene === SS.BIG) {
      const k = Math.min(Math.trunc(u), n - 1);
      for (let i = Math.max(0, k - 1); i <= k; i++) {
        const Wd = L.w[i], pp = u - i; let a = fade, sc = 1, rev = 1;
        if (i < k) { const q = sClamp((u - k) / 0.3, 0, 1); if (q >= 1) continue; a *= 1 - q; sc = 1 - 0.3 * q; }
        else { rev = sClamp(pp / 0.3, 0, 1); sc = 1 + 0.35 * (1 - sEase(pp / 0.35)); }
        drawWord(li, i, Wd.x + drx, Wd.y + dry + sinf(t * 2.1 + i) * 2, Wd.ang + sinf(t * 1.7 + i) * 0.03, Wd.sz * sc, a, rev);
      }
      return;
    }
    for (let i = 0; i < n && i <= Math.trunc(u); i++) {
      const Wd = L.w[i], pp = u - i, rev = sClamp(pp / 0.3, 0, 1), e = sEase(pp / 0.4);
      const sc = 1 + 0.22 * (1 - e); let ox = 0, oy = -7 * (1 - e);
      if (L.scene === SS.WORDS) { const a = sHf(li * 64 + i, 9) * 6.2832; ox = cosf(a) * 26 * (1 - e); oy = sinf(a) * 26 * (1 - e); }
      const bob = sinf(t * 2.2 + i * 1.3) * 1.3, sway = sinf(t * 1.7 + i) * 0.025;
      const still = L.scene === SS.HIDE || L.scene === SS.BUBBLE, dx = still ? 0 : drx, dy = still ? 0 : dry;
      drawWord(li, i, Wd.x + ox + dx, Wd.y + oy + dy + bob, Wd.ang + sway, Wd.sz * sc, fade, rev);
    }
  }
  function singBubble(li, u, dur){
    const L = lays[li], x0 = L.bub[0], y0 = L.bub[1], x1 = L.bub[2], y1 = L.bub[3], r = 14;
    const tipx = L.ax + (L.flip ? -6 : 6), tipy = L.ay - 66 * L.as;
    let tbx = L.flip ? x1 - 34 : x0 + 34;
    if (tbx < x0 + r) tbx = x0 + r; if (tbx > x1 - r - 14) tbx = x1 - r - 14;
    const px = [], py = [];
    for (let c = 0; c < 4; c++) {
      const cx = c === 0 || c === 3 ? x0 + r : x1 - r, cy = c < 2 ? y0 + r : y1 - r, a0 = 3.1416 + c * 1.5708;
      for (let k = 0; k <= 4; k++) { const a = a0 + 1.5708 * k / 4; px.push(cx + cosf(a) * r); py.push(cy + sinf(a) * r); }
      if (c === 2) { px.push(tbx + 16, tipx, tbx); py.push(y1, tipy, y1); }
    }
    const n = px.length, fade = 1 - sClamp((u - (dur - 0.6)) / 0.6, 0, 1), rev = sClamp(u / 0.5, 0, 1);
    if (rev >= 1) pFill(px, py, n, sPaperCol);
    let tot = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; tot += sqrtf((px[j] - px[i]) ** 2 + (py[j] - py[i]) ** 2); }
    if (rev < 1) sBudget = tot * rev;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; pSeg(px[i] + sJit(901, i) * 0.6, py[i] + sJit(902, i) * 0.6, px[j] + sJit(901, j) * 0.6, py[j] + sJit(902, j) * 0.6, 1.9, 235); }
    sBudget = -1;
    pFlush(S_GRAPH, (255 * fade) | 0);
  }

  const S_PAPER = [c565(251, 246, 236), c565(253, 238, 241), c565(245, 241, 253), c565(252, 252, 247)];
  function buildPaper(){
    const keep = FB; FB = sPaper;
    sPaperCol = S_PAPER[show.theme % 4];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const h = sHash(x * 911 + y * 3067 + 7), d = (h & 7) - 3 - (((h >>> 5) & 63) === 0 ? 6 : 0);
      FB[y * W + x] = d < 0 ? mix565(sPaperCol, c565(120, 110, 100), -d * 5) : mix565(sPaperCol, COL_WHITE, d * 14);
    }
    if (show.theme === ST.PLAIN) {
      for (let y = 34; y < H; y += 24) pSeg(0, y, W - 1, y + sJit(y, 1) * 0.3, 1.0, 150);
      pFlush(c565(140, 186, 232), 255);
      pSeg(26, 0, 26.5, H - 1, 1.0, 170); pFlush(c565(236, 120, 130), 255);
    } else {
      for (let i = 0; i < 9; i++) {
        const x = 14 + sHf(i, 21) * 212, y = 14 + sHf(i, 22) * 250, r = 3 + sHf(i, 23) * 3;
        kTx = x; kTy = y; kC = 1; kS = 0; kSc = 1; kFlip = false; kSub(0, 0, 0);
        if (show.theme === ST.LOVE) { const [lx, ly] = kHeartPts(0, 0, r); for (let k = 0; k < 12; k++) kLine(lx[k], ly[k], lx[(k + 1) % 12], ly[(k + 1) % 12], 1.0, 150); pFlush(K_PINK, 120); }
        else if (show.theme === ST.PARTY) { kLine(-r, 0, -r / 3, -r / 2, 1.1, 160); kLine(-r / 3, -r / 2, r / 3, 0, 1.1, 160); kLine(r / 3, 0, r, -r / 2, 1.1, 160); pFlush([c565(240, 110, 150), c565(92, 148, 228), c565(238, 182, 36)][i % 3], 120); }
        else { for (let k = 0; k < 3; k++) { const a = k * 1.0472; kLine(-cosf(a) * r, -sinf(a) * r, cosf(a) * r, sinf(a) * r, 1.0, 150); } pFlush(c565(150, 180, 220), 120); }
      }
    }
    FB = keep;
    sPaperTheme = show.theme;
  }
  function singSeason(t, beatN, front){
    kC = 1; kS = 0; kSc = 1; kFlip = false; kSub(0, 0, 0);
    if (show.theme === ST.XMAS) {
      if (!front) {
        let px = -6, py = 10;
        for (let i = 1; i <= 12; i++) { const x = -6 + i * 21, u = (x - 120) / 130, y = 10 + (1 - u * u) * 12; pSeg(px, py + sJit(i, 3) * 0.5, x, y, 1.3, 220); px = x; py = y; }
        pFlush(S_GRAPH, 255);
        const BULB = [K_RED, K_GRN, K_YEL, K_BLUE];
        for (let i = 0; i < 11; i++) {
          const x = 10 + i * 22, u = (x - 120) / 130, y = 10 + (1 - u * u) * 12 + 6, on = ((i + beatN) % 3) !== 0;
          kTx = x; kTy = y;
          if (on) { kHatchEll(0, 0, 3.4, 4.6, 1.5, 240, 950 + i); pFlush(BULB[i % 4], 255); }
          kArc(0, 0, 3.4, 4.6, 0, 6.6, 1.2, 220, 960 + i); pFlush(S_GRAPH, 255);
        }
      }
      for (let i = front ? 7 : 0; i < (front ? 14 : 7); i++) {
        const sp = 14 + sHf(i, 31) * 16, y = fmodf(t * sp + sHf(i, 32) * 300, 300) - 10, x = 10 + sHf(i, 33) * 220 + sinf(t * 0.8 + i) * 8;
        kTx = x; kTy = y; kSub(0, 0, t * 0.7 + i);
        const r = front ? 4.5 : 3;
        for (let k = 0; k < 3; k++) { const a = k * 1.0472; kLine(-cosf(a) * r, -sinf(a) * r, cosf(a) * r, sinf(a) * r, 1.1, 230); }
        pFlush(c565(120, 160, 215), 255);
      }
    } else if (show.theme === ST.LOVE && !front) {
      for (let i = 0; i < 7; i++) {
        const p = fmodf(t * 0.1 + sHf(i, 41), 1), x = 16 + sHf(i, 42) * 208 + sinf(t * 1.4 + i) * 7, y = H + 12 - p * (H + 30);
        kTx = x; kTy = y; kSub(0, 0, sinf(t + i) * 0.2);
        kHeart(0, 0, 4 + sHf(i, 43) * 3, K_PINK, (220 * (1 - p * 0.6)) | 0, 970 + i);
      }
    } else if (show.theme === ST.PARTY && front) {
      const CC = [c565(240, 100, 140), c565(92, 148, 228), c565(238, 182, 36), c565(64, 158, 92), c565(170, 110, 230)];
      for (let i = 0; i < 12; i++) {
        const sp = 22 + sHf(i, 51) * 22, y = fmodf(t * sp + sHf(i, 52) * 300, 300) - 10, x = 8 + sHf(i, 53) * 224 + sinf(t * 2 + i) * 6;
        kTx = x; kTy = y; kSub(0, 0, t * 3 + i);
        kLine(-4, 0, -1.3, -2, 1.5, 230); kLine(-1.3, -2, 1.3, 0, 1.5, 230); kLine(1.3, 0, 4, -2, 1.5, 230);
        pFlush(CC[i % 5], 255);
      }
    } else if (show.theme === ST.PLAIN && front) {
      for (let i = 0; i < 4; i++) { const p = 0.5 + 0.5 * sinf(t * 2.4 + i * 1.7); kTx = 10 + sHf(i, 61) * 14; kTy = 40 + i * 60 + sHf(i, 62) * 20; kSpark(0, 0, 2 + 2.6 * p, S_GRAPH, 200); }
    }
  }

  let kX, kY, kR, kSs, kHop, kPose, kFl;
  function catAt(li, u, t){
    const L = lays[li], dur = L.nw + 2;
    kX = L.ax; kY = L.ay; kR = L.ar; kSs = L.as; kFl = L.flip; kPose = K_SIT; kHop = 0;
    switch (L.scene) {
      case SS.RING: kX += sinf(t * 0.9 + li) * 6; break;
      case SS.BIG: {
        const half = (L.nw + 1) / 2, q = sClamp((u - half) / 0.6, 0, 1);
        if (L.nw >= 3 && q > 0) { kX = L.ax + (L.bx - L.ax) * sEase(q); kHop = sinf(q * 3.1416) * 34; kFl = L.bx < L.ax; if (q < 1) kPose = K_JUMP; }
        break;
      }
      case SS.HOP: {
        const n = L.nw; let k = Math.floor(u + 0.45); if (k > n - 1) k = n - 1; if (k < 0) k = 0;
        const Wd = L.w[k], top = Wd.y - capOf(Wd.sz) / 2 - 1;
        kX = Wd.x; kY = top;
        const q = (u - (k - 0.45)) / 0.45;
        if (k > 0 && q < 1) {
          const Pw = L.w[k - 1], ptop = Pw.y - capOf(Pw.sz) / 2 - 1, e = sEase(q);
          kX = Pw.x + (Wd.x - Pw.x) * e; kY = ptop + (top - ptop) * e; kHop = sinf(q * 3.1416) * 30; kFl = Wd.x < Pw.x; kPose = K_JUMP;
        }
        break;
      }
      case SS.STROLL: { const p = u / dur; kX = L.ax + (L.bx - L.ax) * p; kY = L.ay - fabsf(sinf(t * 9)) * 2; kPose = K_WALK; break; }
      case SS.PEEK: case SS.HIDE: {
        const inn = sEase(u / 0.6) * (1 - sEase((u - (dur - 0.7)) / 0.6));
        let pop = 0; const k = Math.trunc(u); if (k < L.nw) pop = 1 - sClamp((u - k) / 0.6, 0, 1);
        const h = L.scene === SS.HIDE ? inn * (0.5 + 0.5 * pop) : inn * (0.85 + 0.15 * pop), back = (1 - h) * 48 * L.as;
        kX = L.ax - sinf(L.ar) * back; kY = L.ay + cosf(L.ar) * back;
        kPose = K_PEEK;
        break;
      }
    }
  }
  function singCat(li, u, t, ph, talk, now, jumpAt){
    const L = lays[li];
    if (!L.cat) return;
    const n = lays.length, dur = L.nw + 2, pv = (li + n - 1) % n, nx = (li + 1) % n, Pl = lays[pv], Nl = lays[nx];
    catAt(li, u, t);
    let rev = 1;
    if (L.sit) {
      const travel = Pl.cat && Pl.sit && pv !== li, leave = !(Nl.cat && Nl.sit && nx !== li);
      if (u < 0.7) {
        if (travel) {
          const X = kX, Y = kY, R = kR, Ss = kSs, Fl = kFl;
          catAt(pv, Pl.nw + 2, t);
          const e = sEase(u / 0.7);
          kHop = sinf(e * 3.1416) * 40; kFl = X < kX;
          kX = kX + (X - kX) * e; kY = kY + (Y - kY) * e; kR = kR + (R - kR) * e; kSs = kSs + (Ss - kSs) * e;
          kPose = e < 0.97 ? K_JUMP : kPose;
          if (e >= 0.97) kFl = Fl;
        } else rev = u / 0.7;
      }
      if (leave && u > dur - 0.7) rev = fminf(rev, (dur - u) / 0.7);
    }
    let jump = 0;
    if (jumpAt && now - jumpAt < 600) jump = sinf((now - jumpAt) / 600 * 3.1416) * 36;
    const up = kHop + jump;
    kTx = kX + sinf(kR) * up; kTy = kY - cosf(kR) * up;
    kC = cosf(kR); kS = sinf(kR); kSc = kSs; kFlip = kFl;
    if (up > 4 && kPose === K_SIT) kPose = K_JUMP;
    sClipY = L.clipY;
    const ln = show.lines[li];
    kittenDraw(ln.face, ln.prop, kPose, t, ph, talk, u, sClamp(rev, 0, 1));
    sClipY = 9999;
  }

  // timeline: one beat per word, then two beats of rest; loops
  function where(sh, ms){
    const beat = Math.floor(60000 / sh.bpm), wc = sh.lines.map(l => sWords(l.text));
    const total = wc.reduce((a, n) => a + (n + 2) * beat, 0) || 1;
    let el = Math.floor(ms) % total, li = 0;
    while (li < sh.lines.length - 1 && el >= (wc[li] + 2) * beat) { el -= (wc[li] + 2) * beat; li++; }
    const bi = Math.floor(el / beat);
    return { li, bi, el, beat, u: el / beat, ph: (el % beat) / beat, popIdx: bi < wc[li] ? bi : -1, beatNo: Math.floor(ms / beat) };
  }
  function lineStart(sh, i){ const beat = Math.floor(60000 / sh.bpm); return sh.lines.slice(0, i).reduce((a, l) => a + (sWords(l.text) + 2) * beat, 0); }

  const frame = new Uint16Array(W * H), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx2 = cv.getContext('2d'), img = cx2.createImageData(W, H);
  function draw(c, sh, ms, jumpAt, at){
    if (!sh || !sh.lines.length || !window.SING_FONTS) return;
    show = sh;
    const key = JSON.stringify([sh.theme, sh.lines.map(l => [l.text, l.face, l.scene || 0])]);
    if (key !== laysKey) { buildLayouts(); laysKey = key; }
    if (sPaperTheme !== sh.theme) buildPaper();
    const now = at != null ? at : performance.now();      // "at" lets tests pin the clock
    sBoil = Math.floor(now / 110) % 4096;
    const t = now / 1000, w = where(sh, ms), li = w.li, L = lays[li], dur = L.nw + 2;
    const talk = w.popIdx >= 0 ? Math.max(0, 1 - (w.el % w.beat) / 170) : 0;
    FB = frame; FB.set(sPaper);
    sClipY = 9999; sBudget = -1; sMeasure = false;
    singSeason(t, w.beatNo, false);
    const ln = sh.lines[li], ink = ln.color ? hex565(ln.color) : hex565(sh.ink);
    if (L.scene === SS.HIDE) { singCat(li, w.u, t, w.ph, talk, now, jumpAt); singWords(li, w.u, t, dur); pFlush(ink, 255); }
    else {
      if (L.scene === SS.BUBBLE) singBubble(li, w.u, dur);
      singWords(li, w.u, t, dur); pFlush(ink, 255);
      singCat(li, w.u, t, w.ph, talk, now, jumpAt);
    }
    singSeason(t, 0, true);
    const n = sh.lines.length;
    for (let i = 0; i < n; i++) { const x = 120 - n * 4 + i * 8 + 4; pSeg(x, 273, x, 273, i === li ? 4.6 : 2.6, i === li ? 230 : 120); }
    pFlush(S_GRAPH, 255);
    const d = img.data;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) { const p = FB[i]; d[j] = (p >> 11) * 255 / 31; d[j + 1] = ((p >> 5) & 63) * 255 / 63; d[j + 2] = (p & 31) * 255 / 31; d[j + 3] = 255; }
    cx2.putImageData(img, 0, 0);
    c.drawImage(cv, 0, 0);
    return { ...w, scene: L.scene, cat: L.cat };
  }
  window.Sing = { _lays: () => lays, FACES, PROPS, THEMES, SCENES, guess, splitLines, encode, draw, where, lineStart, words: sWords };
})();
