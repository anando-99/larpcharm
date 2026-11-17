"""Tests the charm's pairing and firmware updates on real hardware, over USB:   python3 firmware/tools/test_link.py [--ota]

The serial command `pkt` hands a packet to the same handler Bluetooth packets go to (17_ble.ino) and sends the
answers back over USB, so this exercises the real firmware: the lock, the challenge, the HMAC-SHA256 check (mbedtls on
the charm against Python's hmac here), pairing codes, replay, and (--ota) a full firmware update into the spare app slot,
with a bad hash first. The charm is rebooted between steps to start fresh links, and unpaired at the end."""
import base64, hashlib, hmac, os, struct, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'spells'))
from charm_serial import Charm

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CMD_MODE, CMD_PING, CMD_AUTH, XB, XD, XE = 0x01, 0x0C, 0x22, 0x05, 0x06, 0x07
c = Charm(); ok = 0; bad = 0

def pkt(*parts):
    b = bytes([x for p in parts for x in (p if isinstance(p, (bytes, bytearray, list)) else [p])])
    c.send('pkt ' + base64.b64encode(b).decode())
    notes = []
    while True:
        line = c.readline(20)
        if line.startswith('NOTE '): notes.append(line[5:])
        elif line.startswith('CODE '): notes.append(line)
        elif line == 'OK pkt': return notes
def check(name, cond, detail=''):
    global ok, bad
    print(('  ok   ' if cond else '  FAIL ') + name + (f'   [{detail}]' if detail and not cond else '')); ok += cond; bad += not cond
def chal(notes): return bytes.fromhex(next(n for n in notes if n.startswith('auth=chal,'))[10:].split(',')[0])

print('pairing, on a fresh link')
c.reboot(); c.cmd('unpair')
n = pkt(CMD_MODE, 8); check('a locked link refuses commands', n == ['auth=need'], n)
n = pkt(CMD_PING); check('PING on a locked link gives only a challenge', len(n) == 1 and n[0].startswith('auth=chal,') and n[0].endswith(',0'), n)
n = pkt(CMD_AUTH, 1, os.urandom(32)); check('a made-up answer fails (and a new challenge follows)', n[0] == 'auth=fail' and n[1].startswith('auth=chal,'), n)
n = pkt(CMD_AUTH, 0); code = next((x[5:] for x in n if x.startswith('CODE ')), None)
check('asking to pair shows a code', 'auth=code' in n and code and len(code) == 6, n)
wrong = '%06d' % ((int(code) + 1) % 1000000)
n = pkt(CMD_AUTH, 2, wrong.encode()); check('a wrong code is refused, 2 tries left', n == ['auth=bad,2'], n)
n = pkt(CMD_AUTH, 2, code.encode()); key = next((x[9:] for x in n if x.startswith('auth=key,')), None)
check('the right code pairs and hands over a 128-bit key', key and len(key) == 32, n)
n = pkt(CMD_PING); check('the paired link gets the status', any(x.startswith('b=') for x in n), n[:1])

print('unlocking, on a new link')
c.reboot()
n1 = pkt(CMD_PING); nonce = chal(n1)
mac = hmac.new(bytes.fromhex(key), nonce, hashlib.sha256).digest()
n = pkt(CMD_AUTH, 1, mac); check('HMAC-SHA256(key, challenge) from Python unlocks it (mbedtls agrees)', n == ['auth=ok'], n)
n = pkt(CMD_MODE, 8); check('commands work once unlocked', n == [], n)
c.reboot()
pkt(CMD_PING)
n = pkt(CMD_AUTH, 1, mac); check('replaying that answer on a new link fails', n[0] == 'auth=fail', n)
n = pkt(CMD_AUTH, 0); code = next((x[5:] for x in n if x.startswith('CODE ')), '000000')
for k in range(3): n = pkt(CMD_AUTH, 2, ('%06d' % ((int(code) + 7 + k) % 1000000)).encode())
check('three wrong codes lock pairing', n == ['auth=locked,30'], n)
n = pkt(CMD_AUTH, 0); check('and asking again is refused for 30 s', n and n[0].startswith('auth=locked,'), n)

if '--ota' in sys.argv:
    img = open(os.path.join(ROOT, 'flash', 'larpcharm-ota.bin'), 'rb').read()
    def unlock():
        nonce = chal(pkt(CMD_PING)); return pkt(CMD_AUTH, 1, hmac.new(bytes.fromhex(key), nonce, hashlib.sha256).digest())
    def send(sha):
        t = time.time(); notes = pkt(XB, 6, struct.pack('<II', len(img), 0), sha)
        if notes: return notes, 0
        for off in range(0, len(img), 495): pkt(XD, img[off:off + 495])
        return pkt(XE), time.time() - t
    print(f'update over the air ({len(img):,} bytes)')
    c.reboot()
    n = pkt(XB, 6, struct.pack('<II', len(img), 0), hashlib.sha256(img).digest()); check('a locked link can\'t start an update', n == ['auth=need'], n)
    check('unlock', unlock() == ['auth=ok'])
    n, dt = send(hashlib.sha256(b'not this').digest()); check('an image with the wrong SHA-256 is refused after the transfer', any('why=hash' in x for x in n), n)
    t = time.time(); pkt(XB, 6, struct.pack('<II', len(img), 0), hashlib.sha256(img).digest())
    for off in range(0, len(img), 495): pkt(XD, img[off:off + 495])
    c.send('pkt ' + base64.b64encode(bytes([XE])).decode())       # the charm answers, then restarts into the new slot
    notes = []
    try:
        while not any('xfer=ok' in x for x in notes): line = c.readline(30); notes += [line[5:]] if line.startswith('NOTE ') else []
    except (TimeoutError, OSError): pass
    check(f'the real image is accepted ({time.time() - t:.0f} s over USB)', any('xfer=ok' in x for x in notes), notes)
    c.close(); time.sleep(6); c.open(wait=30); time.sleep(4)
    check('the charm restarts into the new slot and unlocks again', unlock() == ['auth=ok'])
    st = next((x for x in pkt(CMD_PING) if x.startswith('b=')), '')
    check('and reports its version', 'fw=' in st, st[:60])

c.cmd('unpair'); c.reboot(); c.close()
print(f'{ok} passed, {bad} failed (the charm has been unpaired: browsers pair again with the code on its screen)')
sys.exit(1 if bad else 0)
