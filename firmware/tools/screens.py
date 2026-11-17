"""The screen gallery, captured from a real charm over USB:   python3 firmware/tools/screens.py
Every screen is drawn by the firmware on the charm and read straight out of its frame buffer (serial command `shot`),
so these are the exact pixels, scanlines and all. Sample content (a song, a sketch, weather in Tokyo, generic names)
replaces anything personal, in memory only; the charm reboots before and after. Spells are cast by replaying
recorded takes from dataset/ through the charm's own network.
Writes docs/screens/<screen>.png and docs/screens/gallery.png."""
import base64, os, sys, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'spells'))   # charm_serial, spells_data
from charm_serial import Charm
from spells_data import load

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'docs', 'screens'); os.makedirs(OUT, exist_ok=True)
takes = load(os.path.join(ROOT, 'dataset'))
def take(label, k=0):
    t = [t for t in takes if t['label'] == label][k]
    raw = np.round(np.concatenate([t['x'][:, :3] * t['aLsb'], t['x'][:, 3:] * t['gLsb']], 1)).astype('<i2')
    return 'take ' + base64.b64encode(raw.tobytes()).decode()

c = Charm()
print('rebooting the charm for a clean slate...'); c.reboot()
c.cmd(f'time {int(time.time())} {int(-time.timezone / 60 if not time.localtime().tm_isdst else -time.altzone / 60)}')
for d in ('card', 'np', 'art', 'wx', 'sketch'): c.cmd('demo ' + d)
shots = []
def grab(name, title, setup=(), wait=1.2):
    for s in setup: c.send(s) if s.startswith('take') else c.cmd(s, 'OK' if not s.startswith('take') else 'CAST')
    time.sleep(wait)
    img = Image.fromarray(c.shot()); img.save(os.path.join(OUT, name + '.png')); shots.append((name, title)); print('  ', name)

grab('deck', 'home: a live tmux session', ['mode 8'], 2.0)
grab('chooser', 'the window chooser', ['choose'], 0.8); c.cmd('choose')
c.cmd('mode 17'); c.cmd('view 0'); c.cmd('demo clear')
for label, name, title, k in [('circle', 'cast-circle', 'spells: a circle, LUMOS!', 2), ('heart', 'cast-heart', 'spells: a heart, AMOR!', 1), ('zigzag', 'cast-zigzag', 'spells: a zigzag, FULMEN!', 4)]:
    c.send(take(label, k)); c.until('CAST'); grab(name, title, (), 0.55)
c.send(take('none', 3)); c.until('CAST'); grab('cast-fizzle', 'not a spell: fizzle', (), 0.6)
for label, k in [('flick', 2), ('circle', 5), ('heart', 6), ('zigzag', 7), ('flick', 9)]: c.send(take(label, k)); c.until('CAST')
grab('map', 'the fingerprint map (live PCA)', ['view 3'], 0.8)
grab('knob', 'the wand: knob', ['view 1'], 0.6)
grab('draw', 'the wand: air drawing', ['view 2'], 0.6)
c.cmd('view 0')
grab('spotify', 'spotify, as a terminal player', ['mode 4'], 1.2)
grab('weather', 'weather: curl wttr.in', ['mode 15'], 2.2)
grab('claude', 'claude code remote', ['mode 14'], 3.0)
grab('tty', 'tty, a kaomoji companion', ['mode 13'], 2.0)
grab('eyes', 'the eyes', ['mode 9'], 1.5)
grab('clock', 'clock', ['mode 0'], 1.2)
grab('pet', 'pet', ['mode 5'], 1.2)
grab('games', 'games', ['mode 6'], 1.2)
grab('jukebox', 'jukebox', ['mode 10'], 1.2)
grab('recorder', 'the spell recorder', ['mode 16'], 1.5)
grab('card', 'ID card', ['mode 7'], 1.2)
c.cmd('mode 8'); print('rebooting the charm to drop the sample content...'); c.reboot(); c.close()

# the gallery: the screens in a grid, rounded like the real glass, with captions
cols, sw, sh, pad, cap = 5, 240, 280, 26, 30
rows = (len(shots) + cols - 1) // cols
G = Image.new('RGB', (cols * (sw + pad) + pad, rows * (sh + pad + cap) + pad + 20), (7, 9, 12))
d = ImageDraw.Draw(G)
try: font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 13)
except OSError: font = ImageFont.load_default()
mask = Image.new('L', (sw, sh), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw - 1, sh - 1], 34, fill=255)
for i, (name, title) in enumerate(shots):
    x, y = pad + (i % cols) * (sw + pad), pad + (i // cols) * (sh + pad + cap)
    d.rounded_rectangle([x - 5, y - 5, x + sw + 4, y + sh + 4], 38, fill=(26, 32, 40))
    G.paste(Image.open(os.path.join(OUT, name + '.png')), (x, y), mask)
    d.text((x + sw // 2, y + sh + 16), title, fill=(160, 172, 186), font=font, anchor='mm')
G.save(os.path.join(OUT, 'gallery.png'), optimize=True)
print(f'wrote {len(shots)} screens and docs/screens/gallery.png')
