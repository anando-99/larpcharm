// Checks the charm's spell engine (spells_engine.h) against PyTorch, on a computer:
//   c++ -O2 -std=c++17 -o /tmp/test_engine test_engine.cpp && /tmp/test_engine
// Each test take must give the same fingerprint PyTorch gave it (model/testvec.h, written by train.py).
#include <stdio.h>
#include <math.h>
#include "../../LarpCharm/spells_engine.h"
#include "model/testvec.h"

static float seg[SPL_MAX_ROWS * 6], in[SPL_IN * SPL_T], A[SPL_BUF], B[SPL_BUF], emb[SPL_EMB];

int main() {
  int bad = 0;
  for (int k = 0; k < TV_N; k++) {
    int n = spl_segment(TV[k].raw, TV[k].n, 4096.0f, 16.0f, seg);
    spl_input(seg, n, in);
    spl_embed(in, emb, A, B);
    float md = 0; for (int e = 0; e < SPL_EMB; e++) md = fmaxf(md, fabsf(emb[e] - TV[k].emb[e]));
    int best = 0; float bs = -2;
    for (int c = 0; c < SPL_CLASSES; c++) { float s = spl_dot(emb, SPL_PROTO + c * SPL_EMB, SPL_EMB); if (s > bs) { bs = s; best = c; } }
    printf("%-8s rows %4d -> active %3d   fingerprint max diff vs pytorch %.2e   class %-7s %.3f %s\n",
           TV[k].label, TV[k].n, n, md, SPL_NAMES[best], bs, md < 1e-3 ? "ok" : "MISMATCH");
    bad += md >= 1e-3;
  }
  printf(bad ? "FAILED\n" : "all match\n");
  return bad != 0;
}
