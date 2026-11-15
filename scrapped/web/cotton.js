// The Cotton look, drawn in the browser: the same sky, little you, mood window, badge, drawer and bio card
// the charm draws in firmware (LarpCharm.ino, "v7: the Cotton look"), with the same numbers.
(() => {
  const W = 240, H = 280;
  const MOODS = ['happy', 'excited', 'loved', 'calm', 'sleepy', 'meh', 'sad', 'stressed', 'inspired'];
  const STATUS = ['available', 'busy', 'studying', 'working', 'out & about', 'gaming', 'creating', 'resting'];
  const STATUS_COL = ['#6ED6A0', '#FF7092', '#AA8CF0', '#60A8F5', '#FAC454', '#FF966E', '#F078C8', '#96A6CE'];
  const TONES = ['#FFE2D0', '#FAD2B4', '#E8B48E', '#C68E66', '#966648', '#6C4834'];
  const HAIRS = ['Bob', 'Long', 'Buns', 'Short', 'Ponytail', 'Curls'];
  const HCOLS = ['#3A2C3E', '#704A36', '#9C5C3A', '#F4D288', '#E8804E', '#FA96C4', '#B89CF0', '#7EBAFA'];
  const OUTFITS = ['#FFA8CC', '#9CCCFF', '#CCB2FF', '#A4E6CA', '#FFE492', '#FAF8FF'];
  const ACCS = ['None', 'Bow', 'Flower', 'Glasses', 'Cat ears', 'Headphones', 'Stars'];
  const INK = '#623E80', INK2 = '#9670B0', FACE = '#422A50', MOUTH = '#B04868', BLUSH = '#FF84AA', PINK = '#FF78AC', PINKL = '#FFD6E8', BLUEL = '#D0E8FF', BUTTER = '#FFD670';
  const PANE_T = ['#FFECBE', '#C8E8FF', '#FFC8E0', '#CDE8FF', '#786EBE', '#CDD4E8', '#96AAD2', '#6E6996', '#D7BEFF'];
  const PANE_B = ['#FFD2E1', '#FFD6EC', '#FFAACD', '#E8F4FF', '#AA96DC', '#E2E6F2', '#BECDE8', '#968CB9', '#FFCDEC'];
  const FACES = ['smile', 'joy', 'love', 'calm', 'sleepy', 'meh', 'sad', 'stress', 'star'];
  const HELLO = ['hi!', 'oh, hi!', 'hello :)', "you're back!"];
  const KIND = ['you got this!', 'proud of you', 'drink some water :)', "you're doing great", 'take a deep breath', 'you are enough', 'stay cozy', 'one step at a time', 'today is yours', 'sending a hug'];
  const DRAWER = [[13, 'Bio'], [0, 'Clock'], [4, 'Music'], [10, 'Jukebox'], [9, 'Eyes'], [5, 'Pet'], [6, 'Dice'], [1, 'Message'], [2, 'Photo'], [3, 'Sing'], [7, 'ID card'], [11, 'Torch']];
  const BUB = ['#F68CBE', '#76ACF0', '#A88CEC', '#60C4A8'];
  const NUN = '"Nunito", "Trebuchet MS", sans-serif', HAND = '"Gloria Hallelujah", "Comic Sans MS", cursive';

  const defaults = () => ({ mood: 0, stat: 0, tone: 1, hair: 0, hcol: 1, outfit: 0, acc: 1, statCol: 0,
    name: 'me', pron: '', bio: 'hi! this little charm is me. tap my window to change my mood :)', likes: 'matcha,cats,pixel art', custom: '' });

  // ── shapes ──
  const E = (x, cx, cy, rx, ry, col, a = 1) => { if (rx <= 0 || ry <= 0) return; x.globalAlpha = a; x.fillStyle = col; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.fill(); x.globalAlpha = 1; };
  const RR = (x, l, t, w, h, r, col, a = 1) => { x.globalAlpha = a; x.fillStyle = col; x.beginPath(); x.roundRect(l, t, w, h, Math.min(r, w / 2, h / 2)); x.fill(); x.globalAlpha = 1; };
  const SEG = (x, ax, ay, bx, by, w, col, a = 1) => { x.globalAlpha = a; x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke(); x.globalAlpha = 1; };
  const ARC = (x, cx, cy, r, a0, a1, w, col, a = 1) => { x.globalAlpha = a; x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.arc(cx, cy, r, a0, a1); x.stroke(); x.globalAlpha = 1; };
  const TRI = (x, ax, ay, bx, by, cx, cy, col, a = 1) => { x.globalAlpha = a; x.fillStyle = col; x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.lineTo(cx, cy); x.fill(); x.globalAlpha = 1; };
  function HEART(x, cx, cy, s, col, a = 1) {
    x.globalAlpha = a; x.fillStyle = col; x.beginPath();
    x.moveTo(cx, cy + 1.0 * s);
    x.bezierCurveTo(cx - 1.35 * s, cy + 0.05 * s, cx - 1.05 * s, cy - 1.15 * s, cx, cy - 0.5 * s);
    x.bezierCurveTo(cx + 1.05 * s, cy - 1.15 * s, cx + 1.35 * s, cy + 0.05 * s, cx, cy + 1.0 * s);
    x.fill(); x.globalAlpha = 1;
  }
  const STAR = (x, cx, cy, r, col, a = 1) => { E(x, cx, cy, r * 0.24, r, col, a); E(x, cx, cy, r, r * 0.24, col, a); };
  function CLOUD(x, cx, cy, s, col = '#fff', shade = '#D6C8F0') {
    E(x, cx + 1 * s, cy + 7 * s, 25 * s, 8 * s, shade, 0.45);
    x.fillStyle = col; x.beginPath();
    [[-14, 1, 11, 9], [1, -5, 14, 12], [16, 1, 10, 8], [0, 4, 24, 7]].forEach(([dx, dy, rx, ry]) => { x.moveTo(cx + dx * s + rx * s, cy + dy * s); x.ellipse(cx + dx * s, cy + dy * s, rx * s, ry * s, 0, 0, 7); });
    x.fill();
  }
  function sparkle(x, px, py, r) { x.fillStyle = '#fff'; x.fillRect(px - r, py, 2 * r + 1, 1); x.fillRect(px, py - r, 1, 2 * r + 1); }
  const font = (x, px, wgt = 700, fam = NUN) => { x.font = `${wgt} ${px}px ${fam}`; x.textBaseline = 'alphabetic'; };
  const TXT = (x, s, l, y, px, col, wgt = 700, align = 'left', fam = NUN, a = 1) => { font(x, px, wgt, fam); x.textAlign = align; x.globalAlpha = a; x.fillStyle = col; x.fillText(s, l, y); x.globalAlpha = 1; };
  const TW = (x, s, px, wgt = 700, fam = NUN) => { font(x, px, wgt, fam); return x.measureText(s).width; };

  // ── the sky (same recipe as the firmware's pastel Aero palette) ──
  let skyCv = null;
  function sky() {
    if (skyCv) return skyCv;
    skyCv = document.createElement('canvas'); skyCv.width = W; skyCv.height = H;
    const x = skyCv.getContext('2d'), g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#FFD6EA'); g.addColorStop(0.55, '#E9DAFF'); g.addColorStop(1, '#C4E8FF');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const r = x.createRadialGradient(40, 10, 0, 40, 10, 200); r.addColorStop(0, 'rgba(255,255,255,.32)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = r; x.fillRect(0, 0, W, H);
    const band = (f, alpha, top) => { x.fillStyle = top; x.globalAlpha = alpha; x.beginPath(); x.moveTo(0, H); for (let i = 0; i <= W; i++) x.lineTo(i, f(i)); x.lineTo(W, H); x.fill(); x.globalAlpha = 1; };
    band(i => 238 - 8 * Math.abs(Math.sin(i * 0.06 + 2.1)) - 5 * Math.abs(Math.sin(i * 0.15)), 0.5, '#fff');
    const floorG = x.createLinearGradient(0, 245, 0, H); floorG.addColorStop(0, '#FFFCFF'); floorG.addColorStop(1, '#E5E6FD');
    band(i => 256 - 9 * Math.abs(Math.sin(i * 0.045 + 0.3)) - 6 * Math.abs(Math.sin(i * 0.11 + 1.7)), 1, floorG);
    return skyCv;
  }

  // ── you ──
  function bangY(style, dx) {
    let y = style === 2 ? -10 + 3 * Math.abs(Math.sin(dx / 7)) : style === 3 ? -9 + dx * 0.22 : style === 5 ? -8 + 5 * Math.abs(Math.sin(dx / 5)) : -7 + 4 * Math.abs(Math.sin(dx / 6.5));
    if (Math.abs(dx) > 24) y = Math.max(y, -7 + (Math.abs(dx) - 24) * 3);
    return Math.min(y, 14);
  }
  function avatar(x, p, cx, cy, s, o = {}) {
    const face = o.face || FACES[p.mood % 9], tone = TONES[p.tone % 6], hair = HCOLS[p.hcol % 8], oc = OUTFITS[p.outfit % 6], st = p.hair % 6;
    const look = o.look || 0, wave = o.wave || 0;
    if (o.body) E(x, cx, o.gy, 30 * s, 5 * s, INK, 0.14);
    if (st === 0) RR(x, cx - 35 * s, cy - 18 * s, 70 * s, 50 * s, 22 * s, hair);
    else if (st === 1) RR(x, cx - 35 * s, cy - 18 * s, 70 * s, 82 * s, 26 * s, hair);
    else if (st === 2) { E(x, cx - 24 * s, cy - 27 * s, 12 * s, 12 * s, hair); E(x, cx + 24 * s, cy - 27 * s, 12 * s, 12 * s, hair); RR(x, cx - 34 * s, cy - 14 * s, 68 * s, 34 * s, 18 * s, hair); }
    else if (st === 3) RR(x, cx - 33 * s, cy - 14 * s, 66 * s, 30 * s, 18 * s, hair);
    else if (st === 4) { E(x, cx + 33 * s, cy + 12 * s, 10 * s, 22 * s, hair); RR(x, cx - 34 * s, cy - 14 * s, 68 * s, 34 * s, 18 * s, hair); E(x, cx + 31 * s, cy - 8 * s, 4.5 * s, 4 * s, PINK); }
    else {
      for (let k = 0; k <= 10; k++) { const a = Math.PI + k * Math.PI / 10; E(x, cx + Math.cos(a) * 31 * s, cy - 4 * s + Math.sin(a) * 30 * s, 12 * s, 12 * s, hair); }
      for (const sd of [-1, 1]) { E(x, cx + sd * 33 * s, cy + 10 * s, 11 * s, 11 * s, hair); E(x, cx + sd * 30 * s, cy + 23 * s, 9 * s, 9 * s, hair); }
    }
    if (o.body) {
      const shoe = mix(oc, INK, 130 / 255);
      E(x, cx - 10 * s, o.gy - 6 * s, 9 * s, 5 * s, shoe); E(x, cx + 10 * s, o.gy - 6 * s, 9 * s, 5 * s, shoe);
      E(x, cx - 26 * s, cy + 47 * s, 7 * s, 10 * s, oc); E(x, cx - 27 * s, cy + 56 * s, 5 * s, 5 * s, tone);
      if (wave > 0.01) { const hx = cx + 37 * s, hy = cy + 20 * s - wave * 6 * s; SEG(x, cx + 19 * s, cy + 38 * s, hx - 2 * s, hy + 3 * s, 12 * s, oc); E(x, hx, hy, 5.2 * s, 5.2 * s, tone); }
      else { E(x, cx + 26 * s, cy + 47 * s, 7 * s, 10 * s, oc); E(x, cx + 27 * s, cy + 56 * s, 5 * s, 5 * s, tone); }
      RR(x, cx - 24 * s, cy + 27 * s, 48 * s, 44 * s, 18 * s, oc);
      E(x, cx, cy + 29 * s, 13 * s, 5 * s, mix(oc, '#ffffff', 130 / 255));
      HEART(x, cx, cy + 47 * s, 4.5 * s, '#fff', 0.9);
    }
    E(x, cx - 30 * s, cy + 4 * s, 5 * s, 6.5 * s, tone); E(x, cx + 30 * s, cy + 4 * s, 5 * s, 6.5 * s, tone);
    E(x, cx, cy, 31 * s, 29 * s, tone);
    if (p.acc === 4) for (const sd of [-1, 1]) {
      TRI(x, cx + sd * 27 * s, cy - 14 * s, cx + sd * 22 * s, cy - 45 * s, cx + sd * 5 * s, cy - 27 * s, hair);
      TRI(x, cx + sd * 23 * s, cy - 20 * s, cx + sd * 21 * s, cy - 38 * s, cx + sd * 11 * s, cy - 27 * s, PINKL);
    }
    // the fringe: the hair cap, cut along the bang line
    x.save(); x.beginPath(); x.moveTo(cx - 40 * s, cy - 40 * s); x.lineTo(cx + 40 * s, cy - 40 * s);
    for (let dx = 40; dx >= -40; dx -= 1) x.lineTo(cx + dx * s, cy + bangY(st, dx) * s);
    x.closePath(); x.clip(); E(x, cx, cy - 2 * s, 33.5 * s, 31 * s, hair); x.restore();
    ARC(x, cx - 2 * s, cy - 2 * s, 27 * s, 3.70, 4.45, 2.6 * s, '#fff', 0.4);

    const ey = cy + 5 * s, lx = look * 1.6 * s;
    const closed = o.blink && !['joy', 'calm', 'doze', 'stress', 'love', 'star'].includes(face);
    for (const sd of [-1, 1]) {
      const ex = cx + sd * 11 * s;
      if (closed || face === 'calm' || face === 'doze') ARC(x, ex, ey - 2 * s, 4 * s, 0.5, 2.64, 1.7 * s, FACE);
      else if (face === 'joy') ARC(x, ex, ey + 2 * s, 4 * s, 3.6, 5.82, 1.9 * s, FACE);
      else if (face === 'love') HEART(x, ex, ey, 4.4 * s, PINK);
      else if (face === 'star') { STAR(x, ex, ey, 5.5 * s, '#FFBE46'); E(x, ex, ey, 1.6 * s, 1.6 * s, '#fff'); }
      else if (face === 'stress') { SEG(x, ex - sd * 3 * s, ey - 3 * s, ex + sd * 2.5 * s, ey, 1.7 * s, FACE); SEG(x, ex + sd * 2.5 * s, ey, ex - sd * 3 * s, ey + 3 * s, 1.7 * s, FACE); }
      else if (face === 'sleepy') SEG(x, ex - 3.6 * s, ey + 1 * s, ex + 3.6 * s, ey + 1 * s, 1.8 * s, FACE);
      else if (face === 'meh') { E(x, ex + lx, ey + 1.5 * s, 3.4 * s, 2.6 * s, FACE); SEG(x, ex - 4.5 * s, ey - 0.6 * s, ex + 4.5 * s, ey - 0.6 * s, 1.6 * s, FACE); }
      else {
        E(x, ex + lx, ey, 3.6 * s, 4.6 * s, FACE); E(x, ex + lx + 1.2 * s, ey - 1.7 * s, 1.4 * s, 1.4 * s, '#fff');
        if (face === 'sad') SEG(x, ex - sd * 5 * s, ey - 6 * s, ex + sd * 3 * s, ey - 9 * s, 1.5 * s, FACE, 0.8);
      }
      E(x, cx + sd * 18 * s, cy + 12 * s, 5.5 * s, 3.4 * s, BLUSH, face === 'love' ? 0.75 : 0.45);
    }
    const my = cy + 14 * s;
    if (face === 'joy' || face === 'star') { E(x, cx, my + 1 * s, 4.4 * s, 3.8 * s, MOUTH); E(x, cx, my + 2.8 * s, 2.6 * s, 1.5 * s, BLUSH); }
    else if (face === 'sleepy') E(x, cx, my + 1 * s, 2.2 * s, 2.6 * s, MOUTH);
    else if (face === 'doze') E(x, cx, my + 1 * s, 1.6 * s, 1.8 * s, MOUTH);
    else if (face === 'meh') SEG(x, cx - 3.5 * s, my + 1 * s, cx + 3.5 * s, my + 1 * s, 1.6 * s, MOUTH);
    else if (face === 'sad') { ARC(x, cx, my + 6 * s, 4.5 * s, 3.8, 5.62, 1.6 * s, MOUTH); E(x, cx - 13 * s, ey + 7 * s + ((performance.now() / 90) % 8) * s, 1.5 * s, 2.3 * s, '#78B4FA', 0.85); }
    else if (face === 'stress') {
      x.strokeStyle = MOUTH; x.lineWidth = 1.5 * s; x.lineCap = 'round'; x.beginPath(); x.moveTo(cx - 4 * s, my + 1 * s); x.lineTo(cx - 1.3 * s, my - 0.6 * s); x.lineTo(cx + 1.3 * s, my + 1 * s); x.lineTo(cx + 4 * s, my - 0.6 * s); x.stroke();
      E(x, cx + 25 * s, cy - 9 * s, 2.3 * s, 3.3 * s, '#96C8FF', 0.9);
    } else ARC(x, cx, my - 3 * s, 4.6 * s, 0.6, 2.54, 1.6 * s, MOUTH);

    if (p.acc === 1) {
      const bx = cx + 19 * s, by = cy - 27 * s;
      SEG(x, bx - 1 * s, by + 2 * s, bx - 4 * s, by + 8 * s, 2.4 * s, PINK); SEG(x, bx + 1 * s, by + 2 * s, bx + 4 * s, by + 8 * s, 2.4 * s, PINK);
      E(x, bx - 6.5 * s, by, 6.5 * s, 5 * s, PINK); E(x, bx + 6.5 * s, by, 6.5 * s, 5 * s, PINK); E(x, bx, by, 2.8 * s, 3 * s, mix(PINK, INK, 70 / 255));
    } else if (p.acc === 2) {
      const fx = cx - 20 * s, fy = cy - 25 * s;
      for (let k = 0; k < 5; k++) { const a = k * 1.2566 - 1.57; E(x, fx + Math.cos(a) * 3.8 * s, fy + Math.sin(a) * 3.8 * s, 3.4 * s, 3.4 * s, '#fff'); }
      E(x, fx, fy, 2.6 * s, 2.6 * s, BUTTER);
    } else if (p.acc === 3) {
      for (const sd of [-1, 1]) ARC(x, cx + sd * 11 * s, ey, 6.8 * s, 0, 7, 1.5 * s, INK, 0.9);
      SEG(x, cx - 4.3 * s, ey - 1 * s, cx + 4.3 * s, ey - 1 * s, 1.4 * s, INK, 0.9);
    } else if (p.acc === 5) {
      ARC(x, cx, cy - 3 * s, 35 * s, 3.45, 5.97, 4.5 * s, '#82B4FA');
      for (const sd of [-1, 1]) { RR(x, cx + sd * 36 * s - 5 * s, cy - 8 * s, 10 * s, 18 * s, 5 * s, '#82B4FA'); E(x, cx + sd * 36 * s, cy + 1 * s, 2.6 * s, 4 * s, PINKL); }
    } else if (p.acc === 6) { STAR(x, cx + 21 * s, cy - 23 * s, 7 * s, BUTTER); STAR(x, cx + 28 * s, cy - 14 * s, 4 * s, '#fff'); }
  }
  function mix(a, b, t) { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; }
  function hex(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

  // ── mood window ──
  function weather(x, mood, px, py, mid, t) {
    if (mood === 0) {
      for (let k = 0; k < 8; k++) { const a = t * 0.6 + k * 0.7854; SEG(x, px + Math.cos(a) * 13, py + Math.sin(a) * 13, px + Math.cos(a) * 18, py + Math.sin(a) * 18, 2.6, '#FFBA5A'); }
      E(x, px, py, 10.5, 10.5, BUTTER); E(x, px - 3.5, py - 1, 1.2, 1.5, FACE); E(x, px + 3.5, py - 1, 1.2, 1.5, FACE); ARC(x, px, py + 1, 3.2, 0.6, 2.54, 1.2, MOUTH);
    } else if (mood === 1) {
      ['#FF96BE', '#FFD278', '#96DCB4', '#82BEFA'].forEach((col, k) => ARC(x, px, py + 12, 22 - k * 4.2, Math.PI, Math.PI * 2, 4.4, col));
      CLOUD(x, px - 19, py + 13, 0.36, '#fff', BLUEL); CLOUD(x, px + 19, py + 13, 0.36, '#fff', BLUEL);
    } else if (mood === 2) {
      for (let k = 0; k < 3; k++) { const ph = (t * 0.45 + k / 3) % 1; HEART(x, px - 16 + k * 16, py + 20 - ph * 40, 3, '#fff', Math.sin(ph * Math.PI) * 0.9); }
      HEART(x, px, py, 11 + 1.3 * Math.abs(Math.sin(t * 3.4)), '#FF689C'); E(x, px - 4, py - 4, 2.6, 1.8, '#fff', 0.7);
    } else if (mood === 3) { E(x, px + 8, py - 6, 9, 9, BUTTER); CLOUD(x, px - 3 + Math.sin(t * 0.7) * 3, py + 6, 0.5, '#fff', BLUEL); }
    else if (mood === 4) {
      E(x, px + 1, py, 11, 11, '#FFF0BE'); E(x, px + 7, py - 4, 9.5, 9.5, mid);
      [[-16, -12], [14, 10], [-6, 16]].forEach(([sx, sy], k) => { const b = 0.5 + 0.5 * Math.sin(t * 2.2 + k * 2); STAR(x, px + sx, py + sy, 2 + 2.2 * b, '#fff', 0.5 + 0.5 * b); });
    } else if (mood === 5) { CLOUD(x, px - 8 + Math.sin(t * 0.5) * 3, py - 5, 0.42, '#ECEEF8', '#BEC4D8'); CLOUD(x, px + 9 - Math.sin(t * 0.4) * 3, py + 8, 0.5, '#F4F6FC', '#BEC4D8'); }
    else if (mood === 6 || mood === 7) {
      const storm = mood === 7, flash = storm && (t * 1000 % 2600) < 260;
      for (let k = 0; k < 6; k++) { const yy = py + 2 + ((t * 34 + k * 9) % 24), xx = px - 17 + k * 7; SEG(x, xx, yy, xx - 1.5, yy + 4, 1.6, '#6EA0F0', 0.9); }
      if (flash) { TRI(x, px + 2, py - 2, px - 6, py + 12, px + 1, py + 10, BUTTER); TRI(x, px + 1, py + 8, px - 2, py + 22, px + 6, py + 7, BUTTER); }
      CLOUD(x, px, py - 7, 0.56, storm ? '#B0B0CC' : '#E2E6F5', storm ? '#7876A0' : '#AAB4D2');
    } else {
      [[0, 0], [-15, -10], [14, -9], [-9, 13], [11, 12]].forEach(([sx, sy], k) => { const b = 0.5 + 0.5 * Math.sin(t * 3 + k * 1.3); STAR(x, px + sx, py + sy, (k ? 3.5 : 8) + 2.5 * b, k % 2 ? BUTTER : '#fff', 0.6 + 0.4 * b); });
    }
  }
  function moodWindow(x, p, l, tp, w, h, t) {
    const m = p.mood % 9;
    RR(x, l + 2, tp + 4, w, h, 15, INK, 0.12); RR(x, l, tp, w, h, 15, '#fff', 0.96);
    const px0 = l + 5, py0 = tp + 5, pw = w - 10, ph = h - 10;
    x.save(); x.beginPath(); x.roundRect(px0, py0, pw, ph, 11); x.clip();
    const g = x.createLinearGradient(0, py0, 0, py0 + ph); g.addColorStop(0, PANE_T[m]); g.addColorStop(1, PANE_B[m]); x.fillStyle = g; x.fillRect(px0, py0, pw, ph);
    weather(x, m, px0 + pw / 2, py0 + ph / 2 + 1, mix(PANE_T[m], PANE_B[m], 110 / 255), t);
    E(x, px0 - 2, py0 - 2, 12, 24, PINK, 0.85); E(x, px0 + pw + 2, py0 - 2, 12, 24, PINK, 0.85);
    x.restore();
    RR(x, l - 4, tp + h - 3, w + 8, 7, 3, '#fff'); RR(x, l + 9, tp + h + 3, w - 18, 9, 3, '#FAA0C4');
    ['#82BEFA', BUTTER, PINK].forEach((col, k) => { const fx = l + 18 + k * (w - 36) / 2; E(x, fx, tp + h + 1, 3.2, 3.2, col); E(x, fx, tp + h + 1, 1.2, 1.2, '#fff'); });
    TXT(x, MOODS[m], l + w / 2, tp + h + 28, 14, INK, 700, 'center');
  }
  const statText = p => p.stat >= 8 ? (p.custom || STATUS[0]) : STATUS[p.stat];
  const statCol = p => STATUS_COL[p.stat >= 8 ? p.statCol % 8 : p.stat];
  function badge(x, p, cx, y, t, big = true) {
    const s = statText(p), w = TW(x, s, 14) + (big ? 36 : 28), h = big ? 24 : 20, l = cx - w / 2, col = statCol(p), pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    if (big) RR(x, l + 1, y + 3, w, h, h / 2, INK, 0.12);
    RR(x, l, y, w, h, h / 2, '#fff', 0.96);
    const dx = l + (big ? 14 : 11), dy = y + h / 2;
    E(x, dx, dy, 6 + 2 * pulse, 6 + 2 * pulse, col, 0.25 + 0.15 * pulse); E(x, dx, dy, 4.2, 4.2, col);
    TXT(x, s, l + (big ? 25 : 20), y + h / 2 + 5, 14, INK);
    return w;
  }
  function speech(x, s, cx, y) {
    const w = TW(x, s, 14) + 20, l = Math.max(8, Math.min(154 - w, cx - w / 2));
    RR(x, l + 1, y + 3, w, 24, 12, INK, 0.1); TRI(x, l + w * 0.62, y + 20, l + w * 0.62 + 12, y + 20, l + w * 0.62 + 8, y + 31, '#fff', 0.97);
    RR(x, l, y, w, 24, 12, '#fff', 0.97); TXT(x, s, l + 10, y + 17, 14, INK);
  }

  // ── home, with its own little life ──
  const st = { clouds: [[40, 86, 0.95, 0.10], [196, 150, 0.62, 0.07], [60, 200, 0.78, 0.085]].map(([x, y, s, v]) => ({ x, y, s, v })),
    hearts: [], doze: 0, dozing: false, drawer: false, drawerT: 0, hop: -1e9, wave: -1e9, blinkUntil: 0, nextBlink: 0, look: 0, lookUntil: 0, nextAct: 0,
    say: '', sayUntil: 0, happyUntil: 0, lastTouch: performance.now() };
  function hearts(px, py, n) { for (let i = 0; i < n; i++) st.hearts.push({ x: px + Math.random() * 16 - 8, y: py + Math.random() * 12 - 6, vx: Math.random() * 1.2 - 0.6, vy: -0.9 - Math.random() * 0.7, life: 1, k: st.hearts.length }); }
  function drawHearts(x) { st.hearts = st.hearts.filter(h => (h.x += h.vx, h.y += h.vy, h.vy *= 0.985, h.life -= 0.018) > 0); st.hearts.forEach(h => HEART(x, h.x, h.y, 4.5, h.k % 3 === 1 ? '#82BAFA' : PINK, Math.min(1, h.life * 1.6))); }
  function wake(now) { st.hop = now; st.wave = now; st.happyUntil = now + 1500; st.say = HELLO[Math.random() * 4 | 0]; st.sayUntil = now + 1800; st.nextAct = now + 6000; }
  const drawerTop = () => { let e = Math.min(1, st.drawerT); e = 1 - (1 - e) ** 3; return 280 - 254 * e; };
  const drawerXY = (i, yS) => [31 + (i % 4) * 59, yS + 70 + (i / 4 | 0) * 70];

  function home(x, p, env) {
    const now = performance.now(), t = now / 1000;
    const idle = !st.drawer && now - st.lastTouch > 12000;
    if (idle && !st.dozing) st.dozing = true;
    if (!idle && st.dozing) { st.dozing = false; wake(now); }
    st.doze += ((st.dozing ? 1 : 0) - st.doze) * 0.05;
    st.drawerT += ((st.drawer ? 1 : 0) - st.drawerT) * 0.28;
    x.drawImage(sky(), 0, 0);
    st.clouds.forEach(c => { c.x += c.v * (st.dozing ? 0.4 : 1); if (c.x - 32 * c.s > W) c.x = -32 * c.s; CLOUD(x, c.x, c.y, c.s); });
    [[22, 104], [132, 24], [150, 210], [16, 176], [226, 196], [104, 76]].forEach(([sx, sy], i) => { const ph = (env.frame + i * 11) % 60, r = (ph < 30 ? ph : 60 - ph) / 7 | 0; if (r > 0) sparkle(x, sx, sy, r); });
    if (st.doze > 0.03) {
      x.fillStyle = `rgba(110,92,186,${st.doze * 95 / 255})`; x.fillRect(0, 0, W, H);
      [[30, 30], [90, 20], [140, 50], [210, 22], [20, 140], [60, 90], [220, 150]].forEach(([sx, sy], i) => STAR(x, sx, sy, 2 + 1.6 * (0.5 + 0.5 * Math.sin(t * 2 + i)), '#fff', st.doze * 0.9));
    }
    const b = (env.bat || 76) + '%', bw = TW(x, b, 14);
    TXT(x, b, 226 - bw, 19, 14, INK);
    HEART(x, 226 - bw - 12, 14, 5, env.connected ? PINK : '#fff', env.connected ? 1 : 0.8);
    const d = new Date(), h = d.getHours(), tm = h + ':' + String(d.getMinutes()).padStart(2, '0');
    TXT(x, tm, 17, 47, 28, '#fff', 800, 'left', NUN, 0.8); TXT(x, tm, 16, 46, 28, INK, 800);
    TXT(x, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()], 18, 66, 14, INK2);
    moodWindow(x, p, 162, 30, 62, 62, t);
    if (!st.dozing && !st.drawer && now > st.nextAct) {
      const r = Math.random() * 3 | 0;
      if (r === 0) { st.look = Math.random() < 0.5 ? -1 : 1; st.lookUntil = now + 1300; } else if (r === 1) st.wave = now; else st.hop = now;
      st.nextAct = now + 5000 + Math.random() * 7000;
    }
    if (now > st.nextBlink) { st.blinkUntil = now + 130; st.nextBlink = now + 2200 + Math.random() * 3200; }
    const hop = now - st.hop < 520 ? -Math.sin((now - st.hop) / 520 * Math.PI) * 14 : 0;
    const bob = st.dozing ? Math.sin(t * 1.3) * 2.2 : Math.sin(t * 2.4) * 1.2;
    const wave = now - st.wave < 1700 ? 0.5 + 0.5 * Math.sin((now - st.wave) * 0.013) : 0;
    const face = st.doze > 0.5 ? 'doze' : now < st.happyUntil ? 'joy' : FACES[p.mood % 9];
    avatar(x, p, 120, 150 + bob + hop, 1, { face, blink: now < st.blinkUntil, look: now < st.lookUntil ? st.look : 0, wave: st.dozing ? 0 : wave, body: true, gy: 229 });
    if (st.doze > 0.3) for (let k = 0; k < 3; k++) { const ph = (t * 0.45 + k / 3) % 1; TXT(x, k === 1 ? 'Z' : 'z', 82 - (ph * 22 - Math.sin(ph * 9) * 3), 114 - ph * 38, k === 1 ? 19 : 14, '#fff', 800, 'left', NUN, Math.sin(ph * Math.PI) * st.doze); }
    if (now < st.sayUntil && !st.dozing) speech(x, st.say, 86, 74);
    badge(x, p, 120, 236, t);
    RR(x, 100, 268, 40, 5, 2.5, '#fff', 0.85);
    drawHearts(x);
    if (st.drawerT > 0.01) {
      const yS = drawerTop();
      x.fillStyle = `rgba(98,62,128,${Math.min(1, st.drawerT) * 60 / 255})`; x.fillRect(0, 0, W, H);
      RR(x, 0, yS, W, 320, 24, '#fff', 0.9); RR(x, 100, yS + 8, 40, 5, 2.5, INK2, 0.55);
      TXT(x, 'where to?', 120, yS + 38, 19, INK, 800, 'center');
      DRAWER.forEach(([m, name], i) => {
        const [bx, by] = drawerXY(i, yS);
        if (by - 20 > H) return;
        E(x, bx, by + 3, 20, 20, INK, 0.12); E(x, bx, by, 20, 20, BUB[i % 4]); E(x, bx - 6, by - 8, 7, 4.5, '#fff', 0.45);
        if (m === 13) { E(x, bx, by + 1, 10, 9.5, '#fff'); E(x, bx - 3.5, by + 1, 1.3, 1.7, BUB[0]); E(x, bx + 3.5, by + 1, 1.3, 1.7, BUB[0]); ARC(x, bx, by + 2.5, 3, 0.6, 2.54, 1.3, BUB[0]); }
        else if (env.glyph) env.glyph(m, bx, by, 24);
        TXT(x, name, bx, by + 36, 14, INK, 700, 'center');
      });
    }
  }
  // a tap on the preview of home: returns what it did ('mood', 'status', a mode number to open, or nothing)
  function tap(px, py) {
    const now = performance.now();
    if (st.dozing) { st.lastTouch = now; return null; }
    st.lastTouch = now;
    if (st.drawer) {
      const yS = drawerTop();
      if (py < yS + 48) { st.drawer = false; return null; }
      for (let i = 0; i < DRAWER.length; i++) { const [bx, by] = drawerXY(i, yS); if ((px - bx) ** 2 + (py - by) ** 2 <= 900) { st.drawer = false; st.drawerT = 0; return DRAWER[i][0]; } }
      return null;
    }
    if (px >= 152 && py >= 24 && py <= 128) return 'mood';
    if (py >= 230 && py < 264 && Math.abs(px - 120) < 90) return 'status';
    if (py >= 262) { st.drawer = true; return null; }
    if (Math.abs(px - 120) < 46 && py >= 96 && py < 230) return 13;
    if (px < 120 && py < 74) return 0;
    hearts(px, py, 3); st.happyUntil = now + 900; return null;
  }
  function swipe(dir) { st.lastTouch = performance.now(); if (dir === 'up') st.drawer = true; else if (dir === 'down') st.drawer = false; }
  function shake() { const now = performance.now(); st.lastTouch = now; st.hop = now; st.happyUntil = now + 1500; st.say = KIND[Math.random() * KIND.length | 0]; st.sayUntil = now + 2600; hearts(120, 120, 6); }
  function poke() { st.lastTouch = performance.now(); }

  // ── bio card ──
  function wrap(x, s, maxW, max) {
    const out = []; let line = '';
    for (const para of String(s).split('\n')) {
      for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (TW(x, t, 14) <= maxW) line = t; else { if (line) out.push(line); line = w; } if (out.length >= max) return out; }
      out.push(line); line = '';
      if (out.length >= max) return out;
    }
    return out.filter((l, i) => l || i < out.length - 1).slice(0, max);
  }
  let bioHearts = [], bioHappy = 0;
  function bio(x, p) {
    const now = performance.now();
    x.drawImage(sky(), 0, 0); CLOUD(x, 196, 18, 0.7);
    RR(x, 14, 30, 214, 242, 22, INK, 0.1); RR(x, 12, 26, 216, 242, 22, '#fff', 0.96);
    E(x, 56, 76, 35, 35, BLUEL); ARC(x, 56, 76, 35, 0, 7, 3, PINKL);
    const name = p.name || 'me', hw = TW(x, name, 30, 400, HAND);
    if (hw <= 120) TXT(x, name, 100, 70, 30, INK, 400, 'left', HAND);
    else { const px = TW(x, name, 28, 800) <= 120 ? 28 : TW(x, name, 19, 800) <= 120 ? 19 : 14; TXT(x, name, 100, 66, px, INK, px === 14 ? 700 : 800); }
    let ny = 88;
    if (p.pron) { TXT(x, p.pron, 101, ny, 14, INK2); ny += 18; }
    E(x, 105, ny - 5, 4, 4, statCol(p)); TXT(x, statText(p), 113, ny, 14, INK);
    const feel = 'feeling ' + MOODS[p.mood % 9], fw = TW(x, feel, 14), fx = 120 - fw / 2;
    for (let xx = 28; xx < fx - 12; xx += 8) E(x, xx, 125, 1.3, 1.3, PINK, 0.7);
    for (let xx = 212; xx > fx + fw + 10; xx -= 8) E(x, xx, 125, 1.3, 1.3, PINK, 0.7);
    TXT(x, feel, fx, 130, 14, INK2);
    wrap(x, p.bio || '', 190, 5).forEach((l, i) => TXT(x, l, 26, 152 + i * 17, 14, INK));
    let cx = 24, cy = 222, k = 0;
    for (const raw of String(p.likes || '').split(',')) {
      const it = raw.trim(); if (!it) continue;
      const w = TW(x, it, 14) + 18;
      if (cx + w > 218) { if (cy > 222) break; cx = 24; cy += 24; }
      if (cx + w > 218) break;
      RR(x, cx, cy, w, 21, 10.5, BUB[k % 4], 0.32); TXT(x, it, cx + 9, cy + 15, 14, INK); cx += w + 6; k++;
    }
    x.save(); x.beginPath(); x.rect(21, 41, 71, 71); x.clip();
    if (now > st.nextBlink) { st.blinkUntil = now + 130; st.nextBlink = now + 2200 + Math.random() * 3200; }
    avatar(x, p, 56, 82 + Math.sin(now / 420), 0.68, { face: now < bioHappy ? 'joy' : undefined, blink: now < st.blinkUntil });
    x.restore();
    [[24, 36], [218, 40], [222, 250], [18, 214]].forEach(([sx, sy], i) => { const b = 0.5 + 0.5 * Math.sin(now / 380 + i * 1.7); STAR(x, sx, sy, 2.5 + 2.5 * b, PINK, 0.4 + 0.5 * b); });
    bioHearts = bioHearts.filter(h => (h.x += h.vx, h.y += h.vy, h.vy *= 0.985, h.life -= 0.018) > 0);
    bioHearts.forEach(h => HEART(x, h.x, h.y, 4.5, PINK, Math.min(1, h.life * 1.6)));
  }
  function bioTap(px, py) { for (let i = 0; i < 4; i++) bioHearts.push({ x: px + Math.random() * 16 - 8, y: py, vx: Math.random() * 1.2 - 0.6, vy: -0.9 - Math.random() * 0.7, life: 1 }); bioHappy = performance.now() + 1200; }

  // a standalone portrait, for the editor
  function portrait(x, p, w, h) {
    x.clearRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#FFD6EA'); g.addColorStop(1, '#C4E8FF'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    CLOUD(x, w * 0.22, h * 0.2, 0.6); CLOUD(x, w * 0.8, h * 0.32, 0.45);
    const now = performance.now(), s = Math.min(w, h) / 170;
    if (now > st.nextBlink) { st.blinkUntil = now + 130; st.nextBlink = now + 2200 + Math.random() * 3200; }
    avatar(x, p, w / 2, h * 0.36 + Math.sin(now / 420) * s, s, { blink: now < st.blinkUntil, body: true, gy: h * 0.36 + 79 * s });
  }

  window.Cotton = { MOODS, STATUS, STATUS_COL, TONES, HAIRS, HCOLS, OUTFITS, ACCS, defaults, home, bio, bioTap, tap, swipe, shake, poke, portrait, sky };
})();
