"""First 1D CNN for spells: a fingerprint (embedding) network trained with cosine-softmax over the base
classes, evaluated with 5-fold cross-validation on real takes.  python3 train_cnn.py data.json

Input: the active part of a take (+-0.2 s), accel minus starting gravity and gyro minus its offset (/200),
resampled to 128 steps, plus the log of its duration as a 7th channel (so a flick stays short).
Augmentation: small random 3D rotations, amplitude scaling, smooth time warps, noise, jittered trims.
"""
import sys
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as Fn
from spells_data import load, gyro_bias

torch.set_num_threads(4)
BASE = ['circle', 'zigzag', 'flick', 'heart', 'none']
T = 128


def segment(x, rng=None):
    b, g0 = gyro_bias(x), x[:25, :3].mean(0)
    g = np.linalg.norm(x[:, 3:] - b, axis=1)
    idx = np.where(g > 25)[0]
    lo, hi = (idx[0], idx[-1] + 1) if len(idx) else (0, len(x))
    pad = 20
    if rng is not None: lo += rng.integers(-8, 9); hi += rng.integers(-8, 9)
    lo, hi = max(0, lo - pad), min(len(x), hi + pad)
    s = np.concatenate([x[lo:hi, :3] - g0, (x[lo:hi, 3:] - b) / 200.0], 1)
    return s


def rot(rng, deg):
    a = rng.normal(size=3); a /= np.linalg.norm(a); th = np.radians(rng.uniform(-deg, deg))
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + np.sin(th) * K + (1 - np.cos(th)) * K @ K


def to_input(s, rng=None):
    n = len(s)
    if rng is not None:
        R = rot(rng, 15); s = np.concatenate([s[:, :3] @ R.T, s[:, 3:] @ R.T], 1)
        s = s * rng.uniform(0.8, 1.2)
        # smooth time warp: random monotone mapping
        k = rng.normal(0, 0.15, 4).cumsum(); w = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, 4), k)
        tt = np.linspace(0, 1, n) + 0.08 * (w - w.mean()); tt = np.clip(np.sort(tt), 0, 1)
        s = np.stack([np.interp(tt, np.linspace(0, 1, n), s[:, c]) for c in range(6)], 1)
        s = s + rng.normal(0, 0.02, s.shape)
    out = np.stack([np.interp(np.linspace(0, n - 1, T), np.arange(n), s[:, c]) for c in range(6)], 0)
    dur = np.full((1, T), np.log(n / 100.0))
    return np.concatenate([out, dur], 0).astype(np.float32)


class Net(nn.Module):
    def __init__(self, n_cls, emb=32):
        super().__init__()
        def blk(i, o, k, s): return nn.Sequential(nn.Conv1d(i, o, k, s, k // 2), nn.BatchNorm1d(o), nn.ReLU())
        self.f = nn.Sequential(blk(7, 32, 5, 1), blk(32, 64, 5, 2), blk(64, 64, 3, 2), blk(64, 64, 3, 1))
        self.e = nn.Linear(64, emb)
        self.w = nn.Parameter(torch.randn(n_cls, emb) * 0.1)
    def embed(self, x): return Fn.normalize(self.e(self.f(x).mean(-1)), dim=1)
    def forward(self, x): return 16.0 * self.embed(x) @ Fn.normalize(self.w, dim=1).T


def train(segs, ys, epochs=120, seed=0):
    rng = np.random.default_rng(seed); torch.manual_seed(seed)
    net = Net(len(BASE)); opt = torch.optim.AdamW(net.parameters(), 3e-3, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=epochs * 4)
    y = torch.tensor(ys)
    for ep in range(epochs):
        net.train(); perm = rng.permutation(len(segs))
        for chunk in np.array_split(perm, 4):
            xb = torch.tensor(np.stack([to_input(segs[i], rng) for i in chunk]))
            loss = Fn.cross_entropy(net(xb), y[chunk], label_smoothing=0.05)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    net.eval(); return net


def emb(net, segs):
    with torch.no_grad(): return net.embed(torch.tensor(np.stack([to_input(s) for s in segs]))).numpy()


takes = load(sys.argv[1])
base = [t for t in takes if t['label'] in BASE]
cust = [t for t in takes if t['group'] == 'custom']
S = [segment(t['x']) for t in base]; Y = np.array([BASE.index(t['label']) for t in base])
rng = np.random.default_rng(1)
folds = np.zeros(len(base), int)
for c in range(len(BASE)):
    idx = rng.permutation(np.where(Y == c)[0]); folds[idx] = np.arange(len(idx)) % 5

pred = np.zeros(len(base), int); E_all = []
cust_hits, cust_steal, cust_n = [], 0, 0
for f in range(5):
    tr, te = folds != f, folds == f
    net = train([S[i] for i in np.where(tr)[0]], Y[tr], seed=f)
    E_tr, E_te = emb(net, [S[i] for i in np.where(tr)[0]]), emb(net, [S[i] for i in np.where(te)[0]])
    protos = np.stack([Fn.normalize(torch.tensor(E_tr[Y[tr] == c].mean(0)), dim=0).numpy() for c in range(len(BASE))])
    pred[te] = np.argmax(E_te @ protos.T, 1)
    # teach-your-own on this fold's network: enrol each custom gesture from 5 takes, test the rest
    for c in dict.fromkeys(t['label'] for t in cust):
        ce = emb(net, [segment(t['x']) for t in cust if t['label'] == c])
        for r in range(50):
            p = np.random.default_rng(r).permutation(len(ce)); en, ts = ce[p[:5]], ce[p[5:]]
            P = np.vstack([protos, en.mean(0) / np.linalg.norm(en.mean(0))])
            cust_hits += list(np.argmax(ts @ P.T, 1) == len(BASE))
            st = np.argmax(E_te @ P.T, 1); cust_steal += int((st == len(BASE)).sum()); cust_n += len(st)
    print(f'fold {f + 1}/5 done', flush=True)

conf = np.zeros((5, 5), int)
for t, p in zip(Y, pred): conf[t, p] += 1
print(f'\nCNN, 5-fold CV, nearest class prototype: {np.mean(pred == Y) * 100:.1f}% overall')
print('            ' + ' '.join(f'{c[:6]:>7s}' for c in BASE))
for ci, c in enumerate(BASE): print(f'  {c:9s} ' + ' '.join(f'{v:7.1f}' for v in conf[ci] / conf[ci].sum() * 100))
if cust:
    print(f'\nteach-your-own (custom gestures never trained on, enrolled from 5 takes): recognised {np.mean(cust_hits) * 100:.1f}%, '
          f'base takes wrongly taken as it {cust_steal / cust_n * 100:.1f}%')
print(f'\nparameters: {sum(p.numel() for p in Net(5).parameters()):,}')
