"""No-ML baseline: 1-nearest-neighbour with DTW on all six channels.  python3 baseline.py data.json

Each take is trimmed to its active part, the gyro offset and the starting gravity are taken out, it is
downsampled to 50 Hz, and gyro is scaled so 200 dps counts like 1 g. Reports:
  1. few-shot accuracy: k templates per class (as if you taught it k times), the rest tested
  2. rejection: spells vs "not a spell" by distance to the nearest spell template
  3. teach-your-own: your custom gestures enrolled from 5 takes, tested against everything
"""
import ctypes, os, subprocess, sys, tempfile
import numpy as np
from spells_data import load, gyro_bias, active

here = os.path.dirname(os.path.abspath(__file__))
lib_path = os.path.join(tempfile.gettempdir(), 'larp_dtw.so')
if not os.path.exists(lib_path) or os.path.getmtime(lib_path) < os.path.getmtime(os.path.join(here, 'dtw.c')):
    subprocess.check_call(['cc', '-O3', '-shared', '-fPIC', '-o', lib_path, os.path.join(here, 'dtw.c')])
lib = ctypes.CDLL(lib_path)
lib.dtw.restype = ctypes.c_double
lib.dtw.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int]


def feat(t):
    x = t['x']
    b, g0 = gyro_bias(x), x[:25, :3].mean(0)
    a = active(x)
    f = np.concatenate([a[:, :3] - g0, (a[:, 3:] - b) / 200.0], 1)[::2]
    return np.ascontiguousarray(f, dtype=np.float32)


def dist(a, b):
    return lib.dtw(a.ctypes.data, len(a), b.ctypes.data, len(b), a.shape[1], max(8, int(0.25 * max(len(a), len(b)))))


takes = [t for t in load(sys.argv[1]) if t['group'] != 'calibrate']
F = [feat(t) for t in takes]
L = np.array([t['label'] for t in takes])
G = np.array([t['group'] for t in takes])
N = len(takes)
D = np.zeros((N, N))
for i in range(N):
    for j in range(i + 1, N):
        D[i, j] = D[j, i] = dist(F[i], F[j])
rng = np.random.default_rng(0)

spells = ['circle', 'zigzag', 'flick', 'heart']
print(f'{N} takes: ' + ', '.join(f'{l} {int((L == l).sum())}' for l in dict.fromkeys(L)))

print('\n1. few-shot, closed set (circle, zigzag, flick, heart, none): k templates per class, 200 random splits')
classes = spells + ['none']
for k in (1, 3, 5, 10):
    acc, conf = [], np.zeros((5, 5), int)
    for _ in range(200):
        tmpl, test = [], []
        for ci, c in enumerate(classes):
            idx = rng.permutation(np.where(L == c)[0]); tmpl += [(i, ci) for i in idx[:k]]; test += [(i, ci) for i in idx[k:]]
        ti = np.array([i for i, _ in tmpl]); tc = np.array([c for _, c in tmpl])
        for i, ci in test:
            p = tc[np.argmin(D[i, ti])]; conf[ci, p] += 1; acc.append(p == ci)
    print(f'  k={k:2d}: {np.mean(acc) * 100:5.1f}%')
    if k == 5:
        c5 = conf
print('  confusion at k=5 (rows = truth, % of row):')
print('            ' + ' '.join(f'{c[:6]:>7s}' for c in classes))
for ci, c in enumerate(classes):
    print(f'  {c:9s} ' + ' '.join(f'{v:7.1f}' for v in c5[ci] / c5[ci].sum() * 100))

print('\n2. rejection without a "none" class: 5 templates per spell; is the nearest spell close enough?')
best = None
for thr_q in (0.5, 0.7, 0.8, 0.9, 0.95, 1.0):
    ok_s, ok_n, wrong = [], [], 0
    for _ in range(100):
        tmpl = {c: rng.permutation(np.where(L == c)[0])[:5] for c in spells}
        ti = np.concatenate(list(tmpl.values())); tc = np.concatenate([[c] * 5 for c in spells])
        # threshold from the templates themselves: spread of each class's within-template distances
        within = np.concatenate([D[np.ix_(v, v)][np.triu_indices(5, 1)] for v in tmpl.values()])
        thr = np.quantile(within, thr_q) * 1.0
        for i in range(N):
            if i in ti or L[i] not in spells + ['none']: continue
            j = np.argmin(D[i, ti]); d = D[i, ti[j]]
            if L[i] == 'none': ok_n.append(d > thr)
            else:
                ok_s.append(d <= thr and tc[j] == L[i]); wrong += d <= thr and tc[j] != L[i]
    print(f'  threshold = {int(thr_q * 100):3d}th pct of template spread: spells recognised {np.mean(ok_s) * 100:5.1f}%   "none" rejected {np.mean(ok_n) * 100:5.1f}%')

custom = [l for l in dict.fromkeys(L[G == 'custom'])]
if custom:
    print('\n3. teach-your-own: each custom gesture enrolled from 5 takes, with 5 templates of each spell too')
    for c in custom:
        hits, steals, n_other = [], 0, 0
        for _ in range(200):
            cid = rng.permutation(np.where(L == c)[0]); enrol, test = cid[:5], cid[5:]
            tmpl = {s: rng.permutation(np.where(L == s)[0])[:5] for s in spells}; tmpl[c] = enrol
            ti = np.concatenate(list(tmpl.values())); tc = np.concatenate([[s] * len(v) for s, v in tmpl.items()])
            for i in test: hits.append(tc[np.argmin(D[i, ti])] == c)
            for i in np.where((L != c) & np.isin(L, spells))[0]:
                if i in ti: continue
                n_other += 1; steals += tc[np.argmin(D[i, ti])] == c
        print(f'  {c}: its own takes recognised {np.mean(hits) * 100:5.1f}%   spells wrongly taken as it {steals / n_other * 100:4.1f}%')
