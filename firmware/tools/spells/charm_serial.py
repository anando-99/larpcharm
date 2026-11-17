"""Talk to the charm over USB serial (the commands in firmware/LarpCharm/20_setup_loop.ino, "USB serial").
Standard library only. Used by firmware/tools/screens.py and device_eval.py."""
import base64, glob, os, select, termios, time


def find_port():
    ports = sorted(glob.glob('/dev/cu.usbmodem*') + glob.glob('/dev/ttyACM*'))
    if not ports: raise SystemExit('No charm on USB (looked for /dev/cu.usbmodem* and /dev/ttyACM*).')
    return ports[0]


class Charm:
    def __init__(self, port=None):
        self.port = port; self.fd = None; self.buf = b''; self.open()

    def open(self, wait=0):
        deadline = time.time() + wait
        while True:
            try:
                self.fd = os.open(self.port or find_port(), os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK); break
            except (OSError, SystemExit):
                if time.time() > deadline: raise
                time.sleep(0.5)
        a = termios.tcgetattr(self.fd)
        a[0] = 0; a[1] = 0; a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL; a[3] = 0     # raw, and no reset on close
        a[4] = a[5] = termios.B115200
        termios.tcsetattr(self.fd, termios.TCSANOW, a)
        self.buf = b''

    def close(self):
        if self.fd is not None: os.close(self.fd); self.fd = None

    def send(self, line):
        data = (line + '\n').encode()
        while data:
            try: n = os.write(self.fd, data); data = data[n:]
            except BlockingIOError: select.select([], [self.fd], [], 1)

    def readline(self, timeout=10):
        end = time.time() + timeout
        while b'\n' not in self.buf:
            left = end - time.time()
            if left <= 0: raise TimeoutError('no answer from the charm')
            if select.select([self.fd], [], [], left)[0]:
                try: self.buf += os.read(self.fd, 65536)
                except BlockingIOError: pass
        line, self.buf = self.buf.split(b'\n', 1)
        return line.decode(errors='replace').strip()

    def until(self, prefix, timeout=10):
        end = time.time() + timeout
        while True:
            line = self.readline(max(0.1, end - time.time()))
            if line.startswith(prefix): return line

    def cmd(self, line, expect='OK', timeout=10):
        self.send(line); return self.until(expect, timeout)

    def shot(self):
        """the screen, as a (280, 240, 3) uint8 array"""
        import numpy as np
        self.send('shot')
        w, h, b64 = self.until('SHOT', 20).split(' ', 3)[1:]
        v = np.frombuffer(base64.b64decode(b64), '<u2').reshape(int(h), int(w)).astype(np.uint32)
        r, g, b = (v >> 11) & 31, (v >> 5) & 63, v & 31
        return np.stack([r * 255 // 31, g * 255 // 63, b * 255 // 31], -1).astype(np.uint8)

    def reboot(self):
        self.send('reboot'); time.sleep(0.3); self.close(); time.sleep(3); self.open(wait=20); time.sleep(4)
