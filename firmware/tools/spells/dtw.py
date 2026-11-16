"""DTW (dtw.c, compiled on first use) for the spell tools."""
import ctypes, os, subprocess, tempfile
import numpy as np

_here = os.path.dirname(os.path.abspath(__file__))
_lib_path = os.path.join(tempfile.gettempdir(), 'larp_dtw.so')
if not os.path.exists(_lib_path) or os.path.getmtime(_lib_path) < os.path.getmtime(os.path.join(_here, 'dtw.c')):
    subprocess.check_call(['cc', '-O3', '-shared', '-fPIC', '-o', _lib_path, os.path.join(_here, 'dtw.c')])
lib = ctypes.CDLL(_lib_path)
lib.dtw.restype = ctypes.c_double
lib.dtw.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int]


def dtw_feat(seg):
    """a segment (from spells_model.segment) at 50 Hz, as the charm keeps its templates"""
    return np.ascontiguousarray(seg[::2], dtype=np.float32)


def dist(a, b):
    """DTW distance per step, with a band of a quarter of the longer series"""
    return lib.dtw(a.ctypes.data, len(a), b.ctypes.data, len(b), a.shape[1], max(8, int(0.25 * max(len(a), len(b)))))
