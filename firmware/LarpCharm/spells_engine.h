// The spell engine: turns a recorded take into a fingerprint with the network in spells_model.h, and measures
// DTW distances to stored recordings. Plain C++ with no Arduino code, so firmware/tools/spells/test_engine.cpp
// can check it on a computer against PyTorch. It mirrors firmware/tools/spells/spells_model.py line for line.
#pragma once
#pragma GCC optimize("O2")                    // the sketch builds with -Os; the network wants the faster loops
#include <math.h>
#include <stdint.h>
#include "spells_model.h"

#define SPL_MAX_ROWS 1200
#define SPL_BUF 4096                          // floats per scratch buffer (the widest layer: 64 x 64)

// 1-3. The active part of a take, as channels: accel minus the starting gravity (g), (gyro minus its offset) / 200.
// raw: n rows of [ax ay az gx gy gz]. Writes up to n rows of 6 floats to seg; returns the row count.
static int spl_segment(const int16_t *raw, int n, float aLsb, float gLsb, float *seg) {
  if (n < 4) return 0;
  int lead = n < SPL_LEAD ? n : SPL_LEAD;
  float b[3] = {0, 0, 0}, g0[3] = {0, 0, 0};
  for (int i = 0; i < lead; i++) for (int c = 0; c < 3; c++) { g0[c] += raw[i * 6 + c] / aLsb; b[c] += raw[i * 6 + 3 + c] / gLsb; }
  for (int c = 0; c < 3; c++) { g0[c] /= lead; b[c] /= lead; }
  int first = -1, last = -1;
  for (int i = 0; i < n; i++) {
    float s = 0;
    for (int c = 0; c < 3; c++) { float d = raw[i * 6 + 3 + c] / gLsb - b[c]; s += d * d; }
    if (sqrtf(s) > SPL_ACT_DPS) { if (first < 0) first = i; last = i; }
  }
  int lo = 0, hi = n;
  if (first >= 0) { lo = first - SPL_PAD; hi = last + 1 + SPL_PAD; if (lo < 0) lo = 0; if (hi > n) hi = n; }
  if (hi - lo < 4) { lo = 0; hi = n; }
  for (int i = lo; i < hi; i++) for (int c = 0; c < 3; c++) {
    seg[(i - lo) * 6 + c] = raw[i * 6 + c] / aLsb - g0[c];
    seg[(i - lo) * 6 + 3 + c] = (raw[i * 6 + 3 + c] / gLsb - b[c]) / 200.0f;
  }
  return hi - lo;
}

// 4. Resampled to SPL_T steps (linear), channel-major, plus log(duration in seconds) as a 7th channel.
static void spl_input(const float *seg, int n, float *in) {
  for (int t = 0; t < SPL_T; t++) {
    float p = t * (float)(n - 1) / (SPL_T - 1);
    int i0 = (int)p; if (i0 > n - 1) i0 = n - 1;
    int i1 = i0 + 1 < n ? i0 + 1 : n - 1;
    float u = p - i0;
    for (int c = 0; c < 6; c++) in[c * SPL_T + t] = seg[i0 * 6 + c] * (1 - u) + seg[i1 * 6 + c] * u;
    in[6 * SPL_T + t] = logf(n / 100.0f);
  }
}

// The network: four convolutions (batch norm folded in) with ReLU, the mean over time, a linear layer, L2 norm.
// a and b are scratch buffers of SPL_BUF floats.
static void spl_embed(const float *in, float *emb, float *a, float *b) {
  const float *src = in;
  int len = SPL_T;
  float *dst = a;
  for (int l = 0; l < SPL_LAYERS_N; l++) {
    const SplLayer &L = SPL_LAYERS[l];
    int outLen = (len + 2 * L.pad - L.k) / L.stride + 1;
    // loop order o, i, k, t: each weight is read once (they live in flash), the rows stream through RAM
    for (int o = 0; o < L.out; o++) {
      float *row = dst + o * outLen;
      for (int t = 0; t < outLen; t++) row[t] = L.b[o];
      for (int i = 0; i < L.in; i++) {
        const float *x = src + i * len, *wi = L.w + (o * L.in + i) * L.k;
        for (int k = 0; k < L.k; k++) {
          float w = wi[k];
          int off = k - L.pad;                                    // input index = t * stride + off
          int t0 = off < 0 ? (-off + L.stride - 1) / L.stride : 0;
          int t1 = (len - 1 - off) / L.stride + 1; if (t1 > outLen) t1 = outLen;
          const float *xp = x + t0 * L.stride + off;
          for (int t = t0; t < t1; t++, xp += L.stride) row[t] += w * *xp;
        }
      }
      for (int t = 0; t < outLen; t++) if (row[t] < 0) row[t] = 0;
    }
    src = dst; len = outLen; dst = (dst == a) ? b : a;
  }
  int ch = SPL_LAYERS[SPL_LAYERS_N - 1].out;
  float pooled[64];
  for (int c = 0; c < ch; c++) { float s = 0; for (int t = 0; t < len; t++) s += src[c * len + t]; pooled[c] = s / len; }
  float nrm = 0;
  for (int e = 0; e < SPL_EMB; e++) {
    float s = SPL_LIN_B[e];
    for (int c = 0; c < ch; c++) s += SPL_LIN_W[e * ch + c] * pooled[c];
    emb[e] = s; nrm += s * s;
  }
  nrm = sqrtf(nrm) + 1e-12f;
  for (int e = 0; e < SPL_EMB; e++) emb[e] /= nrm;
}

static float spl_dot(const float *x, const float *y, int n) { float s = 0; for (int i = 0; i < n; i++) s += x[i] * y[i]; return s; }

// DTW between two series of 6-channel rows, per step, with a band of a quarter of the longer one.
// rows: scratch of 2 * (nb + 1) floats.
static float spl_dtw(const float *x, int na, const float *y, int nb, float *rows) {
  float *prev = rows, *cur = rows + nb + 1;
  int band = (na > nb ? na : nb) / 4; if (band < 8) band = 8;
  int diff = na > nb ? na - nb : nb - na; if (band < diff) band = diff;
  for (int j = 0; j <= nb; j++) prev[j] = INFINITY;
  prev[0] = 0;
  for (int i = 1; i <= na; i++) {
    for (int j = 0; j <= nb; j++) cur[j] = INFINITY;
    int lo = i - band < 1 ? 1 : i - band, hi = i + band > nb ? nb : i + band;
    for (int j = lo; j <= hi; j++) {
      float c = 0;
      for (int k = 0; k < 6; k++) { float d = x[(i - 1) * 6 + k] - y[(j - 1) * 6 + k]; c += d * d; }
      c = sqrtf(c);
      float m = prev[j - 1]; if (prev[j] < m) m = prev[j]; if (cur[j - 1] < m) m = cur[j - 1];
      cur[j] = c + m;
    }
    float *t = prev; prev = cur; cur = t;
  }
  return prev[nb] / (na + nb);
}

// a segment at 50 Hz, as stored recordings are kept (every other row)
static int spl_dtw_feat(const float *seg, int n, float *out) {
  int m = 0;
  for (int i = 0; i < n; i += 2, m++) for (int c = 0; c < 6; c++) out[m * 6 + c] = seg[i * 6 + c];
  return m;
}
