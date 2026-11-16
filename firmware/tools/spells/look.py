"""Contact sheet of every take's stroke (from the gyro), one row per label.  python3 look.py data.json out.png"""
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from spells_data import load, stroke, active

takes = [t for t in load(sys.argv[1]) if t['group'] != 'calibrate']
labels = list(dict.fromkeys(t['label'] for t in takes))
cols = max(sum(t['label'] == l for t in takes) for l in labels)
cols = min(cols, 20)
fig, axs = plt.subplots(len(labels), cols, figsize=(cols * 1.1, len(labels) * 1.25), facecolor='black')
for r, l in enumerate(labels):
    ts = [t for t in takes if t['label'] == l][:cols]
    for c in range(cols):
        ax = axs[r][c]; ax.set_facecolor('black'); ax.set_xticks([]); ax.set_yticks([])
        for s in ax.spines.values(): s.set_color('#222')
        if c >= len(ts): continue
        p = stroke(active(ts[c]['x']))
        ax.plot(p[:, 0], p[:, 1], color='#00e5ff', lw=1)
        ax.plot(p[0, 0], p[0, 1], 'o', color='#ffb040', ms=3)
        ax.invert_yaxis(); ax.set_aspect('equal', 'datalim')
        if c == 0: ax.set_ylabel(l, color='white', fontsize=8)
plt.tight_layout(pad=0.2)
plt.savefig(sys.argv[2], dpi=90, facecolor='black')
