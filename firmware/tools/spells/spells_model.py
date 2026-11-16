"""The spell network and its input pipeline, shared by training, evaluation and export.

Everything here is mirrored line for line in the firmware (LarpCharm.ino, "spell engine") and the website
(spells-model.js), so a take gives the same fingerprint on all three. Keep them in step.

Pipeline for one take (raw accel in g, gyro in dps, 100 Hz, starting with the hand still):
  1. gyro offset b = mean gyro of the first 25 samples; starting gravity g0 = mean accel of the first 25
  2. active part: from 20 samples before the gyro first exceeds 25 dps to 20 after it last does
  3. channels: accel - g0 (g), (gyro - b) / 200
  4. resampled (linear) to 128 steps, plus a 7th channel: log(duration in seconds)
Network (38,848 parameters):
  conv 7->32 k5 s1, conv 32->64 k5 s2, conv 64->64 k3 s2, conv 64->64 k3 s1 (each + batch norm + ReLU)
  -> mean over time -> linear 64->32 -> L2 normalise = the fingerprint (embedding)
A gesture is the class whose prototype (mean fingerprint of its examples) is most similar (cosine).
"""
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as Fn
from spells_data import gyro_bias

BASE = ['circle', 'zigzag', 'flick', 'heart', 'none']
T = 128
ACT_DPS, PAD, LEAD = 25.0, 20, 25


def segment(x, rng=None):
    b, g0 = x[:LEAD, 3:].mean(0), x[:LEAD, :3].mean(0)
    g = np.linalg.norm(x[:, 3:] - b, axis=1)
    idx = np.where(g > ACT_DPS)[0]
    lo, hi = (idx[0], idx[-1] + 1) if len(idx) else (0, len(x))
    if rng is not None: lo += rng.integers(-8, 9); hi += rng.integers(-8, 9)
    lo, hi = max(0, lo - PAD), min(len(x), hi + PAD)
    if hi - lo < 4: lo, hi = 0, len(x)
    return np.concatenate([x[lo:hi, :3] - g0, (x[lo:hi, 3:] - b) / 200.0], 1).astype(np.float32)


def rot(rng, deg):
    a = rng.normal(size=3); a /= np.linalg.norm(a); th = np.radians(rng.uniform(-deg, deg))
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + np.sin(th) * K + (1 - np.cos(th)) * K @ K


def augment(s, rng):
    n = len(s)
    R = rot(rng, 15); s = np.concatenate([s[:, :3] @ R.T, s[:, 3:] @ R.T], 1)
    s = s * rng.uniform(0.8, 1.2)
    k = rng.normal(0, 0.15, 4).cumsum(); w = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, 4), k)
    tt = np.clip(np.sort(np.linspace(0, 1, n) + 0.08 * (w - w.mean())), 0, 1)
    s = np.stack([np.interp(tt, np.linspace(0, 1, n), s[:, c]) for c in range(6)], 1)
    return s + rng.normal(0, 0.02, s.shape)


def to_input(s, rng=None):
    if rng is not None: s = augment(s, rng)
    n = len(s)
    pos = np.arange(T) * (n - 1) / (T - 1)
    out = np.stack([np.interp(pos, np.arange(n), s[:, c]) for c in range(6)], 0)
    return np.concatenate([out, np.full((1, T), np.log(n / 100.0))], 0).astype(np.float32)


class Net(nn.Module):
    def __init__(self, n_cls=len(BASE), emb=32):
        super().__init__()
        def blk(i, o, k, s): return nn.Sequential(nn.Conv1d(i, o, k, s, k // 2), nn.BatchNorm1d(o), nn.ReLU())
        self.f = nn.Sequential(blk(7, 32, 5, 1), blk(32, 64, 5, 2), blk(64, 64, 3, 2), blk(64, 64, 3, 1))
        self.e = nn.Linear(64, emb)
        self.w = nn.Parameter(torch.randn(n_cls, emb) * 0.1)
    def embed(self, x): return Fn.normalize(self.e(self.f(x).mean(-1)), dim=1)
    def forward(self, x): return 16.0 * self.embed(x) @ Fn.normalize(self.w, dim=1).T


def train(segs, ys, epochs=120, seed=0, log=None):
    rng = np.random.default_rng(seed); torch.manual_seed(seed)
    net = Net(); opt = torch.optim.AdamW(net.parameters(), 3e-3, weight_decay=1e-3)
    steps = 4
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=epochs * steps)
    y = torch.tensor(ys)
    for ep in range(epochs):
        net.train(); perm = rng.permutation(len(segs)); tot = 0
        for chunk in np.array_split(perm, steps):
            xb = torch.tensor(np.stack([to_input(segs[i], rng) for i in chunk]))
            loss = Fn.cross_entropy(net(xb), y[chunk], label_smoothing=0.05)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tot += loss.item()
        if log is not None: log.append(tot / steps)
    net.eval(); return net


def embed(net, segs):
    with torch.no_grad(): return net.embed(torch.tensor(np.stack([to_input(s) for s in segs]))).numpy()


def prototypes(E, y, n):
    P = np.stack([E[y == c].mean(0) for c in range(n)])
    return P / np.linalg.norm(P, axis=1, keepdims=True)
