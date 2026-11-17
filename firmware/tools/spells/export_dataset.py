"""Turn a spells-tab export (larp-spells/1 JSON) into the dataset folder in the repo, one folder per shape.
python3 export_dataset.py larp-spells-YYYY-MM-DD.json ../../../dataset

  dataset/
    index.csv                    one row per take: file, label, group, session, posture, grip, trigger, hz, samples, ...
    spells/<shape>/<shape>_NNN.csv   circle, zigzag, flick, heart
    not-a-spell/none/none_NNN.csv
    custom/<name>/<name>_NNN.csv     gestures kept out of training, to test teach-your-own
    calibrate/<pose>.csv             the charm still on each face, or turned slowly about each axis

Each take is a CSV of t_s, ax_g, ay_g, az_g, gx_dps, gy_dps, gz_dps at 100 Hz, in the sensor's own axes
(+X screen top, +Y right edge, +Z into the screen). Takes are numbered in the order they were recorded.
Calibration keeps one take per pose: the stillest one for the still poses (an accidental 0.3 s take and a take
where the charm was still being moved were left out).
"""
import csv, json, os, shutil, sys
import numpy as np

src, out = sys.argv[1], sys.argv[2]
j = json.load(open(src)); assert j['format'] == 'larp-spells/1'
GROUP_DIR = {'spell': 'spells', 'none': 'not-a-spell', 'custom': 'custom', 'calibrate': 'calibrate'}
takes = sorted(j['takes'], key=lambda t: t['at'])

def arr(t):
    d = np.array(t['data'], dtype=np.float64).reshape(-1, 6)
    d[:, :3] /= t['aLsb']; d[:, 3:] /= t['gLsb']; return d

# calibration: one take per pose, timed ones only, the stillest where there are several
calib = {}
for t in takes:
    if t['group'] != 'calibrate' or t['trigger'] != 'timed': continue
    still = arr(t)[:, 3:].std(0).max()
    if t['label'] not in calib or (not t['label'].startswith('turn') and still < calib[t['label']][1]): calib[t['label']] = (t, still)
keep = [t for t in takes if t['group'] != 'calibrate'] + [v[0] for v in calib.values()]
dropped = len(takes) - len(keep)

for d in GROUP_DIR.values():
    shutil.rmtree(os.path.join(out, d), ignore_errors=True)
os.makedirs(out, exist_ok=True)
rows, count = [], {}
for t in sorted(keep, key=lambda t: t['at']):
    g = GROUP_DIR[t['group']]
    if t['group'] == 'calibrate': rel = os.path.join(g, f"{t['label']}.csv")
    else:
        count[t['label']] = count.get(t['label'], 0) + 1
        rel = os.path.join(g, t['label'], f"{t['label']}_{count[t['label']]:03d}.csv")
    os.makedirs(os.path.dirname(os.path.join(out, rel)), exist_ok=True)
    d = arr(t)
    with open(os.path.join(out, rel), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['t_s', 'ax_g', 'ay_g', 'az_g', 'gx_dps', 'gy_dps', 'gz_dps'])
        for i, r in enumerate(d): w.writerow([f'{i / t["hz"]:.2f}'] + [f'{v:.5f}' if k < 3 else f'{v:.4f}' for k, v in enumerate(r)])
    rows.append({'file': rel.replace(os.sep, '/'), 'label': t['label'], 'group': t['group'], 'session': t['session'], 'posture': t['posture'], 'grip': t['grip'],
                 'trigger': t['trigger'], 'hz': t['hz'], 'samples': t['n'], 'seconds': f"{t['n'] / t['hz']:.2f}", 'missed': t['missed'],
                 'accel_lsb_per_g': t['aLsb'], 'gyro_lsb_per_dps': t['gLsb'], 'recorded_at': t['at'], 'firmware': t.get('fw', '')})
with open(os.path.join(out, 'index.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(f'{len(rows)} takes written to {out} ({dropped} left out), ' + ', '.join(f'{k} {v}' for k, v in count.items()) + f', calibrate {len(calib)}')
