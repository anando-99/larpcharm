"""The figures for docs/spells.md.  python3 figures.py data.json   (after evaluate.py and train.py)"""
import json, os, sys
import numpy as np, torch
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from spells_data import load, stroke, active
from spells_model import BASE, Net, segment, embed

HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '..', '..', '..', 'docs', 'spells'); os.makedirs(OUT, exist_ok=True)
ACC, DIM, FG, BG, PANEL = '#00e5ff', '#6b7785', '#c9d4df', '#07090c', '#0b0f14'
COLS = ['#ff6060', '#60e080', '#60a0ff', '#ffb040', '#c878ff', '#50e6e6']
plt.rcParams.update({'figure.facecolor': BG, 'axes.facecolor': PANEL, 'axes.edgecolor': '#2a3542', 'axes.labelcolor': FG, 'text.color': FG,
                     'xtick.color': DIM, 'ytick.color': DIM, 'font.family': 'monospace', 'font.size': 9, 'axes.titlecolor': FG, 'axes.titlesize': 10})
takes = load(sys.argv[1]); ev = json.load(open(os.path.join(HERE, 'model', 'eval.json')))
G = [t for t in takes if t['group'] != 'calibrate']
save = lambda name: (plt.savefig(os.path.join(OUT, name), dpi=130, bbox_inches='tight', facecolor=BG), plt.close(), print('wrote', name))

# 1. one take of each, all six channels
labels = ['circle', 'zigzag', 'flick', 'heart', 'none']
fig, axs = plt.subplots(2, 5, figsize=(13, 4.2), sharex='col')
for j, l in enumerate(labels):
    t = [q for q in G if q['label'] == l][2]; x = t['x']; tt = np.arange(len(x)) / 100
    for c in range(3): axs[0][j].plot(tt, x[:, c], color=COLS[c], lw=1); axs[1][j].plot(tt, x[:, 3 + c], color=COLS[3 + c], lw=1)
    axs[0][j].set_title(l); axs[1][j].set_xlabel('s')
axs[0][0].set_ylabel('accel (g)'); axs[1][0].set_ylabel('gyro (°/s)')
from matplotlib.lines import Line2D
fig.legend([Line2D([], [], color=c) for c in COLS], ['ax', 'ay', 'az', 'gx', 'gy', 'gz'], loc='upper center', bbox_to_anchor=(0.5, 1.06), frameon=False, ncol=6); save('signals.png')

# 2. every take's stroke from the gyro
rows = list(dict.fromkeys(t['label'] for t in G)); cols = 12
fig, axs = plt.subplots(len(rows), cols, figsize=(cols * 0.95, len(rows) * 1.05))
for r, l in enumerate(rows):
    ts = [t for t in G if t['label'] == l][:cols]
    for c in range(cols):
        ax = axs[r][c]; ax.set_xticks([]); ax.set_yticks([])
        if c >= len(ts): ax.axis('off'); continue
        p = stroke(active(ts[c]['x'])); ax.plot(p[:, 0], p[:, 1], color=ACC, lw=1); ax.plot(p[0, 0], p[0, 1], 'o', color='#ffb040', ms=2.5)
        ax.invert_yaxis(); ax.set_aspect('equal', 'datalim')
        if c == 0: ax.set_ylabel(l, fontsize=8)
save('strokes.png')

# 3. cross-validated confusion matrix
conf = np.array(ev['base']['confusion']); cm = conf / conf.sum(1, keepdims=True)
fig, ax = plt.subplots(figsize=(4.6, 3.9)); ax.imshow(cm, cmap='Blues', vmin=0, vmax=1)
ax.set_xticks(range(5), BASE, rotation=30); ax.set_yticks(range(5), BASE); ax.set_xlabel('predicted (nearest prototype)'); ax.set_ylabel('true')
for i in range(5):
    for j in range(5): ax.text(j, i, f'{cm[i, j] * 100:.0f}', ha='center', va='center', color='white' if cm[i, j] > .5 else FG, fontsize=8)
ax.set_title('5-fold cross-validation'); save('confusion.png')

# 4. the rejection threshold
sw = ev['base']['sweep']; th = [s['threshold'] for s in sw]
fig, ax = plt.subplots(figsize=(5.6, 3.2))
ax.plot(th, [s['spells_right'] * 100 for s in sw], 'o-', color=ACC, label='spells cast correctly')
ax.plot(th, [s['none_rejected'] * 100 for s in sw], 's-', color='#ffb040', label='"not a spell" rejected')
ax.plot(th, [s['spells_wrong'] * 100 for s in sw], '^-', color='#ff6060', label='spells cast as another')
ax.axvline(0.85, color=DIM, ls='--', lw=1); ax.text(0.852, 50, 'chosen: 0.85', color=DIM)
ax.set_xlabel('similarity threshold'); ax.set_ylabel('%'); ax.legend(frameon=False, fontsize=8); ax.set_ylim(-3, 103); save('threshold.png')

# 5. teach-your-own: three ways
avg = ev['teach']['average']; ks = ['cnn', 'dtw', 'hybrid']
fig, ax = plt.subplots(figsize=(6, 3.2)); w = 0.26; xs = np.arange(3)
for i, (q, lab, col) in enumerate([('taught', 'taught spell recognised', ACC), ('stole_spells', 'other spells taken for it', '#ff6060'), ('stole_none', '"not a spell" taken for it', '#ffb040')]):
    v = [avg[k][q] * 100 for k in ks]; b = ax.bar(xs + (i - 1) * w, v, w, color=col, label=lab)
    for xx, vv in zip(xs + (i - 1) * w, v): ax.text(xx, vv + 1.5, f'{vv:.0f}', ha='center', fontsize=7)
ax.set_xticks(xs, ['CNN prototype', 'DTW nearest', 'hybrid (on the charm)']); ax.set_ylabel('%'); ax.set_ylim(0, 105); ax.legend(frameon=False, fontsize=7.5, loc='upper center', bbox_to_anchor=(0.5, -0.12), ncol=3)
ax.set_title('teach-your-own, leave one gesture out, 5 recordings'); save('teach.png')

# 6. the fingerprints, in 2D (PCA), with a gesture the network has never seen
net = Net(); net.load_state_dict(torch.load(os.path.join(HERE, 'model', 'spells_cnn.pt'))); net.eval()
allt = [t for t in G]; E = embed(net, [segment(t['x']) for t in allt]); L = [t['label'] for t in allt]
Ec = E - E.mean(0); U, S, Vt = np.linalg.svd(Ec, full_matrices=False); Z = Ec @ Vt[:2].T
fig, ax = plt.subplots(figsize=(5.4, 4.4)); pal = dict(zip(rows, ['#00e5ff', '#ff6060', '#ffb040', '#f472b6', '#6b7785', '#39ff14', '#c878ff']))
for l in rows:
    m = np.array([q == l for q in L]); ax.scatter(Z[m, 0], Z[m, 1], s=18 if l != 'none' else 10, color=pal[l], label=l + (' (never trained on)' if l not in BASE else ''), alpha=.85, edgecolors='none')
ax.set_xticks([]); ax.set_yticks([]); ax.legend(frameon=False, fontsize=7.5, loc='center left', bbox_to_anchor=(1.01, 0.5)); ax.set_title('fingerprints (32-d), first two principal components'); save('embedding.png')
