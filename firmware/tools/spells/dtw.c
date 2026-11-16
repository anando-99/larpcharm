// DTW distance between two multichannel series (row-major, n x ch), with a Sakoe-Chiba band.
#include <math.h>
#include <stdlib.h>
double dtw(const float *a, int na, const float *b, int nb, int ch, int band) {
  double *prev = malloc((nb + 1) * sizeof(double)), *cur = malloc((nb + 1) * sizeof(double));
  for (int j = 0; j <= nb; j++) prev[j] = INFINITY;
  prev[0] = 0;
  if (band < abs(na - nb)) band = abs(na - nb);
  for (int i = 1; i <= na; i++) {
    for (int j = 0; j <= nb; j++) cur[j] = INFINITY;
    int lo = i - band < 1 ? 1 : i - band, hi = i + band > nb ? nb : i + band;
    for (int j = lo; j <= hi; j++) {
      double c = 0;
      for (int k = 0; k < ch; k++) { double d = a[(i - 1) * ch + k] - b[(j - 1) * ch + k]; c += d * d; }
      c = sqrt(c);
      double m = prev[j - 1]; if (prev[j] < m) m = prev[j]; if (cur[j - 1] < m) m = cur[j - 1];
      cur[j] = c + m;
    }
    double *t = prev; prev = cur; cur = t;
  }
  double r = prev[nb] / (na + nb);
  free(prev); free(cur);
  return r;
}
