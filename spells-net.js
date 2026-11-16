// The spell engine for the website: the same network and pipeline as the charm (firmware/LarpCharm/spells_engine.h),
// with the weights from spells-model.js. firmware/tools/spells/test_net.js checks it against PyTorch.
(function (root) {
  const f32 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Float32Array(u.buffer); };
  let M = null;
  function model() {
    if (M) return M;
    const S = root.SPELL_MODEL; if (!S) return null;
    M = { ...S, layers: S.layers.map(L => ({ ...L, w: f32(L.w), b: f32(L.b) })), linW: f32(S.linW), linB: f32(S.linB), proto: f32(S.proto),
      tpl: S.tpl.map(t => ({ c: t.c, d: f32(t.d) })) };
    return M;
  }
  // raw: Int16Array of n x [ax ay az gx gy gz]; returns n x 6 floats (the active part)
  function segment(raw, n, aLsb, gLsb) {
    const m = model(), lead = Math.min(n, m.lead), b = [0, 0, 0], g0 = [0, 0, 0];
    for (let i = 0; i < lead; i++) for (let c = 0; c < 3; c++) { g0[c] += raw[i * 6 + c] / aLsb; b[c] += raw[i * 6 + 3 + c] / gLsb; }
    for (let c = 0; c < 3; c++) { g0[c] /= lead; b[c] /= lead; }
    let first = -1, last = -1;
    for (let i = 0; i < n; i++) {
      let s = 0; for (let c = 0; c < 3; c++) { const d = raw[i * 6 + 3 + c] / gLsb - b[c]; s += d * d; }
      if (Math.sqrt(s) > m.actDps) { if (first < 0) first = i; last = i; }
    }
    let lo = 0, hi = n;
    if (first >= 0) { lo = Math.max(0, first - m.pad); hi = Math.min(n, last + 1 + m.pad); }
    if (hi - lo < 4) { lo = 0; hi = n; }
    const seg = new Float32Array((hi - lo) * 6);
    for (let i = lo; i < hi; i++) for (let c = 0; c < 3; c++) { seg[(i - lo) * 6 + c] = raw[i * 6 + c] / aLsb - g0[c]; seg[(i - lo) * 6 + 3 + c] = (raw[i * 6 + 3 + c] / gLsb - b[c]) / 200; }
    return seg;
  }
  function input(seg) {
    const T = model().T, n = seg.length / 6, x = new Float32Array(7 * T);
    for (let t = 0; t < T; t++) {
      const p = t * (n - 1) / (T - 1), i0 = Math.min(n - 1, Math.floor(p)), i1 = Math.min(n - 1, i0 + 1), u = p - i0;
      for (let c = 0; c < 6; c++) x[c * T + t] = seg[i0 * 6 + c] * (1 - u) + seg[i1 * 6 + c] * u;
      x[6 * T + t] = Math.log(n / 100);
    }
    return x;
  }
  function embed(x) {
    const m = model(); let src = x, len = m.T;
    for (const L of m.layers) {
      const outLen = Math.floor((len + 2 * L.p - L.k) / L.s) + 1, dst = new Float32Array(L.o * outLen);
      for (let o = 0; o < L.o; o++) for (let t = 0; t < outLen; t++) {
        let s = L.b[o]; const base = t * L.s - L.p;
        for (let i = 0; i < L.i; i++) { const wo = (o * L.i + i) * L.k, xo = i * len; for (let k = 0; k < L.k; k++) { const p = base + k; if (p >= 0 && p < len) s += L.w[wo + k] * src[xo + p]; } }
        dst[o * outLen + t] = s > 0 ? s : 0;
      }
      src = dst; len = outLen;
    }
    const ch = m.layers.at(-1).o, pooled = new Float32Array(ch), e = new Float32Array(m.emb);
    for (let c = 0; c < ch; c++) { let s = 0; for (let t = 0; t < len; t++) s += src[c * len + t]; pooled[c] = s / len; }
    let nrm = 0;
    for (let k = 0; k < m.emb; k++) { let s = m.linB[k]; for (let c = 0; c < ch; c++) s += m.linW[k * ch + c] * pooled[c]; e[k] = s; nrm += s * s; }
    nrm = Math.sqrt(nrm) + 1e-12; for (let k = 0; k < m.emb; k++) e[k] /= nrm;
    return e;
  }
  // a take -> { scores: [{label, sim}] best first, label (or null: no match), sim }
  function classify(raw, n, aLsb, gLsb) {
    const m = model(); if (!m) return null;
    const e = embed(input(segment(raw, n, aLsb, gLsb)));
    const scores = m.classes.map((label, c) => { let s = 0; for (let k = 0; k < m.emb; k++) s += e[k] * m.proto[c * m.emb + k]; return { label, sim: s }; }).sort((a, b) => b.sim - a.sim);
    const top = scores[0], cast = top.label !== 'none' && top.sim >= m.baseThr;
    return { scores, label: cast ? top.label : null, sim: top.sim, emb: e };
  }
  root.SpellNet = { model, segment, input, embed, classify };
})(typeof window !== 'undefined' ? window : globalThis);
