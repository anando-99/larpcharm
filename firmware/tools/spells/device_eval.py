"""Hardware-in-the-loop: every recorded take, replayed through the network running ON the charm.
python3 device_eval.py ../../../dataset [model/device_eval.json]

Each take goes over USB (serial command `take`); the charm runs its own engine (spells_engine.h: the input
pipeline, the 38,848-parameter CNN, the prototypes, the 0.85 threshold) exactly as when you cast, and reports its
decision, its fingerprint and its timing. They are compared with PyTorch's for the same take. Casting from serial
plays the effect but skips the spell's action. Needs the charm on USB with firmware 9.5 or later."""
import base64, json, re, sys, time
import numpy as np, torch
from spells_data import load
from spells_model import BASE, Net, segment, embed
from charm_serial import Charm

THR = 0.85
takes = [t for t in load(sys.argv[1]) if t['group'] != 'calibrate']
net = Net(); net.load_state_dict(torch.load('model/spells_cnn.pt')); net.eval()
base = [t for t in takes if t['label'] in BASE]
Eb = embed(net, [segment(t['x']) for t in base]); Yb = np.array([BASE.index(t['label']) for t in base])
P = np.stack([Eb[Yb == c].mean(0) for c in range(len(BASE))]); P /= np.linalg.norm(P, axis=1, keepdims=True)

def py_decide(e):
    s = P @ e; c = int(s.argmax())
    return (BASE[c] if c != BASE.index('none') and s[c] >= THR else '-'), float(s[c])

c = Charm(); c.cmd('mode 17'); c.cmd('view 0')
rows = []
for i, t in enumerate(takes):
    raw = np.round(np.concatenate([t['x'][:, :3] * t['aLsb'], t['x'][:, 3:] * t['gLsb']], 1)).astype('<i2')
    c.send('take ' + base64.b64encode(raw.tobytes()).decode())
    timing = c.until('cast: network', 20)
    cast = c.until('CAST').split(); emb = np.array([float(v) for v in c.until('EMB').split()[1:]], np.float32)
    ms = re.search(r'network (\d+) ms.*in (\d+) ms', timing)
    e_py = embed(net, [segment(t['x'])])[0]
    lab_py, sim_py = py_decide(e_py)
    rows.append({'label': t['label'], 'group': t['group'], 'charm': cast[1], 'charm_sim': float(cast[2]), 'pytorch': lab_py, 'pytorch_sim': sim_py,
                 'fingerprint_max_diff': float(np.abs(emb - e_py).max()), 'network_ms': int(ms.group(1)), 'total_ms': int(ms.group(2)), 'samples': t['n']})
    print(f"\r{i + 1}/{len(takes)}", end='', flush=True)
c.cmd('demo clear'); c.cmd('mode 8'); c.close(); print()

agree = np.mean([r['charm'] == r['pytorch'] for r in rows])
md = max(r['fingerprint_max_diff'] for r in rows)
ms = np.array([r['network_ms'] for r in rows]); tot = np.array([r['total_ms'] for r in rows])
spell = [r for r in rows if r['group'] == 'spell']; none = [r for r in rows if r['group'] == 'none']
summary = {'takes': len(rows), 'charm_agrees_with_pytorch': float(agree), 'fingerprint_max_diff': md,
           'network_ms': {'median': float(np.median(ms)), 'min': int(ms.min()), 'max': int(ms.max())},
           'total_ms': {'median': float(np.median(tot)), 'max': int(tot.max())},
           'note': 'all takes, including those the network was trained on: this checks the charm runs the same model as PyTorch, not accuracy (see eval.json for that)',
           'spells_cast_as_their_label': float(np.mean([r['charm'] == r['label'] for r in spell])),
           'none_rejected': float(np.mean([r['charm'] == '-' for r in none]))}
print(f"{len(rows)} takes replayed on the charm. Same decision as PyTorch: {agree * 100:.1f}%. Fingerprints differ by at most {md:.1e}.")
print(f"Network on the charm: median {np.median(ms):.0f} ms (min {ms.min()}, max {ms.max()}); whole cast median {np.median(tot):.0f} ms.")
if len(sys.argv) > 2: json.dump({'summary': summary, 'takes': rows}, open(sys.argv[2], 'w'), indent=1); print('wrote', sys.argv[2])
