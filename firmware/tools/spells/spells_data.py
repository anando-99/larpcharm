"""Loading and preparing larp-spells/1 recordings (from the website's spells tab).

Sensor frame (from the calibrate takes): +X = towards the top of the screen, +Y = towards the right edge,
+Z = into the screen (away from you). Accel in g, gyro in degrees per second.
"""
import json
import numpy as np

HZ = 100


def load(path):
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
