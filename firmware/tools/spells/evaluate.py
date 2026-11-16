"""Honest numbers for the whole spell engine, as it runs on the charm.  python3 evaluate.py data.json [out.json]

1. Base spells, 5-fold cross-validation: the CNN picks the nearest class prototype and says "no match" when
   that is `none` or when the similarity is under a threshold (swept here, chosen for the firmware).
2. Teach-your-own, leave-one-gesture-out: the network is trained WITHOUT one gesture, which is then taught
   from 5 takes like a new spell. Each held-out spell (and the custom gestures) gets a turn. Three ways of
   recognising the taught gesture are compared:
     cnn      its prototype (mean fingerprint of the 5 takes) beats every base prototype
     dtw      the nearest stored recording (5 per base spell, its 5) by DTW is one of its own
     hybrid   dtw, within 2x the spread of its 5 recordings, and the CNN doesn't veto it (similarity to its
              prototype >= 0.3, and not more sure it's `none`). This is the rule the charm uses.
"""
import json, sys
import numpy as np
from spells_data import load
from spells_model import BASE, segment, train, embed, prototypes
from dtw import dist, dtw_feat

takes = load(sys.argv[1])
base = [t for t in takes if t['label'] in BASE]
cust = [t for t in takes if t['group'] == 'custom']
S = [segment(t['x']) for t in base]; Y = np.array([BASE.index(t['label']) for t in base])
NONE = BASE.index('none')
report = {'takes': len(base) + len(cust), 'labels': {l: int(sum(t['label'] == l for t in base + cust)) for l in dict.fromkeys(t['label'] for t in base + cust)}}

# ── 1. base spells, 5-fold CV ──
rng = np.random.default_rng(1)
folds = np.zeros(len(base), int)
for c in range(len(BASE)):
    idx = rng.permutation(np.where(Y == c)[0]); folds[idx] = np.arange(len(idx)) % 5
sim = np.zeros((len(base), len(BASE)))
for f in range(5):
    tr, te = folds != f, folds == f
    net = train([S[i] for i in np.where(tr)[0]], Y[tr], seed=f)
    P = prototypes(embed(net, [S[i] for i in np.where(tr)[0]]), Y[tr], len(BASE))
    sim[te] = embed(net, [S[i] for i in np.where(te)[0]]) @ P.T
    print(f'cv fold {f + 1}/5', flush=True)
pred, best = sim.argmax(1), sim.max(1)
spell = Y != NONE
print('\n1. base spells, 5-fold CV')
sweep = []
for thr in (0.0, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9):
    cast = (pred != NONE) & (best >= thr)
    right = np.mean(cast[spell] & (pred[spell] == Y[spell])); wrong = np.mean(cast[spell] & (pred[spell] != Y[spell]))
    none_ok = np.mean(~cast[~spell])
    sweep.append({'threshold': thr, 'spells_right': right, 'spells_wrong': wrong, 'none_rejected': none_ok})
    print(f'  threshold {thr:.2f}: spells right {right * 100:5.1f}%  wrong {wrong * 100:4.1f}%  not-a-spell rejected {none_ok * 100:5.1f}%')
conf = np.zeros((5, 5), int)
for t, p in zip(Y, pred): conf[t, p] += 1
report['base'] = {'sweep': sweep, 'confusion': conf.tolist(), 'classes': BASE}

# ── 2. teach-your-own, leave one gesture out ──
print('\n2. teach-your-own (leave one gesture out, taught from 5 takes, 25 random picks each)')
held = [l for l in BASE if l != 'none'] + list(dict.fromkeys(t['label'] for t in cust))
DF = [dtw_feat(s) for s in S]
rows = []
for h in held:
    hb = BASE.index(h) if h in BASE else -1
    keep = Y != hb; cls = [c for c in range(len(BASE)) if c != hb]; remap = {c: i for i, c in enumerate(cls)}
    net = train([S[i] for i in np.where(keep)[0]], np.array([remap[c] for c in Y[keep]]), seed=7)
    P = prototypes(embed(net, [S[i] for i in np.where(keep)[0]]), np.array([remap[c] for c in Y[keep]]), len(cls)); ni = cls.index(NONE)
    hs = [segment(t['x']) for t in (cust if hb < 0 else base) if t['label'] == h]; He = embed(net, hs); Hd = [dtw_feat(s) for s in hs]
    others = np.where(keep)[0]; Oe = embed(net, [S[i] for i in others])
    for r in range(25):
        rg = np.random.default_rng(r); p = rg.permutation(len(hs)); en, ts = p[:5], p[5:]
        bt = [i for c in range(4) if c != hb for i in rg.permutation(np.where(Y == c)[0])[:5]]   # 5 stored recordings per base spell
        proto = He[en].mean(0); proto /= np.linalg.norm(proto)
        wmax = max(dist(Hd[a], Hd[b]) for a in en for b in en if a < b)
        def f(e, d, skip=None):
            sb = e @ P.T
            return dict(sbmax=float(sb.max()), snone=float(sb[ni]), sc=float(e @ proto), dc=min(dist(d, Hd[k]) for k in en),
                        db=min(dist(d, DF[i]) for i in bt if i != skip), wmax=wmax)
        rows += [dict(h=h, kind='hit', **f(He[i], Hd[i])) for i in ts]
        rows += [dict(h=h, kind='none' if Y[oi] == NONE else 'spell', **f(Oe[list(others).index(oi)], DF[oi], skip=oi)) for oi in others[::2]]
    print(f'  {h} done', flush=True)
RULES = {
    'cnn':    lambda r: r['sc'] > r['sbmax'],
    'dtw':    lambda r: r['dc'] < r['db'],
    'hybrid': lambda r: r['dc'] < r['db'] and r['dc'] <= 2.0 * r['wmax'] and r['sc'] >= 0.3 and not r['snone'] > r['sc'],
}
res = {}
for h in held:
    R = [r for r in rows if r['h'] == h]
    res[h] = {k: {q: float(np.mean([rule(r) for r in R if r['kind'] == kind])) for q, kind in (('taught', 'hit'), ('stole_spells', 'spell'), ('stole_none', 'none'))} for k, rule in RULES.items()}
avg = {k: {q: float(np.mean([res[h][k][q] for h in held])) for q in ('taught', 'stole_spells', 'stole_none')} for k in RULES}
for h in held + ['average']:
    d = res[h] if h != 'average' else avg
    print(f'  {h:16s} ' + '   '.join(f"{k}: {d[k]['taught'] * 100:5.1f}% taught, stole {d[k]['stole_spells'] * 100:4.1f}% spells / {d[k]['stole_none'] * 100:4.1f}% none" for k in RULES))
report['teach'] = {'per_gesture': res, 'average': avg, 'rule': 'hybrid'}
if len(sys.argv) > 2: json.dump(report, open(sys.argv[2], 'w'), indent=1)
