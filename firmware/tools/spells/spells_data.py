"""Loading and preparing larp-spells/1 recordings (from the website's spells tab).

Sensor frame (from the calibrate takes): +X = towards the top of the screen, +Y = towards the right edge,
+Z = into the screen (away from you). Accel in g, gyro in degrees per second.
"""
import csv, json, os
import numpy as np

HZ = 100


def load(path):
    """a spells-tab export (larp-spells/1 JSON), or the dataset folder in the repo (dataset/, see its README)"""
    if os.path.isdir(path):
        return load_dataset(path)
    j = json.load(open(path))
    assert j['format'] == 'larp-spells/1', 'not a larp-spells file'
    takes = []
    for t in j['takes']:
        d = np.array(t['data'], dtype=np.float32).reshape(-1, 6)
        d[:, :3] /= t['aLsb']
        d[:, 3:] /= t['gLsb']
        takes.append({**{k: v for k, v in t.items() if k != 'data'}, 'x': d})
    return takes


def gyro_bias(x, n=25):
    """the gyro's resting offset, from the still start of a take (it drifts a few dps between takes)"""
    return x[:min(n, len(x)), 3:].mean(0)


def stroke(x):
    """where the back of the charm pointed while you drew: degrees right and up (screen coordinates: y down)"""
    g = x[:, 3:] - gyro_bias(x)
    ang = np.cumsum(g, 0) / HZ
    return np.stack([-ang[:, 0], -ang[:, 1]], 1)          # rotation about +X turns the pointer left, about +Y up


def active(x, thresh=25.0, pad=8):
    """trim the still ends: keep from just before the gyro first passes `thresh` dps to just after it last does"""
    g = np.linalg.norm(x[:, 3:] - gyro_bias(x), axis=1)
    idx = np.where(g > thresh)[0]
    if len(idx) == 0:
        return x
    return x[max(0, idx[0] - pad): min(len(x), idx[-1] + pad + 1)]


def load_dataset(root):
    """the dataset folder: index.csv plus one CSV per take (t_s, ax_g, ay_g, az_g, gx_dps, gy_dps, gz_dps)"""
    takes = []
    for r in csv.DictReader(open(os.path.join(root, 'index.csv'))):
        x = np.loadtxt(os.path.join(root, r['file']), delimiter=',', skiprows=1, dtype=np.float64)[:, 1:]
        al, gl = int(r['accel_lsb_per_g']), int(r['gyro_lsb_per_dps'])     # back onto the sensor's exact steps (the CSV rounds)
        x = np.concatenate([np.round(x[:, :3] * al) / al, np.round(x[:, 3:] * gl) / gl], 1).astype(np.float32)
        takes.append({**r, 'hz': int(r['hz']), 'n': int(r['samples']), 'missed': int(r['missed']),
                      'aLsb': int(r['accel_lsb_per_g']), 'gLsb': int(r['gyro_lsb_per_dps']), 'at': r['recorded_at'], 'x': x})
    return takes
